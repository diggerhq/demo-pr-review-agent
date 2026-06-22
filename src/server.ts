import { serve } from "@hono/node-server";
import { loadConfig, missingRequiredConfig, webhookUrl } from "./config.js";
import { createRuntime } from "./runtime.js";

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
