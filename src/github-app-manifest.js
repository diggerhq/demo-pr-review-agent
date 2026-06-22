export function buildGitHubAppManifest({ publicUrl, webhookPath }) {
  if (!publicUrl) {
    return null;
  }

  return {
    name: "OpenComputer PR Reviewer",
    url: publicUrl,
    hook_attributes: {
      url: `${publicUrl}${webhookPath}`,
      active: true,
    },
    redirect_url: `${publicUrl}/setup/github-app/callback`,
    callback_urls: [publicUrl],
    setup_url: publicUrl,
    description: "Reviews GitHub pull requests in the background with OpenComputer Durable Agent Sessions.",
    public: false,
    request_oauth_on_install: false,
    default_permissions: {
      contents: "read",
      pull_requests: "read",
      issues: "write",
    },
    default_events: ["pull_request", "issue_comment"],
  };
}

export function githubManifestTarget(org = "") {
  const trimmed = org.trim();
  if (!trimmed) {
    return "https://github.com/settings/apps/new";
  }

  return `https://github.com/organizations/${encodeURIComponent(trimmed)}/settings/apps/new`;
}
