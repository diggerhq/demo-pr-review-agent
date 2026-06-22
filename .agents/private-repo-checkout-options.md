# Private Repository Checkout Options

This note captures the private-repository checkout problem for a GitHub App powered by OpenComputer Durable Agent Sessions.

## Problem

The demo can ask an OpenComputer agent to inspect public repositories by passing repository URLs, refs, SHAs, changed-file metadata, and a diff. The agent can then use hands-sandbox tools such as `use_repo`, `bash`, `read`, and `ls`.

Private repositories need a different boundary. The GitHub App receives the PR webhook and has permission to read the repository, but the OpenComputer session runs in a third-party managed environment. The app needs to let the session check out code without exposing private-repo credentials to:

- The model.
- Prompt text or durable session transcripts.
- Arbitrary shell commands.
- Process-wide environment variables.
- Shell history, command output, or logs.
- `.git/config` remote URLs.
- Final PR comments or other user-visible output.

PR contents are untrusted. A malicious PR can contain prompt injection that asks the agent to print credentials, inspect environment variables, or read config files. Checkout privilege therefore needs to be a control-plane or tool-scoped capability, not a normal string in the agent's context.

## GitHub Primitive

GitHub Apps already provide a short-lived credential for this:

1. GitHub sends the app an event with `installation.id`.
2. The app verifies the webhook signature.
3. The app signs a GitHub App JWT with its private key.
4. The app calls `POST /app/installations/{installation_id}/access_tokens`.
5. The app can request a token narrowed to specific `repository_ids` and permissions.
6. With `contents: read`, the token can authenticate HTTPS Git clone/fetch.
7. The token expires after one hour and can be revoked earlier.

Relevant GitHub docs:

- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Choosing permissions for Git access](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

The token is short-lived and scopeable, but it is still a real credential. The API design question is how to give OpenComputer enough authority to check out the repository while keeping the credential out of model-visible and shell-visible paths.

## Requirements

A production-quality OpenComputer API for this should:

- Bind checkout access to one session.
- Scope access to one repo and preferably one PR/head SHA.
- Accept an expiration timestamp and reject expired credentials before checkout starts.
- Keep the credential out of prompts, transcripts, general logs, final results, and model-visible tool output.
- Avoid writing the token into `.git/config`; if HTTPS Git is used internally, use a credential helper or equivalent redaction boundary.
- Make the credential available only to a constrained checkout/fetch tool, not arbitrary `bash`.
- Support callback routing through normal session `metadata`, separately from secrets.
- Let the app audit which session used which repository source without storing the raw token.

## Option 1: First-Class GitHub PR Source

OpenComputer accepts a typed PR source and performs checkout before or during session startup.

```ts
await oc.sessions.create({
  agent: agentId,
  input: "Review this PR. The checked-out workspace is authoritative; use the diff as a map.",
  metadata: callbackRoute,
  sources: [{
    type: "github.pull_request",
    owner,
    repo,
    pullNumber,
    headSha,
    baseSha,
    auth: {
      type: "github_app_installation_token",
      token: oc.secret(installationToken),
      expiresAt,
      permissions: { contents: "read", pull_requests: "read" },
      repositoryIds: [repositoryId],
    },
    checkout: { ref: headSha },
  }],
  destinations: [{ url: callbackUrl, types: ["turn.completed"] }],
});
```

Pros:

- Best developer experience for GitHub App authors.
- Makes private checkout an explicit session capability.
- Gives OpenComputer room to redact, audit, and constrain credential use.
- Keeps the task prompt focused on review instructions, not credential mechanics.

Cons:

- Requires new API and SDK surface.
- OpenComputer must own secure checkout behavior and token redaction guarantees.

This is the preferred product/API shape.

## Option 2: OpenComputer GitHub Connector

The app or user installs/connects GitHub directly to OpenComputer. The session references an installation or connector handle instead of passing a token.

```ts
await oc.sessions.create({
  agent: agentId,
  input,
  metadata: callbackRoute,
  sources: [{
    type: "github.pull_request",
    owner,
    repo,
    pullNumber,
    headSha,
    baseSha,
    auth: {
      type: "opencomputer.github_connector",
      installationId,
    },
  }],
});
```

Pros:

- The app never handles a token intended for OpenComputer.
- OpenComputer can mint just-in-time tokens and rotate/revoke internally.
- Good long-term shape for managed integrations.

Cons:

- More onboarding complexity: users must grant OpenComputer or an OpenComputer-owned app repository access.
- Less ideal for examples where the user's app is meant to be the GitHub App of record.

## Option 3: Token Broker Grant

The app does not pass a GitHub token. Instead, it passes a one-time grant that lets OpenComputer call back to the app's token broker. The broker verifies audience, session, repo, PR, SHA, and expiry, then returns a narrowly scoped installation token.

```ts
await oc.sessions.create({
  agent: agentId,
  input,
  metadata: callbackRoute,
  sources: [{
    type: "github.pull_request",
    owner,
    repo,
    pullNumber,
    headSha,
    auth: {
      type: "token_broker",
      url: "https://app.example.com/opencomputer/github-token",
      audience: "opencomputer",
      oneTimeGrant,
      expiresAt,
    },
  }],
});
```

Pros:

- App controls policy and can mint the GitHub token just in time.
- OpenComputer can avoid storing a GitHub token in the session-create request.
- Good bridge before a full connector exists.

Cons:

- Requires the app to host and secure a token-broker endpoint.
- Needs request signing, replay protection, and clear failure semantics.
- Still requires OpenComputer to guarantee that the fetched token only reaches the checkout tool.

## Option 4: Prebuilt Workspace Attachment

The app prepares a workspace or sandbox through a privileged API, checks out the repository itself, then starts a managed session attached to that workspace.

```ts
const workspace = await oc.workspaces.create();
await oc.workspaces.sources.checkout(workspace.id, {
  type: "github.pull_request",
  owner,
  repo,
  pullNumber,
  headSha,
  auth: { type: "github_app_installation_token", token: oc.secret(installationToken) },
});

await oc.sessions.create({
  agent: agentId,
  input,
  metadata: callbackRoute,
  workspace: workspace.id,
});
```

Pros:

- Clean separation between workspace preparation and agent execution.
- Useful beyond GitHub PRs: uploaded tarballs, generated projects, monorepos, cached dependency layers.

Cons:

- More moving parts for the simple PR-review case.
- The demo starts to look like workspace orchestration instead of a small durable-session handoff.

## Option 5: Raw Token In Prompt Or Shell

The app passes a clone URL like `https://x-access-token:TOKEN@github.com/owner/repo.git` in the session prompt or asks the agent to use it in `bash`.

Pros:

- Works with today's GitHub and generic shell APIs.

Cons:

- The token is model-visible or shell-visible.
- It can land in transcripts, logs, command history, `.git/config`, or final output.
- Prompt injection from the PR can try to exfiltrate it.
- This is not an acceptable production pattern.

This option should be avoided except maybe for a local throwaway experiment with explicitly disposable credentials.

## Recommended Direction

For OpenComputer, the best first-class API is `sources` on `oc.sessions.create`.

The application should pass PR identity, refs, SHAs, and either a write-only secret token or a token-broker grant. OpenComputer should use that credential only inside a constrained checkout/fetch path, then start the agent with a prepared workspace and no credential exposure.

The agent should receive:

- A checked-out working tree.
- PR metadata and review instructions.
- The diff as a map/fallback.
- No raw GitHub token.

The app should keep using session `metadata` for callback routing. Metadata is for non-secret routing state; source credentials are a separate capability.

## Short-Term Demo Position

This repo currently supports public-repository checkout by prompt and hands-sandbox tools. For private repositories, the demo should continue to send PR metadata and the diff until OpenComputer has a first-class source/workspace credential surface. Adding raw GitHub tokens to prompts or shell commands would undermine the point of the example.
