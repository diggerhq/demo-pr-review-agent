import type { AppConfig } from "./types.js";

type GitHubAppManifest = NonNullable<ReturnType<typeof import("./github-app-manifest.js").buildGitHubAppManifest>>;

function htmlEscape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(title)}</title>
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
    <main>${body}</main>
  </body>
</html>`;
}

export function homePage({ config, missing, webhookUrl }: { config: AppConfig; missing: string[]; webhookUrl: string }): string {
  const install = config.github.appSlug ? `https://github.com/apps/${config.github.appSlug}/installations/new` : "";
  const setupStatus = missing.length === 0
    ? "<p><strong>Status:</strong> configured and ready for GitHub webhooks.</p>"
    : `<p><strong>Status:</strong> setup pending. Missing: <code>${htmlEscape(missing.join(", "))}</code></p>`;

  return layout("OpenComputer PR Review Agent", `
      <h1>OpenComputer PR Review Agent</h1>
      <section class="panel">
        <p>This GitHub App reviews pull requests in the background using OpenComputer Durable Agent Sessions.</p>
        ${setupStatus}
        ${install ? `<a class="button" href="${htmlEscape(install)}">Install GitHub App</a>` : "<p>Set <code>GITHUB_APP_SLUG</code> to show an install link here.</p>"}
        ${config.publicUrl ? '<a class="button" href="/setup/github-app">Create GitHub App</a>' : ""}
        <p>Webhook endpoint: <code>${htmlEscape(webhookUrl)}</code></p>
        <p>Health endpoint: <code>/healthz</code></p>
        <p>Manual trigger: comment <code>${htmlEscape(config.review.commandPrefix)}</code> on a pull request.</p>
      </section>
  `);
}

export function githubAppSetupPage({
  manifest,
  org,
  target,
}: {
  manifest: GitHubAppManifest | null;
  org: string;
  target: string;
}): string {
  if (!manifest) {
    return layout("GitHub App Setup", `
      <h1>GitHub App Setup</h1>
      <section class="panel">
        <p>Set <code>PUBLIC_URL</code> before creating the GitHub App manifest.</p>
      </section>
    `);
  }

  const manifestJson = JSON.stringify(manifest);
  return layout("Create GitHub App", `
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
  `);
}

export function githubAppCallbackPage(code: string): string {
  return layout("GitHub App Manifest Callback", `
      <h1>GitHub App Created</h1>
      <section class="panel">
        <p>Exchange this manifest code within one hour to retrieve the app ID, private key, and webhook secret.</p>
        <pre>${htmlEscape(code || "No code was provided.")}</pre>
        <p>Then set the values with <code>flyctl secrets set</code>. Keep the returned private key and webhook secret out of git.</p>
      </section>
  `);
}
