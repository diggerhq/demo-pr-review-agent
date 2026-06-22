import { serve } from "@hono/node-server";
import { OpenComputer } from "@opencomputer/sdk";
import { loadConfig, missingRequiredConfig, webhookUrl } from "./config.js";
import { createApp } from "./app.js";
import { GitHubAppClient } from "./github.js";
import { JsonlStore } from "./store.js";
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
    store: new JsonlStore(),
  });

  return {
    app: createApp({ config, reviewService }),
    reviewService,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const missing = missingRequiredConfig(config);
  if (missing.length > 0) {
    console.warn("server starting with incomplete setup", { missing });
  }

  const { app } = createRuntime(config);
  serve({ fetch: app.fetch, port: config.port }, () => {
    console.info("server listening", {
      port: config.port,
      webhookUrl: webhookUrl(config),
    });
  });
}
