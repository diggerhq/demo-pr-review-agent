import { createServer } from "node:http";
import { loadConfig, missingRequiredConfig, webhookUrl } from "./config.js";
import { GitHubAppClient } from "./github.js";
import { OpenComputerClient } from "./opencomputer.js";
import { JsonlStore } from "./store.js";
import { ReviewService } from "./review.js";
import { logger, serializeError } from "./log.js";
import { verifyGitHubSignature } from "./security.js";
import { buildGitHubAppManifest, githubManifestTarget } from "./github-app-manifest.js";

const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_WEBHOOK_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function installUrl(config) {
  if (!config.github.appSlug) {
    return "";
  }

  return `https://github.com/apps/${config.github.appSlug}/installations/new`;
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function homePage(config) {
  const install = installUrl(config);
  const setupHref = config.publicUrl ? "/setup/github-app" : "";
  const missing = missingRequiredConfig(config);
  const setupStatus = missing.length === 0
    ? "<p><strong>Status:</strong> configured and ready for GitHub webhooks.</p>"
    : `<p><strong>Status:</strong> setup pending. Missing: <code>${htmlEscape(missing.join(", "))}</code></p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenComputer PR Review Agent</title>
    <style>
      body { color: #151515; font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f6f7f9; }
      main { margin: 0 auto; max-width: 760px; padding: 48px 20px; }
      code { background: #e9edf3; border-radius: 4px; padding: 2px 5px; }
      a.button { background: #151515; border-radius: 6px; color: white; display: inline-block; font-weight: 650; margin: 16px 0; padding: 10px 14px; text-decoration: none; }
      .panel { background: white; border: 1px solid #dce1e8; border-radius: 8px; padding: 20px; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenComputer PR Review Agent</h1>
      <div class="panel">
        <p>This GitHub App reviews pull requests in the background using OpenComputer Durable Agent Sessions.</p>
        ${setupStatus}
        ${install ? `<a class="button" href="${htmlEscape(install)}">Install GitHub App</a>` : "<p>Set <code>GITHUB_APP_SLUG</code> to show an install link here.</p>"}
        ${setupHref ? `<a class="button" href="${setupHref}">Create GitHub App</a>` : ""}
        <p>Webhook endpoint: <code>${htmlEscape(webhookUrl(config))}</code></p>
        <p>Health endpoint: <code>/healthz</code></p>
        <p>Manual trigger: comment <code>${htmlEscape(config.review.commandPrefix)}</code> on a pull request.</p>
      </div>
    </main>
  </body>
</html>`;
}

function githubAppSetupPage(config, org = "") {
  const manifest = buildGitHubAppManifest({
    publicUrl: config.publicUrl,
    webhookPath: config.webhookPath,
  });

  if (!manifest) {
    return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>GitHub App Setup</title></head>
  <body>
    <h1>GitHub App Setup</h1>
    <p>Set <code>PUBLIC_URL</code> or deploy on a host that provides <code>RENDER_EXTERNAL_URL</code> before creating the GitHub App manifest.</p>
  </body>
</html>`;
  }

  const target = githubManifestTarget(org);
  const manifestJson = JSON.stringify(manifest);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Create GitHub App</title>
    <style>
      body { color: #151515; font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f6f7f9; }
      main { margin: 0 auto; max-width: 760px; padding: 48px 20px; }
      code, pre { background: #e9edf3; border-radius: 4px; padding: 2px 5px; }
      pre { overflow: auto; padding: 12px; }
      button, a.button { background: #151515; border: 0; border-radius: 6px; color: white; cursor: pointer; display: inline-block; font: inherit; font-weight: 650; margin: 8px 0; padding: 10px 14px; text-decoration: none; }
      input { border: 1px solid #c7ced8; border-radius: 6px; font: inherit; padding: 8px 10px; }
      .panel { background: white; border: 1px solid #dce1e8; border-radius: 8px; margin-bottom: 16px; padding: 20px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Create GitHub App</h1>
      <section class="panel">
        <p>This form sends a preconfigured GitHub App manifest to GitHub.</p>
        <form method="get" action="/setup/github-app">
          <label>Organization slug, optional: <input name="org" value="${htmlEscape(org)}" placeholder="my-org"></label>
          <button type="submit">Set target</button>
        </form>
        <form method="post" action="${htmlEscape(target)}">
          <input type="hidden" name="manifest" value="${htmlEscape(manifestJson)}">
          <button type="submit">Create app ${org ? `in ${htmlEscape(org)}` : "in personal account"}</button>
        </form>
      </section>
      <section class="panel">
        <p>After GitHub redirects back with a <code>code</code>, exchange it within one hour, then set the returned app ID, webhook secret, and private key as Fly secrets.</p>
        <p>Manifest JSON is also available at <a href="/setup/github-app/manifest">/setup/github-app/manifest</a>.</p>
        <pre>${htmlEscape(JSON.stringify(manifest, null, 2))}</pre>
      </section>
    </main>
  </body>
</html>`;
}

function githubAppCallbackPage(url) {
  const code = url.searchParams.get("code") || "";

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>GitHub App Manifest Callback</title></head>
  <body>
    <main style="font: 16px/1.5 system-ui, sans-serif; margin: 48px auto; max-width: 760px;">
      <h1>GitHub App Created</h1>
      <p>Exchange this manifest code within one hour to retrieve the app ID, private key, and webhook secret.</p>
      <pre style="background: #e9edf3; padding: 12px; overflow: auto;">${htmlEscape(code || "No code was provided.")}</pre>
      <p>Then set the values with <code>flyctl secrets set</code>. Keep the returned private key and webhook secret out of git.</p>
    </main>
  </body>
</html>`;
}

export function createApp({ config, reviewService }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && url.pathname === "/healthz") {
        const missing = missingRequiredConfig(config);
        sendJson(response, 200, { ok: true, configured: missing.length === 0, missing });
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, 200, homePage(config));
        return;
      }

      if (request.method === "GET" && url.pathname === "/setup/github-app") {
        sendHtml(response, 200, githubAppSetupPage(config, url.searchParams.get("org") || ""));
        return;
      }

      if (request.method === "GET" && url.pathname === "/setup/github-app/manifest") {
        const manifest = buildGitHubAppManifest({
          publicUrl: config.publicUrl,
          webhookPath: config.webhookPath,
        });
        sendJson(response, manifest ? 200 : 503, manifest || { ok: false, error: "missing public URL" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/setup/github-app/callback") {
        sendHtml(response, 200, githubAppCallbackPage(url));
        return;
      }

      if (request.method === "POST" && url.pathname === config.webhookPath) {
        const missing = missingRequiredConfig(config);
        if (missing.length > 0) {
          sendJson(response, 503, {
            ok: false,
            error: "setup incomplete",
            missing,
          });
          return;
        }

        const body = await readBody(request);
        const signature = request.headers["x-hub-signature-256"];

        if (!verifyGitHubSignature(config.github.webhookSecret, body, signature)) {
          sendJson(response, 401, { ok: false, error: "invalid signature" });
          return;
        }

        const event = request.headers["x-github-event"];
        const delivery = request.headers["x-github-delivery"];
        const payload = JSON.parse(body.toString("utf8"));
        const result = reviewService.handleWebhook({ event, delivery, payload });

        sendJson(response, result.accepted ? 202 : 200, {
          ok: true,
          ...result,
        });
        return;
      }

      sendJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      logger.error("request failed", { error: serializeError(error) });
      sendJson(response, error.statusCode || 500, {
        ok: false,
        error: error.message,
      });
    }
  });
}

export function createRuntime(config) {
  const github = new GitHubAppClient(config.github);
  const openComputer = new OpenComputerClient(config.openComputer);
  const store = new JsonlStore();
  const reviewService = new ReviewService({
    config,
    github,
    openComputer,
    store,
    logger,
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
    logger.warn("server starting with incomplete setup", { missing });
  }

  const { app } = createRuntime(config);
  app.listen(config.port, () => {
    logger.info("server listening", {
      port: config.port,
      webhookUrl: webhookUrl(config),
    });
  });
}
