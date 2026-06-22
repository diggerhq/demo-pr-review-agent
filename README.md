# OpenComputer PR Review Agent

A deployable GitHub App webhook service that reviews pull requests in the background with OpenComputer Durable Agent Sessions.

The user-facing shape is:

1. You deploy this service to a public URL.
2. You register a GitHub App whose webhook points at that URL.
3. A repository owner installs the GitHub App on their repos.
4. Pull request events trigger an OpenComputer durable agent session.
5. The service posts a sticky review comment back to the PR when the session completes.

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
  - Pull requests: read
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

Docker:

```bash
docker build -t opencomputer-pr-review-agent .
docker run --env-file .env -p 3000:3000 opencomputer-pr-review-agent
```

Render-style hosts can use:

```bash
npm start
```

Set all required secrets in the host dashboard, then configure the GitHub App webhook URL to the public service URL plus `/webhooks/github`.

## Operational Notes

- GitHub webhook requests return quickly; the review continues asynchronously inside the Node process.
- OpenComputer sessions are durable, but this first service does not yet persist a queue that can resume unfinished jobs after process restart.
- The sticky PR comment contains the OpenComputer session ID but not the session client token.
- The review comment is intentionally Markdown-only for now. Checks annotations and line comments are future improvements.

## Verification

Current local checks for implementation checkpoint [`2ba71a3`](https://github.com/diggerhq/test-durable-0/commit/2ba71a3):

- `npm test`: 7 passing tests.
- `npm run lint`: Node syntax checks passed.

## Tracking Docs

- [conversation-history.md](conversation-history.md) records user prompts and assistant response summaries.
- [opencomputer-dx-notes.md](opencomputer-dx-notes.md) records API and developer-experience observations from this build.
