import { Hono } from "hono";
import { missingRequiredConfig, webhookUrl } from "./config.js";
import { verifyGitHubSignature } from "./security.js";
import { buildGitHubAppManifest, githubManifestTarget } from "./github-app-manifest.js";
import { githubAppCallbackPage, githubAppSetupPage, homePage } from "./views.js";
import type { AppConfig, GitHubWebhookPayload } from "./types.js";
import type { ReviewService } from "./review.js";

const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function readWebhookBody(request: Request): Promise<Buffer> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    throw httpError("Request body is too large", 413);
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_WEBHOOK_BYTES) {
    throw httpError("Request body is too large", 413);
  }

  return body;
}

export function createApp({ config, reviewService }: { config: AppConfig; reviewService: ReviewService }): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => {
    const missing = missingRequiredConfig(config);
    return c.json({ ok: true, configured: missing.length === 0, missing });
  });

  app.get("/", (c) => {
    return c.html(homePage({
      config,
      missing: missingRequiredConfig(config),
      webhookUrl: webhookUrl(config),
    }));
  });

  app.get("/setup/github-app", (c) => {
    const org = c.req.query("org") || "";
    const manifest = buildGitHubAppManifest({
      publicUrl: config.publicUrl,
      webhookPath: config.webhookPath,
    });

    return c.html(githubAppSetupPage({
      manifest,
      org,
      target: githubManifestTarget(org),
    }));
  });

  app.get("/setup/github-app/manifest", (c) => {
    const manifest = buildGitHubAppManifest({
      publicUrl: config.publicUrl,
      webhookPath: config.webhookPath,
    });

    return c.json(manifest || { ok: false, error: "missing public URL" }, manifest ? 200 : 503);
  });

  app.get("/setup/github-app/callback", (c) => {
    return c.html(githubAppCallbackPage(c.req.query("code") || ""));
  });

  app.post(config.webhookPath, async (c) => {
    const missing = missingRequiredConfig(config);
    if (missing.length > 0) {
      return c.json({ ok: false, error: "setup incomplete", missing }, 503);
    }

    const body = await readWebhookBody(c.req.raw);
    if (!verifyGitHubSignature(config.github.webhookSecret, body, c.req.header("x-hub-signature-256"))) {
      return c.json({ ok: false, error: "invalid signature" }, 401);
    }

    const result = reviewService.handleWebhook({
      event: c.req.header("x-github-event"),
      delivery: c.req.header("x-github-delivery"),
      payload: JSON.parse(body.toString("utf8")) as GitHubWebhookPayload,
    });

    return c.json({ ok: true, ...result }, result.accepted ? 202 : 200);
  });

  app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

  app.onError((error, c) => {
    console.error("request failed", error);
    return c.json({ ok: false, error: error.message }, ("statusCode" in error ? error.statusCode : 500) as 500);
  });

  return app;
}
