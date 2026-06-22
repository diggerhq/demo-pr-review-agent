import type { Limits, OpenComputer, Session } from "@opencomputer/sdk";
import type { GitHubAppClient } from "./github.js";

export interface AppConfig {
  publicUrl: string;
  webhookPath: string;
  github: {
    appId: string;
    clientId: string;
    privateKey: string;
    webhookSecret: string;
    appSlug: string;
    apiVersion: string;
  };
  openComputer: {
    apiKey: string;
    baseUrl: string;
    agentId: string;
    agentName: string;
    webhookPath: string;
    webhookToken: string;
    credentialId: string;
    anthropicKey: string;
    model: string;
    limits: Limits;
  };
  review: {
    commandPrefix: string;
    includeDrafts: boolean;
    maxDiffChars: number;
    commentMaxChars: number;
  };
}

export interface GitHubRepository {
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
}

export interface GitHubPullRequest {
  number: number;
  title?: string;
  html_url?: string;
  body?: string | null;
  draft?: boolean;
  user?: {
    login?: string;
  };
  base?: {
    ref?: string;
    sha?: string;
  };
  head?: {
    ref?: string;
    sha?: string;
  };
}

export interface GitHubChangedFile {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface GitHubIssueComment {
  id: number;
  body?: string | null;
}

export interface GitHubWebhookPayload {
  action?: string;
  installation?: {
    id?: number;
  };
  repository: GitHubRepository;
  pull_request?: GitHubPullRequest;
  issue?: {
    number: number;
    pull_request?: unknown;
  };
  comment?: {
    body?: string;
  };
}

export interface ReviewServiceDeps {
  config: AppConfig;
  github: GitHubAppClient;
  openComputer: OpenComputer;
}

export type OpenComputerSession = Session;
