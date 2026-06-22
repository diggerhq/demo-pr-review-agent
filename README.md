# OpenComputer PR Review Agent

A serverless GitHub App that reviews pull requests with [OpenComputer Durable Agent Sessions](https://docs.opencomputer.dev/agent-sessions/overview) and posts the result back as one sticky PR comment.

Live demo:

- App: [oc-pr-review.mo-b8f.workers.dev](https://oc-pr-review.mo-b8f.workers.dev)
- GitHub App: [0x Test PR Reviewer](https://github.com/apps/0x-test-pr-reviewer)
- Verified demo PR: [diggerhq/test-durable-0#3](https://github.com/diggerhq/test-durable-0/pull/3)
- Docs: [Durable Agent Sessions](https://docs.opencomputer.dev/agent-sessions/overview), [sessions](https://docs.opencomputer.dev/agent-sessions/sessions), [webhooks](https://docs.opencomputer.dev/agent-sessions/webhooks), and [API/SDK reference](https://docs.opencomputer.dev/agent-sessions/api-reference)

## Test The Live App

1. [Install the GitHub App](https://github.com/apps/0x-test-pr-reviewer/installations/new) on a test repository.
2. Open a new non-draft pull request, or push a commit to an existing non-draft PR.
3. Watch for one sticky PR comment titled `OpenComputer PR Review`.

To rerun manually, comment on the PR with:

```text
/oc-review
```

The comment should move from queued/running progress to a final review when the OpenComputer session completes.

Quick checks:

```bash
curl https://oc-pr-review.mo-b8f.workers.dev/healthz
wrangler deployments list
```

The health check should return `configured: true`. If no PR comment appears, verify the installation has **Pull requests: read and write** and **Issues: read and write**, then inspect **GitHub App settings -> Advanced -> Recent Deliveries**. The webhook should point at `https://oc-pr-review.mo-b8f.workers.dev/webhooks/github`.

## How It Works

The Worker has four responsibilities:

1. Accept a GitHub webhook and run the short setup path.
2. Fetch the PR metadata, changed files, and diff.
3. Start an [OpenComputer Durable Agent Session](https://docs.opencomputer.dev/agent-sessions/sessions) with that PR context and a completion callback.
4. Let the [OpenComputer webhook](https://docs.opencomputer.dev/agent-sessions/webhooks) update one sticky PR comment when the session finishes.

The app keeps no database, local queue, or in-memory job state. Each [OpenComputer session](https://docs.opencomputer.dev/agent-sessions/sessions) stores the GitHub routing data in `metadata`; when OpenComputer calls back, the Worker reads that metadata from the session snapshot and knows which PR comment to update.

Automatic reviews run on `pull_request.opened`, `reopened`, `synchronize`, and `ready_for_review`. Manual reviews run from PR comments starting with `/oc-review`. Draft PRs are ignored unless `REVIEW_DRAFT_PRS=true`.

Bootstrap the OpenComputer agent once, then set `OPENCOMPUTER_AGENT_ID` in the deployed app. See the OpenComputer [agents docs](https://docs.opencomputer.dev/agent-sessions/agents) and the local script [scripts/bootstrap-opencomputer-agent.ts](scripts/bootstrap-opencomputer-agent.ts).

```ts
import { OpenComputer } from "@opencomputer/sdk";

const oc = new OpenComputer({
  apiKey: process.env.OPENCOMPUTER_API_KEY!,
});

const agent = existingAgent || await oc.agents.create({
  name: "opencomputer-pr-reviewer",
  runtime: "claude",
  model: "anthropic/claude-opus-4-8",
  prompt: REVIEW_AGENT_PROMPT,
  key: process.env.ANTHROPIC_API_KEY,
  limits: { turns: 1, turnSeconds: 600 },
});
```

At runtime, each PR starts a [durable session](https://docs.opencomputer.dev/agent-sessions/sessions) against that existing agent. The real code is in [src/review.ts](src/review.ts), and the SDK shape is documented in the [API/SDK reference](https://docs.opencomputer.dev/agent-sessions/api-reference).

```ts
const session = await oc.sessions.create({
  agent: process.env.OPENCOMPUTER_AGENT_ID!,
  input: buildReviewTask({ repository, pullRequest, files, diff }),
  metadata: {
    source: "github-pr-review",
    owner,
    repo,
    pullNumber,
    headSha,
    deliveryId,
  },
  idempotencyKey: deliveryId,
  destinations: [{
    url: `${PUBLIC_URL}/webhooks/opencomputer?token=${token}`,
    types: ["turn.completed"],
    level: "user",
  }],
});

await github.upsertStickyIssueComment({
  issueNumber: pullNumber,
  body: `Review is running in OpenComputer session ${session.id}.`,
});
```

When OpenComputer calls back through a [webhook destination](https://docs.opencomputer.dev/agent-sessions/webhooks), fetch the durable result, read the routing metadata from the session snapshot, and post back to GitHub. This keeps the example fully serverless: Cloudflare handles the HTTP request, and OpenComputer owns the durable session state.

```ts
app.post("/webhooks/opencomputer", async (c) => {
  verifyCallbackToken(c.req.query("token"));

  const { sessionId } = await c.req.json();
  const session = await oc.sessions.get(sessionId);
  const route = parseReviewMetadata(session.snapshot.metadata);
  const result = await session.result();

  const token = await github.installationTokenForRepository(route);
  const pullRequest = await github.getPullRequest(route);
  await github.upsertStickyIssueComment({
    issueNumber: pullRequest.number,
    marker: "<!-- opencomputer-pr-review -->",
    body: markdownFrom(result),
  });
});
```

The webhook route is just normal app plumbing: verify GitHub, start the durable OpenComputer session, and return `202`. See [src/app.ts](src/app.ts).

```ts
app.post("/webhooks/github", async (c) => {
  const body = await readWebhookBody(c.req.raw);
  if (!verifyGitHubSignature(secret, body, c.req.header("x-hub-signature-256"))) {
    return c.json({ ok: false }, 401);
  }

  const result = await reviewService.handleWebhook({
    event: c.req.header("x-github-event"),
    delivery: c.req.header("x-github-delivery"),
    payload: JSON.parse(body.toString("utf8")),
  });

  return c.json({ ok: true, ...result }, result.accepted ? 202 : 200);
});
```

The rest is supporting glue:

- [src/github.ts](src/github.ts) signs GitHub App JWTs, fetches PR data, and writes comments.
- [src/prompts.ts](src/prompts.ts) turns GitHub PR context into the agent task.
- [src/runtime.ts](src/runtime.ts) wires config, Hono, GitHub, and OpenComputer together.
- [src/worker.ts](src/worker.ts) is the thin Cloudflare Worker adapter.

## Configure

Required environment variables:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`
- `OPENCOMPUTER_API_KEY`
- `OPENCOMPUTER_AGENT_ID`
- `OPENCOMPUTER_WEBHOOK_TOKEN`

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
npm run bootstrap:agent
npm test
npm run build
```

For iterative development:

```bash
npm run dev
```

For local webhook testing, expose Wrangler with a tunnel, set `PUBLIC_URL`, and point the GitHub App webhook URL at:

```text
PUBLIC_URL/webhooks/github
```

## Deploy

Cloudflare Workers is the deploy target for this example. The app core stays runtime-neutral; the Worker entrypoint only reads `env`, builds the shared runtime, and calls Hono's Fetch handler.

```bash
npm run deploy
```

Set Worker secrets with Wrangler:

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_PRIVATE_KEY_BASE64
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put OPENCOMPUTER_API_KEY
wrangler secret put OPENCOMPUTER_AGENT_ID
wrangler secret put OPENCOMPUTER_WEBHOOK_TOKEN
wrangler secret put ANTHROPIC_API_KEY
```

[wrangler.toml](wrangler.toml) contains non-secret defaults and enables `nodejs_compat` so the GitHub App signing code can keep using `node:crypto`. For your own deployment, set `PUBLIC_URL` in `wrangler.toml` to the deployed Worker URL and update the GitHub App webhook URL to:

```text
PUBLIC_URL/webhooks/github
```

For local Worker testing:

```bash
npm run dev
```

To create a preconfigured GitHub App for another deployment, open [the manifest setup page](https://oc-pr-review.mo-b8f.workers.dev/setup/github-app).

GitHub redirects back with a temporary manifest code. Exchange it within one hour, then set the returned app ID, private key, and webhook secret as deployment secrets. Keep private keys and webhook secrets out of git.

## Production Notes

- [OpenComputer session execution](https://docs.opencomputer.dev/agent-sessions/sessions) is durable and completion is callback-driven through [webhooks](https://docs.opencomputer.dev/agent-sessions/webhooks). This prototype keeps callback routing state in session `metadata` so it does not need a database for routing.
- That metadata handoff is what makes the app fully serverless: GitHub webhook request state, OpenComputer completion routing, and final PR update routing all survive without local process state.
- For simplicity, the GitHub webhook handler awaits only the setup work needed to create the OpenComputer session and post the running comment. If that setup can approach GitHub's webhook timeout in production, move it behind a queue or serverless `waitUntil` equivalent.
- `@opencomputer/sdk@0.7.2` types session metadata on create and fetch, so the app can use `session.snapshot.metadata` without local type casts. See the OpenComputer [API/SDK reference](https://docs.opencomputer.dev/agent-sessions/api-reference).
- The review output is currently one Markdown PR comment. Checks annotations and line comments are future improvements.
- The app sends PR diffs as task input. A richer version could give the OpenComputer runtime repository access.

## Tracking Docs

- [conversation-history.md](conversation-history.md) records user prompts and assistant response summaries.
- [opencomputer-dx-notes.md](opencomputer-dx-notes.md) records API and developer-experience observations from this build.
- [opencomputer-api-sdk-requirements.md](opencomputer-api-sdk-requirements.md) captures concrete API/SDK changes suggested by this example.
