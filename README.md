# OpenComputer PR Review Agent

A deployable GitHub App webhook service that reviews pull requests in the background with OpenComputer Durable Agent Sessions.

The user-facing shape is:

1. You deploy this service to a public URL.
2. You register a GitHub App whose webhook points at that URL.
3. A repository owner installs the GitHub App on their repos.
4. Pull request events trigger an OpenComputer durable agent session.
5. The service posts a sticky review comment back to the PR when the session completes.

## Test The Live Deployment

The current public deployment is:

```text
https://oc-pr-review-agent-digger-test0.fly.dev
```

Smoke test the service:

```bash
curl https://oc-pr-review-agent-digger-test0.fly.dev/healthz
```

Expected response:

```json
{"ok":true,"configured":true,"missing":[]}
```

End-to-end PR review test:

1. Install the GitHub App:
   `https://github.com/apps/0x-test-pr-reviewer/installations/new`
2. Select a test repository.
3. Open a new non-draft PR in that repo.

Expected behavior:

- The app receives the `pull_request.opened` webhook.
- It posts or updates a sticky PR comment titled `OpenComputer PR Review`.
- The comment first shows queued/running progress.
- The comment updates with the OpenComputer review result when the durable session completes.

Manual re-run test:

1. Use an existing open PR.
2. Comment on the PR:

```text
/oc-review
```

Expected behavior:

- The app receives the `issue_comment` webhook.
- It posts or updates a sticky PR comment titled `OpenComputer PR Review`.
- The comment first shows queued/running progress.
- The comment updates with the OpenComputer review result when the durable session completes.

The GitHub App must have **Pull requests: read and write**. GitHub can reject PR conversation comments with `403 Resource not accessible by integration` when the app has `Issues: write` but only `Pull requests: read`.

For the current test app, verify or approve the installed permission update here:

```text
https://github.com/organizations/diggerhq/settings/installations/141975477
```

The installation token must show `pull_requests: write` before the app can post review progress comments to PR #1.

You can also trigger a review by pushing a new commit to the PR, which sends `pull_request.synchronize`.

If no PR comment appears, check GitHub App delivery logs first:

```text
GitHub App settings -> Advanced -> Recent Deliveries
```

The webhook URL should be:

```text
https://oc-pr-review-agent-digger-test0.fly.dev/webhooks/github
```

Runtime logs:

```bash
flyctl logs --app oc-pr-review-agent-digger-test0
```

## How It Works End To End

Moving parts:

- **GitHub App**: installed on repositories and subscribed to pull request and issue comment events.
- **Fly web service**: public Node HTTP service at `https://oc-pr-review-agent-digger-test0.fly.dev`.
- **GitHub API**: used to authenticate as the app installation, fetch PR metadata/diffs, and write sticky PR comments.
- **OpenComputer Durable Agent Sessions**: runs the actual review as a durable background agent session.
- **Anthropic key**: supplied to OpenComputer as the model credential for the managed Claude runtime.
- **Sticky PR comment**: the user-facing progress and final result surface.

Webhook flow:

1. GitHub sends a signed webhook to `POST /webhooks/github`.
2. The service verifies `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`.
3. If the event is relevant, the service returns HTTP 202 quickly and starts async review work in the Node process.
4. Automatic triggers are `pull_request.opened`, `pull_request.reopened`, `pull_request.synchronize`, and `pull_request.ready_for_review`.
5. Draft PRs are ignored unless `REVIEW_DRAFT_PRS=true`.
6. Manual trigger is a PR comment starting with `/oc-review`.

Review job flow:

1. The service signs a GitHub App JWT with `GITHUB_PRIVATE_KEY_BASE64`.
2. It exchanges the JWT for a repository installation token.
3. It immediately creates or updates a sticky `OpenComputer PR Review` comment with `queued` progress.
4. It fetches changed file metadata and the unified PR diff from GitHub.
5. It ensures an OpenComputer agent exists with the PR-review prompt, model, and limits.
6. It starts an OpenComputer session keyed by repo, PR number, and head SHA.
7. It updates the sticky PR comment to show the OpenComputer session is running.
8. It polls `GET /sessions/:id/result` until the durable session completes or times out.
9. It updates the same sticky PR comment with the final review, or with an error if something failed.

OpenComputer input shape:

- Repository, PR number, URL, author, base/head refs and SHAs.
- PR body, treated as untrusted content.
- Changed file summary.
- Unified diff, truncated by `REVIEW_MAX_DIFF_CHARS` if needed.
- Optional trusted manual instruction supplied after `/oc-review`.

Operational caveats:

- The OpenComputer session is durable, but this first service uses an in-process async job after returning HTTP 202. If the Fly machine restarts mid-job before the session is created, that job can be lost.
- `data/reviews.jsonl` is local process/container state, useful for development but not a durable production audit log.
- A production version should use a real queue and/or OpenComputer destinations/webhooks for completion handling.
- The GitHub App installation must have **Pull requests: write** as well as **Issues: write** so it can post PR conversation comments.

## What It Does

- Verifies GitHub webhook signatures with `X-Hub-Signature-256`.
- Authenticates as a GitHub App and exchanges a signed JWT for an installation access token.
- Handles `pull_request` events for opened, reopened, synchronized, and ready-for-review PRs.
- Handles manual review commands via PR comments: `/oc-review`, optionally followed by reviewer instructions.
- Fetches PR file metadata and unified diff from GitHub.
- Creates or reuses an OpenComputer Durable Agent Sessions agent.
- Starts an OpenComputer session keyed by repo, PR number, and head SHA.
- Polls the durable session result and updates one sticky PR comment.
- Writes local JSONL review lifecycle records to `data/reviews.jsonl`.

## Current Architecture

```text
GitHub PR webhook
  -> this service: POST /webhooks/github
  -> verify signature
  -> GitHub installation token
  -> fetch PR diff + files
  -> OpenComputer POST /agents
  -> OpenComputer POST /sessions
  -> poll OpenComputer GET /sessions/:id/result
  -> create/update GitHub PR comment
```

The first version sends PR metadata and a truncated diff as the OpenComputer task input. It does not yet clone the repository into the OpenComputer runtime.

## Requirements

- Node.js 20.11 or newer.
- An OpenComputer API key.
- An Anthropic API key registered with OpenComputer, either by `ANTHROPIC_API_KEY`, `OPENCOMPUTER_CREDENTIAL_ID`, or an org default credential.
- A GitHub App with a private key and webhook secret.
- A public deployment URL for GitHub webhook delivery.

## GitHub App Setup

Create a GitHub App with:

- Webhook URL: `https://your-service.example.com/webhooks/github`
- Webhook secret: a high-entropy random value
- Repository permissions:
  - Contents: read
  - Pull requests: write
  - Issues: write
  - Metadata: read, added by GitHub automatically
- Subscribe to events:
  - Pull request
  - Issue comment

After creating the app, generate a private key and copy the app ID, optional client ID, app slug, and webhook secret into your deployment environment.

## Configuration

Copy `.env.example` to `.env` for local development, or set equivalent environment variables in your host.

Required:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`
- `OPENCOMPUTER_API_KEY`

Common optional values:

- `GITHUB_CLIENT_ID`: recommended by GitHub for JWT `iss`; falls back to `GITHUB_APP_ID`.
- `GITHUB_APP_SLUG`: enables the install link on `/`.
- `PUBLIC_URL`: used to display the webhook URL on `/`.
- `ANTHROPIC_API_KEY`: passed to OpenComputer when creating the agent if no credential ID is configured.
- `OPENCOMPUTER_CREDENTIAL_ID`: reuse an existing OpenComputer model credential.
- `OPENCOMPUTER_AGENT_ID`: reuse an existing OpenComputer agent.
- `OPENCOMPUTER_AGENT_MODEL`: defaults to `anthropic/claude-opus-4-8`.
- `REVIEW_MAX_DIFF_CHARS`: defaults to `60000`.
- `REVIEW_DRAFT_PRS`: defaults to `false`.

## Local Run

```bash
npm test
npm start
```

The server will boot even before all secrets are configured. In that state `/healthz` returns `configured: false`, the home page lists missing variables, and webhook processing returns `503 setup incomplete`.

For local webhook testing, expose the server with a tunnel such as `ngrok`, set `PUBLIC_URL`, and point the GitHub App webhook URL at `PUBLIC_URL/webhooks/github`.

## Deploy

The service is a plain Node HTTP server. Any host that can run Node 20 and expose a public HTTPS URL should work.

### Fly.io

This repo includes [fly.toml](fly.toml) as the current primary deployment target.

```bash
flyctl apps create oc-pr-review-agent-digger-test0
flyctl deploy
```

Set runtime secrets with:

```bash
flyctl secrets set \
  GITHUB_APP_ID=... \
  GITHUB_PRIVATE_KEY_BASE64=... \
  GITHUB_WEBHOOK_SECRET=... \
  OPENCOMPUTER_API_KEY=... \
  ANTHROPIC_API_KEY=...
```

Once deployed, the public URL is:

```text
https://oc-pr-review-agent-digger-test0.fly.dev
```

`fly.toml` sets `PUBLIC_URL` to that host so the setup and manifest pages can generate correct callback and webhook URLs.

Use the deployed setup page to create a preconfigured GitHub App:

```text
https://oc-pr-review-agent-digger-test0.fly.dev/setup/github-app
```

This sends a GitHub App manifest with the required webhook URL, permissions, and events. GitHub redirects back with a temporary manifest code; exchange it within one hour to retrieve the app ID, private key, and webhook secret, then set those as Fly secrets.

### Docker

```bash
docker build -t opencomputer-pr-review-agent .
docker run --env-file .env -p 3000:3000 opencomputer-pr-review-agent
```

### Render

- Link this GitHub repo as a Render web service, or create the service from [render.yaml](render.yaml).
- Runtime: Node.
- Build command: `npm install`.
- Start command: `npm start`.
- Health check path: `/healthz`.
- The app uses Render's `RENDER_EXTERNAL_URL` automatically when `PUBLIC_URL` is not set.

Set all required secrets in the host dashboard, then configure the GitHub App webhook URL to the public service URL plus `/webhooks/github`.

## Operational Notes

- GitHub webhook requests return quickly; the review continues asynchronously inside the Node process.
- OpenComputer sessions are durable, but this first service does not yet persist a queue that can resume unfinished jobs after process restart.
- The sticky PR comment contains the OpenComputer session ID but not the session client token.
- The review comment is intentionally Markdown-only for now. Checks annotations and line comments are future improvements.
- GitHub App setup can start from `/setup/github-app`, which posts a preconfigured GitHub App manifest to GitHub.

## Current Deployment

- Public URL: `https://oc-pr-review-agent-digger-test0.fly.dev`
- Health: `https://oc-pr-review-agent-digger-test0.fly.dev/healthz`
- GitHub App setup: `https://oc-pr-review-agent-digger-test0.fly.dev/setup/github-app`
- Manifest JSON: `https://oc-pr-review-agent-digger-test0.fly.dev/setup/github-app/manifest`
- Current status: deployed, publicly reachable, and configured with required runtime secrets.

## Verification

Current local checks:

- `npm test`: 11 passing tests.
- `npm run lint`: Node syntax checks passed.

Current deployment checks:

- Fly machine `784459b274dd78` is `started`.
- `/` returns HTTP 200.
- `/healthz` returns HTTP 200 with `configured: true`.
- `/setup/github-app/manifest` returns the expected GitHub App manifest.
- PR #1 demo review completed successfully: `https://github.com/diggerhq/test-durable-0/pull/1`
- Demo OpenComputer session: `ses_8ab1c4c27a494fd2a5770365`

Secrets are present in Fly and in local `.env` for development. `.env` is ignored by git and must remain untracked.

## Tracking Docs

- [conversation-history.md](conversation-history.md) records user prompts and assistant response summaries.
- [opencomputer-dx-notes.md](opencomputer-dx-notes.md) records API and developer-experience observations from this build.
