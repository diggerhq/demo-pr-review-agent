import { REVIEW_AGENT_PROMPT, buildReviewTask, limitCommentBody } from "./prompts.js";
import { serializeError } from "./log.js";

export const REVIEW_COMMENT_MARKER = "<!-- opencomputer-pr-review -->";

const PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

function shortSha(sha = "") {
  return sha ? sha.slice(0, 12) : "unknown";
}

function sessionKey(repository, pullRequest) {
  return `github:${repository.full_name}:pull:${pullRequest.number}:sha:${pullRequest.head?.sha}`;
}

export function parseReviewCommand(body, commandPrefix) {
  const trimmed = body.trim();
  if (trimmed === commandPrefix) {
    return {
      matched: true,
      instruction: "",
    };
  }

  if (trimmed.startsWith(`${commandPrefix} `) || trimmed.startsWith(`${commandPrefix}\n`)) {
    return {
      matched: true,
      instruction: trimmed.slice(commandPrefix.length).trim(),
    };
  }

  return {
    matched: false,
    instruction: "",
  };
}

function resultText(result) {
  const event = result?.result;
  if (!event) {
    return "";
  }

  if (typeof event.body?.text === "string") {
    return event.body.text;
  }

  if (typeof event.body?.summary === "string") {
    return event.body.summary;
  }

  if (event.body) {
    return JSON.stringify(event.body, null, 2);
  }

  return "";
}

function reviewHeading({ repository, pullRequest, sessionId, yieldReason }) {
  return `${REVIEW_COMMENT_MARKER}
## OpenComputer PR Review

- Repository: \`${repository.full_name}\`
- PR: #${pullRequest.number}
- Commit: \`${shortSha(pullRequest.head?.sha)}\`
- Session: \`${sessionId}\`
- Status: \`${yieldReason}\`
`;
}

function runningComment({ repository, pullRequest, sessionId, trigger }) {
  return `${reviewHeading({ repository, pullRequest, sessionId, yieldReason: "running" })}
- Trigger: ${trigger}

Review is running in an OpenComputer durable agent session. This comment will update when the session completes.`;
}

function finalComment({ repository, pullRequest, sessionId, yieldReason, markdown, maxChars }) {
  const body = `${reviewHeading({ repository, pullRequest, sessionId, yieldReason })}
${markdown || "The session completed without a user-facing review message."}`;

  return limitCommentBody(body, maxChars);
}

function failureComment({ repository, pullRequest, error, maxChars }) {
  const body = `${REVIEW_COMMENT_MARKER}
## OpenComputer PR Review

- Repository: \`${repository.full_name}\`
- PR: #${pullRequest.number}
- Commit: \`${shortSha(pullRequest.head?.sha)}\`
- Status: \`error\`

The review failed before a final result could be posted.

\`\`\`text
${error.message}
\`\`\``;

  return limitCommentBody(body, maxChars);
}

export class ReviewService {
  constructor({ config, github, openComputer, store, logger }) {
    this.config = config;
    this.github = github;
    this.openComputer = openComputer;
    this.store = store;
    this.logger = logger;
  }

  handleWebhook({ event, delivery, payload }) {
    if (event === "ping") {
      this.logger.info("received github ping", { delivery });
      return { accepted: true, reason: "ping" };
    }

    if (event === "pull_request") {
      return this.handlePullRequestWebhook({ delivery, payload });
    }

    if (event === "issue_comment") {
      return this.handleIssueCommentWebhook({ delivery, payload });
    }

    return { accepted: false, reason: `ignored event ${event}` };
  }

  handlePullRequestWebhook({ delivery, payload }) {
    if (!PULL_REQUEST_ACTIONS.has(payload.action)) {
      return { accepted: false, reason: `ignored pull_request action ${payload.action}` };
    }

    if (payload.pull_request?.draft && !this.config.review.includeDrafts) {
      return { accepted: false, reason: "ignored draft pull request" };
    }

    this.queueReview({
      delivery,
      installationId: payload.installation?.id,
      repository: payload.repository,
      pullRequest: payload.pull_request,
      trigger: `pull_request.${payload.action}`,
    });

    return { accepted: true, reason: "queued pull request review" };
  }

  handleIssueCommentWebhook({ delivery, payload }) {
    if (payload.action !== "created") {
      return { accepted: false, reason: `ignored issue_comment action ${payload.action}` };
    }

    if (!payload.issue?.pull_request) {
      return { accepted: false, reason: "ignored issue comment outside a pull request" };
    }

    const command = parseReviewCommand(payload.comment?.body || "", this.config.review.commandPrefix);
    if (!command.matched) {
      return { accepted: false, reason: "ignored issue comment without review command" };
    }

    this.queueManualReview({
      delivery,
      installationId: payload.installation?.id,
      repository: payload.repository,
      pullNumber: payload.issue.number,
      manualInstruction: command.instruction,
    });

    return { accepted: true, reason: "queued manual pull request review" };
  }

  queueReview(job) {
    setImmediate(() => {
      this.reviewPullRequest(job).catch((error) => {
        this.logger.error("review job crashed", {
          delivery: job.delivery,
          error: serializeError(error),
        });
      });
    });
  }

  queueManualReview(job) {
    setImmediate(async () => {
      try {
        const token = await this.github.installationToken(job.installationId);
        const pullRequest = await this.github.getPullRequest({
          token,
          owner: job.repository.owner.login,
          repo: job.repository.name,
          pullNumber: job.pullNumber,
        });

        await this.reviewPullRequest({
          delivery: job.delivery,
          installationId: job.installationId,
          repository: job.repository,
          pullRequest,
          trigger: "issue_comment.command",
          manualInstruction: job.manualInstruction,
          installationToken: token,
        });
      } catch (error) {
        this.logger.error("manual review job crashed", {
          delivery: job.delivery,
          error: serializeError(error),
        });
      }
    });
  }

  async reviewPullRequest({
    delivery,
    installationId,
    repository,
    pullRequest,
    trigger,
    manualInstruction = "",
    installationToken = "",
  }) {
    const owner = repository.owner.login;
    const repo = repository.name;
    const pullNumber = pullRequest.number;
    let token = installationToken;

    await this.store.append({
      event: "review.started",
      delivery,
      trigger,
      repository: repository.full_name,
      pullNumber,
      headSha: pullRequest.head?.sha,
    });

    try {
      token ||= await this.github.installationToken(installationId);
      const [files, diff] = await Promise.all([
        this.github.listPullRequestFiles({ token, owner, repo, pullNumber }),
        this.github.getPullRequestDiff({ token, owner, repo, pullNumber }),
      ]);

      const agentId = await this.openComputer.ensureAgent({
        agentId: this.config.openComputer.agentId,
        name: this.config.openComputer.agentName,
        prompt: REVIEW_AGENT_PROMPT,
        model: this.config.openComputer.model,
        credentialId: this.config.openComputer.credentialId,
        anthropicKey: this.config.openComputer.anthropicKey,
        limits: this.config.openComputer.limits,
      });
      const input = buildReviewTask({
        repository,
        pullRequest,
        files,
        diff,
        maxDiffChars: this.config.review.maxDiffChars,
        manualInstruction,
      });
      const session = await this.openComputer.createSession({
        agent: agentId,
        input,
        key: sessionKey(repository, pullRequest),
        limits: this.config.openComputer.limits,
        idempotencyKey: delivery,
      });
      const sessionId = session.session.id;

      await this.github.upsertStickyIssueComment({
        token,
        owner,
        repo,
        issueNumber: pullNumber,
        marker: REVIEW_COMMENT_MARKER,
        body: runningComment({ repository, pullRequest, sessionId, trigger }),
      });

      const result = await this.openComputer.waitForResult(sessionId, {
        timeoutMs: this.config.review.waitTimeoutMs,
        pollIntervalMs: this.config.review.pollIntervalMs,
      });
      const yieldReason = result.last_turn?.yield_reason || "unknown";
      const markdown = resultText(result);

      await this.github.upsertStickyIssueComment({
        token,
        owner,
        repo,
        issueNumber: pullNumber,
        marker: REVIEW_COMMENT_MARKER,
        body: finalComment({
          repository,
          pullRequest,
          sessionId,
          yieldReason,
          markdown,
          maxChars: this.config.review.commentMaxChars,
        }),
      });

      await this.store.append({
        event: "review.completed",
        delivery,
        repository: repository.full_name,
        pullNumber,
        headSha: pullRequest.head?.sha,
        sessionId,
        yieldReason,
      });
      this.logger.info("review completed", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        sessionId,
        yieldReason,
      });
    } catch (error) {
      this.logger.error("review failed", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        error: serializeError(error),
      });

      await this.store.append({
        event: "review.failed",
        delivery,
        repository: repository.full_name,
        pullNumber,
        headSha: pullRequest.head?.sha,
        error: serializeError(error),
      });

      if (token) {
        await this.github.upsertStickyIssueComment({
          token,
          owner,
          repo,
          issueNumber: pullNumber,
          marker: REVIEW_COMMENT_MARKER,
          body: failureComment({
            repository,
            pullRequest,
            error,
            maxChars: this.config.review.commentMaxChars,
          }),
        });
      }
    }
  }
}
