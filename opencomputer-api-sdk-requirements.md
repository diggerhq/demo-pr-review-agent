# OpenComputer API/SDK Requirements

Concrete API and SDK changes suggested by the PR-review agent example.

## Session Callback Metadata

The app needs a first-class way to attach small, opaque application routing state when creating an OpenComputer session. Today the example encodes this state into `session.key`, because the SDK exposes no separate `metadata`, `context`, `callbackContext`, or webhook payload field.

That works for a small demo, but `key` already has get-or-create semantics. Reusing a key with a changed request can fail with errors like `create key already used with a different request`, so it should not also be the recommended place for callback routing state.

Desired API shape:

```ts
const session = await oc.sessions.create({
  agent: agentId,
  input,
  key: stableBusinessKey,
  idempotencyKey: deliveryId,
  metadata: {
    source: "github-pr-review",
    owner: "acme",
    repo: "widgets",
    pullNumber: 42,
    headSha: "abc123",
    deliveryId,
  },
  destinations: [{
    url: "https://example.com/webhooks/opencomputer",
    types: ["turn.completed"],
  }],
});
```

Callback delivery should include the same metadata:

```json
{
  "type": "turn.completed",
  "sessionId": "ses_123",
  "eventId": "evt_123",
  "metadata": {
    "source": "github-pr-review",
    "owner": "acme",
    "repo": "widgets",
    "pullNumber": 42,
    "headSha": "abc123",
    "deliveryId": "github-delivery-id"
  }
}
```

The SDK should also expose the metadata on `session.snapshot.metadata` after `oc.sessions.get(sessionId)`.

## Requirements

- `metadata` must be separate from `key` and `idempotencyKey`.
- Metadata should be stored durably with the session.
- Metadata should be returned by `sessions.get`, and optionally by `sessions.list`.
- Metadata should be included verbatim in destination deliveries and redeliveries.
- Metadata should not be injected into the agent prompt or model-visible input unless explicitly requested.
- The API should document size limits, allowed JSON types, and whether metadata is indexed or queryable.
- The TypeScript SDK should type metadata as `Record<string, unknown>` or a generic parameter on `CreateSessionParams`.
- If multiple destinations can need different routing state, destination-level metadata should also be considered.

## Webhook Signing

The SDK types expose `secret` for `session.destinations.create({ secret })`, but the package README and type comments do not reveal the delivery signature headers or verification algorithm. The SDK should include:

- Official docs for signature header names, canonical payload bytes, algorithm, and timestamp/replay handling.
- A small verifier helper, for example `verifyOpenComputerWebhook({ secret, body, headers })`.
- An example server route that verifies a signed OpenComputer callback before calling `oc.sessions.get(sessionId)`.

## Example Impact

With first-class metadata, this repo could remove its parseable session-key workaround:

```ts
const route = payload.metadata;
const session = await oc.sessions.get(payload.sessionId);
const result = await session.result();
```

That is the ideal teaching shape for Durable Agent Sessions: create a durable run, attach app routing metadata, receive a signed callback, fetch the durable result, and update the external system.
