# OpenComputer PR Review Agent

A GitHub App webhook service that reviews pull requests with OpenComputer Durable Agent Sessions and posts the result back as one sticky PR comment.

Live demo:

- App URL: `https://oc-pr-review-agent-digger-test0.fly.dev`
- GitHub App: `https://github.com/apps/0x-test-pr-reviewer`
- Health check: `https://oc-pr-review-agent-digger-test0.fly.dev/healthz`
- Verified demo PR: `https://github.com/diggerhq/test-durable-0/pull/1`

## Test The Live App

1. Install the GitHub App:
   `https://github.com/apps/0x-test-pr-reviewer/installations/new`
2. Select a test repository.
3. Open a new non-draft pull request, or push a new commit to an existing non-draft PR.
4. Look for a sticky PR comment titled `OpenComputer PR Review`.
5. To manually rerun a review, comment on the PR with:

```text
/oc-review
```

Expected behavior:

- The app posts progress in the PR comment as soon as it accepts the review.
- The same comment updates while the OpenComputer session is running.
- The final review replaces the progress text when the session completes.

Smoke test:

```bash
curl https://oc-pr-review-agent-digger-test0.fly.dev/healthz
```

Expected response:

```json
{"ok":true,"configured":true,"missing":[]}
```

Runtime logs:

```bash
flyctl logs --app oc-pr-review-agent-digger-test0
```

If no PR comment appears, check the GitHub App installation permissions first. The app needs **Pull requests: read and write** and **Issues: read and write**. Then check GitHub App delivery logs under:

```text
GitHub App settings -> Advanced -> Recent Deliveries
```

The webhook URL should be:

```text
https://oc-pr-review-agent-digger-test0.fly.dev/webhooks/github
```

## How It Works

The app has four responsibilities:

1. Accept a GitHub webhook and return quickly.
2. Fetch the PR metadata, changed files, and diff.
3. Start an OpenComputer Durable Agent Session with that PR context.
4. Update one sticky PR comment as the review moves from queued to done.

Automatic reviews run on `pull_request.opened`, `reopened`, `synchronize`, and `ready_for_review`. Manual reviews run from PR comments starting with `/oc-review`. Draft PRs are ignored unless `REVIEW_DRAFT_PRS=true`.

The key OpenComputer part is small. The real code is in [src/review.ts](src/review.ts).

```ts
import { OpenComputer } from "@opencomputer/sdk";

const oc = new OpenComputer({
  apiKey: process.env.OPENCOMPUTER_API_KEY!,
});

const agent = await oc.agents.create({
  name: "opencomputer-pr-reviewer",
  runtime: "claude",
  model: "anthropic/claude-opus-4-8",
  prompt: REVIEW_AGENT_PROMPT,
  key: process.env.ANTHROPIC_API_KEY,
  limits: { turns: 1, turnSeconds: 600 },
});

const session = await oc.sessions.create({
  agent: agent.id,
  input: buildReviewTask({ repository, pullRequest, files, diff }),
  key: `github:${repo}:pull:${number}:sha:${headSha}`,
  idempotencyKey: githubDeliveryId,
});
```

Then poll the durable session result and post it back to GitHub:

```ts
while (true) {
  const result = await session.result();
  if (result.lastTurn?.yieldReason) {
    await github.upsertStickyIssueComment({
      issueNumber: pullRequest.number,
      marker: "<!-- opencomputer-pr-review -->",
      body: markdownFrom(result),
    });
    break;
  }

  await sleep(5000);
}
```

The webhook route is just normal app plumbing: verify GitHub, hand work to the review service, and return `202`. See [src/app.ts](src/app.ts).

```ts
app.post("/webhooks/github", async (c) => {
  const body = await readWebhookBody(c.req.raw);
  if (!verifyGitHubSignature(secret, body, c.req.header("x-hub-signature-256"))) {
    return c.json({ ok: false }, 401);
  }

  reviewService.handleWebhook({
    event: c.req.header("x-github-event"),
    delivery: c.req.header("x-github-delivery"),
    payload: JSON.parse(body.toString("utf8")),
  });

  return c.json({ ok: true, accepted: true }, 202);
});
```

The rest is provider-specific glue:

- [src/github.ts](src/github.ts) signs GitHub App JWTs, fetches PR data, and writes comments.
- [src/prompts.ts](src/prompts.ts) turns GitHub PR context into the agent task.
- [src/server.ts](src/server.ts) wires config, Hono, GitHub, and OpenComputer together.

## Configure

Required environment variables:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`
- `OPENCOMPUTER_API_KEY`

Common optional values:

- `PUBLIC_URL`: public base URL used for setup pages and webhook hints.
- `OPENCOMPUTER_BASE_URL`: defaults to `https://api.opencomputer.dev/v3`.
- `GITHUB_CLIENT_ID`: recommended by GitHub for JWT `iss`; falls back to `GITHUB_APP_ID`.
- `GITHUB_APP_SLUG`: enables the install link on `/`.
- `ANTHROPIC_API_KEY`: passed to OpenComputer when creating the agent if no credential ID is configured.
- `OPENCOMPUTER_CREDENTIAL_ID`: reuse an existing OpenComputer model credential.
- `OPENCOMPUTER_AGENT_ID`: reuse an existing OpenComputer agent.
- `OPENCOMPUTER_AGENT_MODEL`: defaults to `anthropic/claude-opus-4-8`.
- `REVIEW_MAX_DIFF_CHARS`: defaults to `60000`.
- `REVIEW_DRAFT_PRS`: defaults to `false`.

The service can boot before all secrets are configured. In that state `/healthz` returns `configured: false`, `/` lists missing variables, and webhook processing returns `503 setup incomplete`.

## Run Locally

```bash
cp .env.example .env
npm install
npm test
npm run build
npm start
```

For iterative development:

```bash
npm run dev
```

For local webhook testing, expose the server with a tunnel, set `PUBLIC_URL`, and point the GitHub App webhook URL at:

```text
PUBLIC_URL/webhooks/github
```

## Deploy

Fly.io is the current deployment target for this repo.

```bash
flyctl deploy
flyctl secrets set \
  GITHUB_APP_ID=... \
  GITHUB_PRIVATE_KEY_BASE64=... \
  GITHUB_WEBHOOK_SECRET=... \
  OPENCOMPUTER_API_KEY=... \
  ANTHROPIC_API_KEY=...
```

[fly.toml](fly.toml) sets `PUBLIC_URL` for the live Fly app. After deploy, verify:

```bash
curl https://oc-pr-review-agent-digger-test0.fly.dev/healthz
```

To create a preconfigured GitHub App for another deployment, open:

```text
https://oc-pr-review-agent-digger-test0.fly.dev/setup/github-app
```

GitHub redirects back with a temporary manifest code. Exchange it within one hour, then set the returned app ID, private key, and webhook secret as deployment secrets. Keep private keys and webhook secrets out of git.

## Production Notes

- OpenComputer sessions are durable, but this prototype starts review work in-process after returning HTTP 202. A production version should use a durable queue and/or OpenComputer completion webhooks.
- `data/reviews.jsonl` is local process/container state, not a durable audit log.
- The review output is currently one Markdown PR comment. Checks annotations and line comments are future improvements.
- The app sends PR diffs as task input. A richer version could give the OpenComputer runtime repository access.

## Tracking Docs

- [conversation-history.md](conversation-history.md) records user prompts and assistant response summaries.
- [opencomputer-dx-notes.md](opencomputer-dx-notes.md) records API and developer-experience observations from this build.
