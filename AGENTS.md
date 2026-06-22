# Agent Guide

This repo is a demo GitHub App that reviews pull requests with OpenComputer Durable Agent Sessions. Treat this file as the entry point before changing code or docs.

## Project Map

- [README.md](README.md): human-facing overview, live test instructions, runtime flow, configuration, and deployment.
- [src/](src): TypeScript Worker application.
- [src/app.ts](src/app.ts): Hono routes for GitHub and OpenComputer webhooks.
- [src/review.ts](src/review.ts): PR-review orchestration, OpenComputer session creation, callback handling, and GitHub comment updates.
- [src/prompts.ts](src/prompts.ts): durable-session agent prompt and per-PR task construction.
- [src/github.ts](src/github.ts): GitHub App auth, PR/diff fetching, and sticky comments.
- [src/runtime.ts](src/runtime.ts): config and dependency wiring.
- [src/worker.ts](src/worker.ts): thin Cloudflare Worker adapter.
- [scripts/bootstrap-opencomputer-agent.ts](scripts/bootstrap-opencomputer-agent.ts): one-off/idempotent OpenComputer agent bootstrap/update script.
- [test/](test): focused Node test runner coverage.
- [wrangler.toml](wrangler.toml): Cloudflare Worker deployment defaults. Secrets live in Wrangler, not git.

## Agent Notes

- [.agents/conversation-history.md](.agents/conversation-history.md): chronological user prompts and assistant response summaries. Append new prompts and concise summaries as work proceeds.
- [.agents/opencomputer-dx-notes.md](.agents/opencomputer-dx-notes.md): observations about OpenComputer API, SDK, docs, and product/developer experience.
- [.agents/opencomputer-api-sdk-requirements.md](.agents/opencomputer-api-sdk-requirements.md): concrete API/SDK follow-ups suggested by this example.
- [.agents/private-repo-checkout-options.md](.agents/private-repo-checkout-options.md): private repository checkout problem statement and solution options.

Keep these files useful for a future agent joining midstream. Prefer concise notes with links to relevant files, commits, deployments, or docs.

## Architecture Opinions

- Keep the example small and direct. It should showcase OpenComputer Durable Agent Sessions, not a large app framework.
- Use TypeScript, Hono, Cloudflare Workers, and `@opencomputer/sdk`.
- Do not reintroduce a container server, local queue, database, or in-memory job state unless the user explicitly changes the product direction.
- OpenComputer session `metadata` is for non-secret callback routing state. Do not use it for credentials.
- Agent bootstrap is a setup step. Runtime webhook handling should reuse `OPENCOMPUTER_AGENT_ID` and create sessions.
- The app may await the short setup path inside the GitHub webhook request. The long-running review belongs to the OpenComputer session and completion webhook.
- Public repo checkout can be prompt-driven through OpenComputer hands tools. Private repo checkout needs a first-class source/workspace or checkout-only credential binding; do not pass GitHub tokens in prompts or shell-visible clone URLs.

## Operational Context

- GitHub repo: `diggerhq/demo-pr-review-agent`.
- Live Worker: `https://oc-pr-review.mo-b8f.workers.dev`.
- GitHub App: `https://github.com/apps/0x-test-pr-reviewer`.
- Cloudflare account for deploys: Mo's account, `b8f23cb87a7a6c64040d3134643da448`.
- Webhook URL: `https://oc-pr-review.mo-b8f.workers.dev/webhooks/github`.

## Secrets

- Never commit secrets. `.env` is gitignored and Wrangler secrets hold production values.
- Do not paste or preserve user-provided keys in `.agents/conversation-history.md`; summarize them as redacted.
- Before committing, run a secret scan:

```bash
rg -n "sk[-]ant|osb[_]|BEGIN RSA PRIVATE[ ]KEY|ANTHROPIC_API_KEY=s[k]|OPENCOMPUTER_API_KEY=o[s]b" . -g '!node_modules' -g '!dist-worker' -g '!.git'
```

The scan should return no matches.

## Commands

Use focused verification for the change:

```bash
npm run lint
npm test
npm run build
npx wrangler deploy --dry-run --outdir dist-worker
```

For deploys:

```bash
CLOUDFLARE_ACCOUNT_ID=b8f23cb87a7a6c64040d3134643da448 npm run deploy
curl -sS https://oc-pr-review.mo-b8f.workers.dev/healthz
```

Remove `dist-worker` after dry runs if it is created.

## Change Hygiene

- Preserve user changes in the worktree. Do not reset or revert unrelated files.
- Keep docs and code aligned. If behavior changes, update [README.md](README.md) and the relevant `.agents` note.
- For OpenComputer DX/API friction, update [.agents/opencomputer-dx-notes.md](.agents/opencomputer-dx-notes.md) or [.agents/opencomputer-api-sdk-requirements.md](.agents/opencomputer-api-sdk-requirements.md) immediately while the issue is fresh.
- The user wants frequent checkpoints. Commit and push coherent slices when changes are complete enough to stand on their own.
