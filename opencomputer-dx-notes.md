# OpenComputer DX Notes

Observations from building a PR-review GitHub App against the Durable Agent Sessions API as a new-user simulation.

## What Worked Well

- The `llms.txt` documentation index is useful for discovering the Durable Agent Sessions docs before choosing which pages to read.
- The REST API is easy to integrate without taking a dependency on the TypeScript SDK: agents, sessions, events, steering, and credentials all have direct endpoint mappings.
- The split between org API keys and session-scoped client tokens is clear, and the docs call out which token belongs on the server versus in a browser.
- The append-only event model with `seq`, `type`, and `yield_reason` is a good fit for resumable background work.
- The `@opencomputer/sdk` TypeScript types expose a clean Durable Agent Sessions surface: `OpenComputer`, `agents.create`, `sessions.create`, and `session.result()`.
- The SDK's camelCase request/response shape is nicer in application code than raw REST snake_case, especially for `limits.turnSeconds`, `lastTurn`, and `yieldReason`.

## Potential Improvements

- Provide a canonical "server-side worker" example that creates a session, waits for completion, and posts results somewhere external after the original HTTP request has returned.
- Document the exact behavior of idempotent `POST /agents` by name in the API reference, not only in the quickstart. It matters for application startup and deploy retries.
- Add a model discovery endpoint or a docs table of currently valid `model` strings. The quickstart gives one model value, but a new integrator has no obvious way to choose or validate alternatives.
- Offer a structured-output pattern for final results. PR review agents benefit from returning machine-readable findings plus Markdown, but the docs currently emphasize event text and final result events.
- Include a Durable Agent Sessions example for GitHub App or CI-review workflows. This integration pattern raises concrete questions about payload size, diff truncation, result posting, and webhook retries.
- Clarify recommended production patterns for long-running session completion: in-process polling, OpenComputer destinations/webhooks, queue workers, or some combination.
- First-class artifacts for patches, file annotations, and review reports would make PR review integrations cleaner once the artifacts API lands.
- Make the npm README for `@opencomputer/sdk` lead with, or at least prominently include, the Durable Agent Sessions API. The current package README is sandbox-first, even though the same package is the right SDK for `OpenComputer` sessions.
- Clarify package naming. Discovering both `@opencomputer/sdk` and `@opencomputer/agents-sdk` makes it easy for a new user to pick the older/wrong package unless docs explicitly say `@opencomputer/sdk` is the current path.
- Add a migration note showing raw REST field names versus SDK camelCase names. Moving from REST to SDK changed `turn_seconds` to `turnSeconds`, `last_turn` to `lastTurn`, and `yield_reason` to `yieldReason`.

## Open Questions While Building

- Should session `key` be unique per PR head SHA, per PR number, or per GitHub delivery? The get-or-create behavior is powerful, but common application-level keying patterns would help.
- Is there a recommended maximum input size for a session task body? PR diffs need truncation, and the practical limits are not obvious from the first docs pass.
- Are there planned event types for code review findings or diffs that a GitHub App could map directly to PR comments or Checks annotations?

## Notes From Implementation

- The PR reviewer currently uses in-process polling of `GET /sessions/:id/result` after the GitHub webhook returns. This proves the integration, but a production deployment should probably use a queue plus OpenComputer destinations/webhooks so completion survives process restarts.
- The app sends PR metadata and a truncated unified diff as the session input instead of giving the OpenComputer runtime direct repository access. Workspaces or a documented "review this GitHub PR" example could make the richer version easier.
- Deployment testing benefits from a setup-pending mode because the public URL can be verified before GitHub App and model secrets are available. This is more an app pattern than an API issue, but first-party examples could call it out.
- The sandbox CLI path for deploying a private local repo was not obvious. Anonymous `git clone` failed because the repo is private, and an SSH-style `printf hi | oc exec ... tee file` test created an empty file. A documented `oc cp`, `oc files upload`, or `oc exec --stdin` pattern would make deployment-from-local much smoother.
- The user pushed back on using a sandbox as the deployment target. That was valid: Durable Agent Sessions are the app's background-agent backend, but the GitHub App webhook service itself should live on a normal public app host. Fly.io is the current deployment target for this repo.
- After comparing available authenticated hosts, Fly.io was selected for the actual public app deployment because it matches the service shape: a persistent Node web process with webhook handling and asynchronous polling. This is a better deployment fit than Cloudflare Workers for the current code.
- GitHub App creation is another setup friction point: there is no installed `gh app` command here, and the GitHub App Manifest flow still requires browser approval plus a manifest-code exchange. The app now includes a manifest setup page to reduce manual configuration.
- Host public URL discovery varies by provider. Fly needed an explicit `PUBLIC_URL` in `fly.toml` so generated GitHub App manifests contain the correct webhook and callback URLs.
- Fly deployment initially left a machine stuck in `created`/`replacing` after an interrupted deploy and repeated 408s. Destroying the stuck machine and redeploying with `--ha=false` produced a healthy single-machine deployment for this prototype.
- The conversation log needs an explicit redaction policy for user-provided secrets. For this repo, prompts that include keys are summarized with `[redacted]`, while operational proof is captured via secret names, deployment status, and health checks only.
- The first PR test showed a product-experience issue: GitHub webhook delivery succeeded with 202, but the PR stayed visually idle because the app only posted a comment after diff fetch and OpenComputer session creation. For demo and debugging, a PR-review app should post a queued/progress comment as soon as it accepts work.
- GitHub's issue-comment permission behavior on pull requests is easy to under-specify. The docs say "Issues: write" or "Pull requests: write" can create issue comments, but the app received `403 Resource not accessible by integration` with `Issues: write` and `Pull requests: read` on a PR conversation. The response header included `issues=write; pull_requests=write`; requesting Pull requests write in the manifest is the safer default for this app.
- GitHub App registration permissions and installation permissions can diverge after a permission change. Updating the app to `pull_requests: write` did not update the existing `diggerhq` installation until the installation permissions are explicitly approved in GitHub.
- Once the installation permission update was accepted, redelivering the existing `/oc-review` webhook was enough to complete the end-to-end flow. This is a useful recovery/debug path for setup issues: fix permissions, redeliver, then inspect the sticky PR comment and session ID.
- README and deployment docs can drift during iterative prototyping. The repo had an early alternate-host blueprint and provider-specific URL fallback left over after Fly became the real deployment target; active docs and code now point at Fly only.
- The REST API was simple enough that a no-dependency client wrapper was faster than introducing the SDK for this prototype. SDK adoption would be more compelling with an official server-side PR-review example, documented retry/idempotency behavior, typed result/event helpers, and a clear "use SDK vs raw HTTP" decision guide.
- The refactor to `@opencomputer/sdk@0.7.1` removed the local OpenComputer HTTP wrapper cleanly. The SDK already handles auth, retries for safe/idempotent calls, JSON normalization, and typed session handles.
- SDK examples should show the durable-session polling pattern directly: create or get an agent, create a session with `idempotencyKey`, call `session.result()` until `lastTurn.yieldReason`, then post the result somewhere external.
- OpenComputer examples should foreground the small set of SDK calls and app responsibilities before diving into deployment or provider glue. For this PR-review app, the important reader takeaway is: webhook arrives, fetch context, `oc.sessions.create(...)`, poll `session.result()`, post the result.
