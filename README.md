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

Automatic reviews run for these `pull_request` actions:

- `opened`
- `reopened`
- `synchronize`
- `ready_for_review`

Draft PRs are ignored unless `REVIEW_DRAFT_PRS=true`. Manual reviews run from PR comments starting with `/oc-review`.

End-to-end flow:

1. GitHub sends a signed webhook to `POST /webhooks/github`.
2. The service verifies `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`.
3. The service quickly returns HTTP 202, then continues review work in the Node process.
4. It authenticates as the GitHub App installation and posts a queued sticky PR comment.
5. It fetches PR metadata, changed files, and the unified diff from GitHub.
6. It creates or reuses an OpenComputer agent and starts a durable session keyed by repo, PR number, and head SHA.
7. It polls the OpenComputer session result.
8. It updates the same PR comment with the final review or a failure message.

The OpenComputer task receives PR metadata, the PR body, changed-file summaries, and a truncated unified diff. It does not clone the repository yet.

## Moving Parts

- **GitHub App**: receives PR events and comments after installation in a repo.
- **Fly web service**: public Node HTTP app at `https://oc-pr-review-agent-digger-test0.fly.dev`.
- **GitHub API**: fetches PR data and creates or updates the sticky review comment.
- **OpenComputer Durable Agent Sessions**: runs the background review.
- **Model credential**: Anthropic key or OpenComputer credential used by the OpenComputer agent.
- **Local event log**: `data/reviews.jsonl` records review lifecycle events for development.

## Configure

Required environment variables:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`
- `OPENCOMPUTER_API_KEY`

Common optional values:

- `PUBLIC_URL`: public base URL used for setup pages and webhook hints.
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
npm start
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
