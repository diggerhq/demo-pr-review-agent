import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewCommand } from "../src/review.js";

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
