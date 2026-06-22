import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewCommand, parseReviewSessionMetadata, reviewSessionMetadata } from "../src/review.js";

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

test("reviewSessionMetadata captures callback routing data", () => {
  const metadata = reviewSessionMetadata({
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

  assert.deepEqual(parseReviewSessionMetadata(metadata), {
    source: "github-pr-review",
    owner: "acme",
    repo: "widgets",
    pullNumber: 42,
    headSha: "abc123",
    deliveryId: "delivery:123",
  });
});

test("parseReviewSessionMetadata rejects unrelated or malformed metadata", () => {
  assert.equal(parseReviewSessionMetadata({ source: "other" }), null);
  assert.equal(parseReviewSessionMetadata({
    source: "github-pr-review",
    owner: "acme",
    repo: "widgets",
    pullNumber: "42",
    headSha: "abc123",
    deliveryId: "delivery",
  }), null);
  assert.equal(parseReviewSessionMetadata({
    source: "github-pr-review",
    owner: "",
    repo: "widgets",
    pullNumber: 42,
    headSha: "abc123",
    deliveryId: "delivery",
  }), null);
});
