interface ManifestInput {
  publicUrl: string;
  webhookPath: string;
}

interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  description: string;
  public: boolean;
  request_oauth_on_install: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

export function buildGitHubAppManifest({ publicUrl, webhookPath }: ManifestInput): GitHubAppManifest | null {
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
      pull_requests: "write",
      issues: "write",
    },
    default_events: ["pull_request", "issue_comment"],
  };
}

export function githubManifestTarget(org = ""): string {
  const trimmed = org.trim();
  if (!trimmed) {
    return "https://github.com/settings/apps/new";
  }

  return `https://github.com/organizations/${encodeURIComponent(trimmed)}/settings/apps/new`;
}
