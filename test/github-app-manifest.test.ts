import test from "node:test";
import assert from "node:assert/strict";
import { buildGitHubAppManifest, githubManifestTarget } from "../src/github-app-manifest.js";

test("buildGitHubAppManifest creates the PR reviewer GitHub App manifest", () => {
  const manifest = buildGitHubAppManifest({
    publicUrl: "https://agent.example.com",
    webhookPath: "/webhooks/github",
  });
  assert.ok(manifest);

  assert.equal(manifest.hook_attributes.url, "https://agent.example.com/webhooks/github");
  assert.equal(manifest.default_permissions.contents, "read");
  assert.equal(manifest.default_permissions.pull_requests, "write");
  assert.equal(manifest.default_permissions.issues, "write");
  assert.deepEqual(manifest.default_events, ["pull_request", "issue_comment"]);
});

test("githubManifestTarget supports personal and organization app creation", () => {
  assert.equal(githubManifestTarget(), "https://github.com/settings/apps/new");
  assert.equal(
    githubManifestTarget("diggerhq"),
    "https://github.com/organizations/diggerhq/settings/apps/new",
  );
});
