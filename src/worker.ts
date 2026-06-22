import { loadConfig, missingRequiredConfig, webhookUrl } from "./config.js";
import { createRuntime } from "./runtime.js";

type WorkerEnv = Record<string, string | undefined>;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const config = loadConfig(env);
    const missing = missingRequiredConfig(config);
    if (missing.length > 0) {
      console.warn("worker handling request with incomplete setup", { missing });
    }

    const { app } = createRuntime(config);
    console.info("worker handling request", {
      method: request.method,
      url: new URL(request.url).pathname,
      webhookUrl: webhookUrl(config),
    });

    return app.fetch(request);
  },
};
