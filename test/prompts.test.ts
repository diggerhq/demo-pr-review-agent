import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewTask, truncateText, limitCommentBody } from "../src/prompts.js";

test("truncateText keeps head and tail with an omission marker", () => {
  const source = "a".repeat(70) + "b".repeat(70);
  const result = truncateText(source, 100);

  assert.equal(result.truncated, true);
  assert.equal(result.omittedChars, 40);
  assert.match(result.text, /Diff truncated/);
  assert.match(result.text, /^a+/);
  assert.match(result.text, /b+$/);
});

test("buildReviewTask includes PR context and untrusted-content warning", () => {
  const task = buildReviewTask({
    repository: { full_name: "acme/widgets", name: "widgets", owner: { login: "acme" } },
    pullRequest: {
      number: 12,
      title: "Fix widget cache",
      html_url: "https://github.com/acme/widgets/pull/12",
      body: "Please review",
      draft: false,
      user: { login: "octo" },
      base: { ref: "main", sha: "base-sha" },
      head: { ref: "feature", sha: "head-sha" },
    },
    files: [{ filename: "src/cache.js", status: "modified", additions: 4, deletions: 2 }],
    diff: "diff --git a/src/cache.js b/src/cache.js",
    maxDiffChars: 1000,
  });

  assert.match(task, /Repository: acme\/widgets/);
  assert.match(task, /Untrusted pull request body/);
  assert.match(task, /src\/cache.js/);
});

test("limitCommentBody caps long comments", () => {
  const limited = limitCommentBody("x".repeat(100), 60);

  assert.equal(limited.length, 60);
  assert.match(limited, /Review truncated/);
});
