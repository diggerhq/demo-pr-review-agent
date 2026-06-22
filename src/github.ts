import { signGitHubJwt } from "./security.js";
import type { AppConfig, GitHubChangedFile, GitHubIssueComment, GitHubPullRequest } from "./types.js";

export class GitHubApiError extends Error {
  status: number;
  method: string;
  path: string;
  details: unknown;

  constructor(message: string, { status, method, path, details }: { status: number; method: string; path: string; details: unknown }) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.details = details;
  }
}

type GitHubConfig = AppConfig["github"];

interface RequestOptions {
  token?: string;
  body?: unknown;
  accept?: string;
  raw?: boolean;
}

interface RepoRequest {
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
}

interface IssueRequest {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
}

interface RepositoryInstallationRequest {
  owner: string;
  repo: string;
}

function encode(value: string | number): string {
  return encodeURIComponent(value);
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encode(owner)}/${encode(repo)}`;
}

function parseNextLink(linkHeader: string | null): string {
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
  appId: string;
  clientId: string;
  privateKey: string;
  apiVersion: string;
  apiBase: string;
  installationTokens: Map<string, { token: string; expiresAt: number }>;

  constructor({ appId, clientId, privateKey, apiVersion }: GitHubConfig) {
    this.appId = appId;
    this.clientId = clientId || appId;
    this.privateKey = privateKey;
    this.apiVersion = apiVersion;
    this.apiBase = "https://api.github.com";
    this.installationTokens = new Map();
  }

  async request(method: string, path: string, { token, body, accept = "application/vnd.github+json", raw = false }: RequestOptions = {}): Promise<any> {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "opencomputer-pr-review-agent",
      "X-GitHub-Api-Version": this.apiVersion,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const init: RequestInit = {
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

  async requestPaginated<T>(path: string, { token, accept }: { token: string; accept?: string }): Promise<T[]> {
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

      items.push(...(JSON.parse(text) as T[]));
      next = parseNextLink(response.headers.get("link"));
    }

    return items;
  }

  async installationToken(installationId: number | undefined): Promise<string> {
    if (!installationId) {
      throw new Error("GitHub webhook payload did not include an installation id");
    }

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

  async repositoryInstallation({ owner, repo }: RepositoryInstallationRequest): Promise<{ id: number }> {
    const jwt = signGitHubJwt({
      issuer: this.clientId,
      privateKey: this.privateKey,
    });

    return this.request("GET", `${repoPath(owner, repo)}/installation`, { token: jwt });
  }

  async installationTokenForRepository({ owner, repo }: RepositoryInstallationRequest): Promise<string> {
    const installation = await this.repositoryInstallation({ owner, repo });
    return this.installationToken(installation.id);
  }

  getPullRequest({ token, owner, repo, pullNumber }: RepoRequest): Promise<GitHubPullRequest> {
    return this.request("GET", `${repoPath(owner, repo)}/pulls/${pullNumber}`, { token });
  }

  getPullRequestDiff({ token, owner, repo, pullNumber }: RepoRequest): Promise<string> {
    return this.request("GET", `${repoPath(owner, repo)}/pulls/${pullNumber}`, {
      token,
      accept: "application/vnd.github.v3.diff",
      raw: true,
    });
  }

  listPullRequestFiles({ token, owner, repo, pullNumber }: RepoRequest): Promise<GitHubChangedFile[]> {
    return this.requestPaginated<GitHubChangedFile>(`${repoPath(owner, repo)}/pulls/${pullNumber}/files?per_page=100`, {
      token,
    });
  }

  listIssueComments({ token, owner, repo, issueNumber }: IssueRequest): Promise<GitHubIssueComment[]> {
    return this.requestPaginated<GitHubIssueComment>(`${repoPath(owner, repo)}/issues/${issueNumber}/comments?per_page=100`, {
      token,
    });
  }

  createIssueComment({ token, owner, repo, issueNumber, body }: IssueRequest & { body: string }): Promise<GitHubIssueComment> {
    return this.request("POST", `${repoPath(owner, repo)}/issues/${issueNumber}/comments`, {
      token,
      body: { body },
    });
  }

  updateIssueComment({
    token,
    owner,
    repo,
    commentId,
    body,
  }: {
    token: string;
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): Promise<GitHubIssueComment> {
    return this.request("PATCH", `${repoPath(owner, repo)}/issues/comments/${commentId}`, {
      token,
      body: { body },
    });
  }

  async upsertStickyIssueComment({
    token,
    owner,
    repo,
    issueNumber,
    marker,
    body,
  }: IssueRequest & { marker: string; body: string }): Promise<GitHubIssueComment> {
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
