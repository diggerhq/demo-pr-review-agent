import { signGitHubJwt } from "./security.js";

export class GitHubApiError extends Error {
  constructor(message, { status, method, path, details }) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.details = details;
  }
}

function encode(value) {
  return encodeURIComponent(value);
}

function repoPath(owner, repo) {
  return `/repos/${encode(owner)}/${encode(repo)}`;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return "";
  }

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }

  return "";
}

export class GitHubAppClient {
  constructor({ appId, clientId, privateKey, apiVersion }) {
    this.appId = appId;
    this.clientId = clientId || appId;
    this.privateKey = privateKey;
    this.apiVersion = apiVersion;
    this.apiBase = "https://api.github.com";
    this.installationTokens = new Map();
  }

  async request(method, path, { token, body, accept = "application/vnd.github+json", raw = false } = {}) {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const headers = {
      Accept: accept,
      "User-Agent": "opencomputer-pr-review-agent",
      "X-GitHub-Api-Version": this.apiVersion,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const init = {
      method,
      headers,
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const text = await response.text();

    if (!response.ok) {
      let details = text;
      try {
        details = JSON.parse(text);
      } catch {
        // Keep the raw response body.
      }

      throw new GitHubApiError(`GitHub ${method} ${path} failed with ${response.status}`, {
        status: response.status,
        method,
        path,
        details,
      });
    }

    if (raw) {
      return text;
    }

    if (!text) {
      return null;
    }

    return JSON.parse(text);
  }

  async requestPaginated(path, { token, accept } = {}) {
    let next = path;
    const items = [];

    while (next) {
      const url = next.startsWith("http") ? next : `${this.apiBase}${next}`;
      const response = await fetch(url, {
        headers: {
          Accept: accept || "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "opencomputer-pr-review-agent",
          "X-GitHub-Api-Version": this.apiVersion,
        },
      });
      const text = await response.text();

      if (!response.ok) {
        throw new GitHubApiError(`GitHub GET ${next} failed with ${response.status}`, {
          status: response.status,
          method: "GET",
          path: next,
          details: text,
        });
      }

      items.push(...JSON.parse(text));
      next = parseNextLink(response.headers.get("link"));
    }

    return items;
  }

  async installationToken(installationId) {
    const cacheKey = String(installationId);
    const cached = this.installationTokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const jwt = signGitHubJwt({
      issuer: this.clientId,
      privateKey: this.privateKey,
    });
    const response = await this.request("POST", `/app/installations/${installationId}/access_tokens`, {
      token: jwt,
      body: {},
    });
    const expiresAt = Date.parse(response.expires_at);

    this.installationTokens.set(cacheKey, {
      token: response.token,
      expiresAt,
    });

    return response.token;
  }

  getPullRequest({ token, owner, repo, pullNumber }) {
    return this.request("GET", `${repoPath(owner, repo)}/pulls/${pullNumber}`, { token });
  }

  getPullRequestDiff({ token, owner, repo, pullNumber }) {
    return this.request("GET", `${repoPath(owner, repo)}/pulls/${pullNumber}`, {
      token,
      accept: "application/vnd.github.v3.diff",
      raw: true,
    });
  }

  listPullRequestFiles({ token, owner, repo, pullNumber }) {
    return this.requestPaginated(`${repoPath(owner, repo)}/pulls/${pullNumber}/files?per_page=100`, {
      token,
    });
  }

  listIssueComments({ token, owner, repo, issueNumber }) {
    return this.requestPaginated(`${repoPath(owner, repo)}/issues/${issueNumber}/comments?per_page=100`, {
      token,
    });
  }

  createIssueComment({ token, owner, repo, issueNumber, body }) {
    return this.request("POST", `${repoPath(owner, repo)}/issues/${issueNumber}/comments`, {
      token,
      body: { body },
    });
  }

  updateIssueComment({ token, owner, repo, commentId, body }) {
    return this.request("PATCH", `${repoPath(owner, repo)}/issues/comments/${commentId}`, {
      token,
      body: { body },
    });
  }

  async upsertStickyIssueComment({ token, owner, repo, issueNumber, marker, body }) {
    const comments = await this.listIssueComments({ token, owner, repo, issueNumber });
    const existing = [...comments].reverse().find((comment) => comment.body?.includes(marker));

    if (existing) {
      return this.updateIssueComment({
        token,
        owner,
        repo,
        commentId: existing.id,
        body,
      });
    }

    return this.createIssueComment({
      token,
      owner,
      repo,
      issueNumber,
      body,
    });
  }
}
