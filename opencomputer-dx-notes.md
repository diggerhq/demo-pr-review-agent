# OpenComputer DX Notes

Observations from building a PR-review GitHub App against the Durable Agent Sessions API as a new-user simulation.

## What Worked Well

- The `llms.txt` documentation index is useful for discovering the Durable Agent Sessions docs before choosing which pages to read.
- The REST API is easy to integrate without taking a dependency on the TypeScript SDK: agents, sessions, events, steering, and credentials all have direct endpoint mappings.
- The split between org API keys and session-scoped client tokens is clear, and the docs call out which token belongs on the server versus in a browser.
- The append-only event model with `seq`, `type`, and `yield_reason` is a good fit for resumable background work.

## Potential Improvements

- Provide a canonical "server-side worker" example that creates a session, waits for completion, and posts results somewhere external after the original HTTP request has returned.
- Document the exact behavior of idempotent `POST /agents` by name in the API reference, not only in the quickstart. It matters for application startup and deploy retries.
- Add a model discovery endpoint or a docs table of currently valid `model` strings. The quickstart gives one model value, but a new integrator has no obvious way to choose or validate alternatives.
- Offer a structured-output pattern for final results. PR review agents benefit from returning machine-readable findings plus Markdown, but the docs currently emphasize event text and final result events.
- Include a Durable Agent Sessions example for GitHub App or CI-review workflows. This integration pattern raises concrete questions about payload size, diff truncation, result posting, and webhook retries.
- Clarify recommended production patterns for long-running session completion: in-process polling, OpenComputer destinations/webhooks, queue workers, or some combination.
- First-class artifacts for patches, file annotations, and review reports would make PR review integrations cleaner once the artifacts API lands.

## Open Questions While Building

- Should session `key` be unique per PR head SHA, per PR number, or per GitHub delivery? The get-or-create behavior is powerful, but common application-level keying patterns would help.
- Is there a recommended maximum input size for a session task body? PR diffs need truncation, and the practical limits are not obvious from the first docs pass.
- Are there planned event types for code review findings or diffs that a GitHub App could map directly to PR comments or Checks annotations?

## Notes From Implementation

- The PR reviewer currently uses in-process polling of `GET /sessions/:id/result` after the GitHub webhook returns. This proves the integration, but a production deployment should probably use a queue plus OpenComputer destinations/webhooks so completion survives process restarts.
- The app sends PR metadata and a truncated unified diff as the session input instead of giving the OpenComputer runtime direct repository access. Workspaces or a documented "review this GitHub PR" example could make the richer version easier.
- Deployment testing benefits from a setup-pending mode because the public URL can be verified before GitHub App and model secrets are available. This is more an app pattern than an API issue, but first-party examples could call it out.
- The sandbox CLI path for deploying a private local repo was not obvious. Anonymous `git clone` failed because the repo is private, and an SSH-style `printf hi | oc exec ... tee file` test created an empty file. A documented `oc cp`, `oc files upload`, or `oc exec --stdin` pattern would make deployment-from-local much smoother.
