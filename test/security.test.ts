import test from "node:test";
import assert from "node:assert/strict";
import { verifyGitHubSignature } from "../src/security.js";

test("verifies GitHub's documented sha256 webhook signature example", () => {
  const secret = "It's a Secret to Everybody";
  const payload = Buffer.from("Hello, World!", "utf8");
  const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

  assert.equal(verifyGitHubSignature(secret, payload, signature), true);
});

test("rejects missing or mismatched webhook signatures", () => {
  const secret = "It's a Secret to Everybody";
  const payload = Buffer.from("Hello, World!", "utf8");

  assert.equal(verifyGitHubSignature(secret, payload, ""), false);
  assert.equal(verifyGitHubSignature(secret, payload, "sha256=bad"), false);
});
