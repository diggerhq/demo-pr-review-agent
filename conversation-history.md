# Conversation History

This file keeps a human-readable trail of prompts, decisions, and checkpoints. It is intentionally lightweight: headings are reserved for meaningful phases, not every turn.

## Project Bootstrap

> User: "heres an empty repo. i want you to build a background agent here in it, using opencomputer.dev durable agent sessions apis. no other context on purpose - i want to simulate a new user. so make notes in the repo for potential improvements to APIs and agent experience if any"

I inspected the empty repo, fetched the OpenComputer docs index and Durable Agent Sessions API reference, and started evaluating the agent/session primitives. This led to the first tracking file for OpenComputer API and DX observations: [opencomputer-dx-notes.md](opencomputer-dx-notes.md).

> User: "what will the agent do? lets maybe discuss that also - how will users use it?"

I paused before writing implementation files and described a generic background coding-agent controller, where this repo would provide CLI commands for starting, following, steering, and reading OpenComputer durable sessions.

> User: "um no, we probabaly want to end up with a user-facing shape of some kind. like it can be used by a user who doesnt have the code. maybe PR reviewer? yes lets build a PR review background agent, why not. so people will install a github app into their repos and the agent would review their PRs. we obviously will need to deploy our agent somewhere so that there's a URL of the github app and its publicly accessible. BTW also please capture all my prompts and brief summaries of your responses in a separate markdown file in the repo - I want the history to be visible. and also if any DX issues with opencomputer already observed start a log for those (ok if not yet)"

We pivoted from a CLI controller to a deployable GitHub App service for PR review. The planned workflow became: GitHub PR webhook -> verify GitHub signature -> fetch PR metadata and diff -> start an OpenComputer durable session -> post a sticky review comment back to the PR. I added the initial tracking docs and pushed checkpoint [`a572700`](https://github.com/diggerhq/test-durable-0/commit/a572700).

## First Implementation Pass

> User: "good; pls keep making periodic updates to tracking docs and push to the repo frequently so that we have multiple checkpoints and have history of all decisions and turning points"

I committed to treating meaningful design turns as checkpoints, updating this log and [opencomputer-dx-notes.md](opencomputer-dx-notes.md), then committing and pushing coherent slices to `origin`.

> User: "also make a human-facing readme and keep it up to date. the md files lift to root level for usability, we might rearrange later. and push again."

I moved the markdown tracking files to the repository root, added the first human-facing [README.md](README.md), and added deployment/configuration scaffolding: [.env.example](.env.example), [Dockerfile](Dockerfile), and [render.yaml](render.yaml).

> User: "also conversation log can we make less \"heading noise\" somehow? those headings are repeated and not load-bearing. so maybe we just keep the paragraphs? then later we can introduce sections with headings for meaningful \"chapters\". also in summaries link to relevant files commits etc so that readers could see what was done etc."

I simplified this log into chapter-level sections with quoted prompts and narrative summaries, plus links to relevant files and commits. During local checks, `npm test` caught a comment truncation edge case in [src/prompts.js](src/prompts.js), which I fixed before preparing the next checkpoint. A review of the manual trigger path also found a prefix-collision issue, so `/oc-reviewer` is now rejected by [src/review.js](src/review.js) and covered by [test/review.test.js](test/review.test.js).
