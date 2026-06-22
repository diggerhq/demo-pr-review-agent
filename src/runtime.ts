import { OpenComputer } from "@opencomputer/sdk";
import { createApp } from "./app.js";
import { GitHubAppClient } from "./github.js";
import { ReviewService } from "./review.js";
import type { AppConfig } from "./types.js";

export function createRuntime(config: AppConfig): { app: ReturnType<typeof createApp>; reviewService: ReviewService } {
  const github = new GitHubAppClient(config.github);
  const openComputer = new OpenComputer({
    apiKey: config.openComputer.apiKey,
    baseUrl: config.openComputer.baseUrl,
  });
  const reviewService = new ReviewService({
    config,
    github,
    openComputer,
  });

  return {
    app: createApp({ config, reviewService }),
    reviewService,
  };
}
