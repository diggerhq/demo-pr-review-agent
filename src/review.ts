import type { CreateAgentParams, Session } from "@opencomputer/sdk";
import { REVIEW_AGENT_PROMPT, buildReviewTask, limitCommentBody } from "./prompts.js";
import type {
  GitHubPullRequest,
  GitHubRepository,
  GitHubWebhookPayload,
  OpenComputerSession,
  ReviewServiceDeps,
} from "./types.js";

export const REVIEW_COMMENT_MARKER = "<!-- opencomputer-pr-review -->";

const PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

type SessionResult = Awaited<ReturnType<Session["result"]>>;

interface ReviewCommand {
  matched: boolean;
  instruction: string;
}

interface WebhookContext {
  event?: string;
  delivery?: string;
  payload: GitHubWebhookPayload;
}

interface QueuedReviewJob {
  delivery?: string;
  installationId?: number;
  repository: GitHubRepository;
  pullRequest: GitHubPullRequest;
  trigger: string;
  manualInstruction?: string;
  installationToken?: string;
}

interface ManualReviewJob {
  delivery?: string;
  installationId?: number;
  repository: GitHubRepository;
  pullNumber: number;
  manualInstruction: string;
}

interface CommentContext {
  repository: GitHubRepository;
  pullRequest: GitHubPullRequest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorRecord(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const maybeApiError = error as Error & {
    status?: number;
    details?: unknown;
    code?: string;
  };

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    status: maybeApiError.status,
    details: maybeApiError.details,
    code: maybeApiError.code,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortSha(sha = ""): string {
  return sha ? sha.slice(0, 12) : "unknown";
}

function sessionKey(repository: GitHubRepository, pullRequest: GitHubPullRequest): string {
  return `github:${repository.full_name}:pull:${pullRequest.number}:sha:${pullRequest.head?.sha}`;
}

export function parseReviewCommand(body: string, commandPrefix: string): ReviewCommand {
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

function resultText(result: SessionResult): string {
  const event = result?.result;
  if (!event) {
    return "";
  }

  const body = event.body as Record<string, unknown> | undefined;
  if (typeof body?.text === "string") {
    return body.text;
  }

  if (typeof body?.summary === "string") {
    return body.summary;
  }

  if (body) {
    return JSON.stringify(body, null, 2);
  }

  return "";
}

function reviewHeading({
  repository,
  pullRequest,
  sessionId = "",
  status,
}: CommentContext & { sessionId?: string; status: string }): string {
  const sessionLine = sessionId ? `- Session: \`${sessionId}\`\n` : "";

  return `${REVIEW_COMMENT_MARKER}
## OpenComputer PR Review

- Repository: \`${repository.full_name}\`
- PR: #${pullRequest.number}
- Commit: \`${shortSha(pullRequest.head?.sha)}\`
- Status: \`${status}\`
${sessionLine}
`;
}

function progressComment({
  repository,
  pullRequest,
  status,
  detail,
  trigger = "",
  sessionId = "",
  maxChars,
}: CommentContext & {
  status: string;
  detail: string;
  trigger?: string;
  sessionId?: string;
  maxChars: number;
}): string {
  const triggerLine = trigger ? `- Trigger: ${trigger}\n` : "";
  const body = `${reviewHeading({ repository, pullRequest, sessionId, status })}${triggerLine}
${detail}`;

  return limitCommentBody(body, maxChars);
}

function runningComment({
  repository,
  pullRequest,
  sessionId,
  trigger,
}: CommentContext & { sessionId: string; trigger: string }): string {
  return `${reviewHeading({ repository, pullRequest, sessionId, status: "running" })}
- Trigger: ${trigger}

Review is running in an OpenComputer durable agent session. This comment will update when the session completes.`;
}

function finalComment({
  repository,
  pullRequest,
  sessionId,
  yieldReason,
  markdown,
  maxChars,
}: CommentContext & {
  sessionId: string;
  yieldReason: string;
  markdown: string;
  maxChars: number;
}): string {
  const body = `${reviewHeading({ repository, pullRequest, sessionId, status: yieldReason })}
${markdown || "The session completed without a user-facing review message."}`;

  return limitCommentBody(body, maxChars);
}

function failureComment({
  repository,
  pullRequest,
  error,
  maxChars,
}: CommentContext & { error: unknown; maxChars: number }): string {
  const body = `${REVIEW_COMMENT_MARKER}
## OpenComputer PR Review

- Repository: \`${repository.full_name}\`
- PR: #${pullRequest.number}
- Commit: \`${shortSha(pullRequest.head?.sha)}\`
- Status: \`error\`

The review failed before a final result could be posted.

\`\`\`text
${errorMessage(error)}
\`\`\``;

  return limitCommentBody(body, maxChars);
}

export class ReviewService {
  config: ReviewServiceDeps["config"];
  github: ReviewServiceDeps["github"];
  openComputer: ReviewServiceDeps["openComputer"];
  store: ReviewServiceDeps["store"];
  agentId: string;

  constructor({ config, github, openComputer, store }: ReviewServiceDeps) {
    this.config = config;
    this.github = github;
    this.openComputer = openComputer;
    this.store = store;
    this.agentId = config.openComputer.agentId;
  }

  handleWebhook({ event, delivery, payload }: WebhookContext): { accepted: boolean; reason: string } {
    console.info("received webhook", {
      delivery,
      event,
      action: payload?.action,
      repository: payload?.repository?.full_name,
      pullNumber: payload?.pull_request?.number || payload?.issue?.number,
    });

    if (event === "ping") {
      console.info("received github ping", { delivery });
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

  handlePullRequestWebhook({ delivery, payload }: Omit<WebhookContext, "event">): { accepted: boolean; reason: string } {
    if (!PULL_REQUEST_ACTIONS.has(payload.action || "")) {
      return { accepted: false, reason: `ignored pull_request action ${payload.action}` };
    }

    if (!payload.pull_request) {
      return { accepted: false, reason: "ignored pull_request event without pull request data" };
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

  handleIssueCommentWebhook({ delivery, payload }: Omit<WebhookContext, "event">): { accepted: boolean; reason: string } {
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

  queueReview(job: QueuedReviewJob): void {
    setImmediate(() => {
      this.reviewPullRequest(job).catch((error) => {
        console.error("review job crashed", {
          delivery: job.delivery,
          error: errorRecord(error),
        });
      });
    });
  }

  queueManualReview(job: ManualReviewJob): void {
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
        console.error("manual review job crashed", {
          delivery: job.delivery,
          error: errorRecord(error),
        });
      }
    });
  }

  async ensureOpenComputerAgent(): Promise<string> {
    if (this.agentId) {
      return this.agentId;
    }

    const params: CreateAgentParams = {
      name: this.config.openComputer.agentName,
      runtime: "claude",
      model: this.config.openComputer.model,
      prompt: REVIEW_AGENT_PROMPT,
      limits: this.config.openComputer.limits,
    };

    if (this.config.openComputer.credentialId) {
      params.credential = this.config.openComputer.credentialId;
    } else if (this.config.openComputer.anthropicKey) {
      params.key = this.config.openComputer.anthropicKey;
    }

    const agent = await this.openComputer.agents.create(params);
    this.agentId = agent.id;
    return agent.id;
  }

  async waitForSessionResult(session: OpenComputerSession): Promise<SessionResult> {
    const deadline = Date.now() + this.config.review.waitTimeoutMs;
    let lastResult: SessionResult | null = null;

    while (Date.now() < deadline) {
      lastResult = await session.result();
      if (lastResult?.lastTurn?.yieldReason) {
        return lastResult;
      }
      await sleep(this.config.review.pollIntervalMs);
    }

    const error = new Error(`Timed out waiting for OpenComputer session ${session.id}`) as Error & {
      lastResult?: SessionResult | null;
    };
    error.lastResult = lastResult;
    throw error;
  }

  async reviewPullRequest({
    delivery,
    installationId,
    repository,
    pullRequest,
    trigger,
    manualInstruction = "",
    installationToken = "",
  }: QueuedReviewJob): Promise<void> {
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
    console.info("review started", {
      delivery,
      trigger,
      repository: repository.full_name,
      pullNumber,
      headSha: pullRequest.head?.sha,
    });

    try {
      token ||= await this.github.installationToken(installationId);
      await this.github.upsertStickyIssueComment({
        token,
        owner,
        repo,
        issueNumber: pullNumber,
        marker: REVIEW_COMMENT_MARKER,
        body: progressComment({
          repository,
          pullRequest,
          status: "queued",
          trigger,
          detail: "Review request received. Fetching pull request files and diff now.",
          maxChars: this.config.review.commentMaxChars,
        }),
      });
      console.info("review progress comment posted", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        status: "queued",
      });

      console.info("review fetching diff", {
        delivery,
        repository: repository.full_name,
        pullNumber,
      });
      const [files, diff] = await Promise.all([
        this.github.listPullRequestFiles({ token, owner, repo, pullNumber }),
        this.github.getPullRequestDiff({ token, owner, repo, pullNumber }),
      ]);
      await this.github.upsertStickyIssueComment({
        token,
        owner,
        repo,
        issueNumber: pullNumber,
        marker: REVIEW_COMMENT_MARKER,
        body: progressComment({
          repository,
          pullRequest,
          status: "preparing_session",
          trigger,
          detail: `Fetched ${files.length} changed file${files.length === 1 ? "" : "s"}. Starting an OpenComputer durable agent session.`,
          maxChars: this.config.review.commentMaxChars,
        }),
      });

      console.info("review ensuring opencomputer agent", {
        delivery,
        repository: repository.full_name,
        pullNumber,
      });
      const agentId = await this.ensureOpenComputerAgent();
      const input = buildReviewTask({
        repository,
        pullRequest,
        files,
        diff,
        maxDiffChars: this.config.review.maxDiffChars,
        manualInstruction,
      });
      console.info("review creating opencomputer session", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        agentId,
      });
      const session = await this.openComputer.sessions.create({
        agent: agentId,
        input,
        key: sessionKey(repository, pullRequest),
        limits: this.config.openComputer.limits,
        idempotencyKey: delivery,
      });
      const sessionId = session.id;
      console.info("review opencomputer session created", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        sessionId,
      });

      await this.github.upsertStickyIssueComment({
        token,
        owner,
        repo,
        issueNumber: pullNumber,
        marker: REVIEW_COMMENT_MARKER,
        body: runningComment({ repository, pullRequest, sessionId, trigger }),
      });

      console.info("review waiting for opencomputer result", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        sessionId,
      });
      const result = await this.waitForSessionResult(session);
      const yieldReason = result.lastTurn?.yieldReason || "unknown";
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
      console.info("review completed", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        sessionId,
        yieldReason,
      });
    } catch (error) {
      console.error("review failed", {
        delivery,
        repository: repository.full_name,
        pullNumber,
        error: errorRecord(error),
      });

      await this.store.append({
        event: "review.failed",
        delivery,
        repository: repository.full_name,
        pullNumber,
        headSha: pullRequest.head?.sha,
        error: errorRecord(error),
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
