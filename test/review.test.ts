import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewCommand, parseReviewSessionKey, reviewSessionKey } from "../src/review.js";

test("parseReviewCommand accepts exact command and whitespace-delimited instructions", () => {
  assert.deepEqual(parseReviewCommand("/oc-review", "/oc-review"), {
    matched: true,
    instruction: "",
  });
  assert.deepEqual(parseReviewCommand("/oc-review focus on auth", "/oc-review"), {
    matched: true,
    instruction: "focus on auth",
  });
  assert.deepEqual(parseReviewCommand("/oc-review\nfocus on auth", "/oc-review"), {
    matched: true,
    instruction: "focus on auth",
  });
});

test("parseReviewCommand rejects prefix collisions", () => {
  assert.deepEqual(parseReviewCommand("/oc-reviewer", "/oc-review"), {
    matched: false,
    instruction: "",
  });
});

test("reviewSessionKey round-trips callback routing data", () => {
  const key = reviewSessionKey({
    delivery: "delivery:123",
    repository: {
      name: "widgets",
      full_name: "acme/widgets",
      owner: { login: "acme" },
    },
    pullRequest: {
      number: 42,
      head: { sha: "abc123" },
    },
  });

  assert.deepEqual(parseReviewSessionKey(key), {
    owner: "acme",
    repo: "widgets",
    pullNumber: 42,
    headSha: "abc123",
    delivery: "delivery:123",
  });
});

test("parseReviewSessionKey rejects unrelated or malformed keys", () => {
  assert.equal(parseReviewSessionKey("github:acme/widgets:pull:42"), null);
  assert.equal(parseReviewSessionKey("github-pr:v1:acme:widgets:nope:abc123:delivery"), null);
  assert.equal(parseReviewSessionKey("github-pr:v1:%:widgets:42:abc123:delivery"), null);
});
