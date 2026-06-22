import type { Limits, OpenComputer, Session } from "@opencomputer/sdk";
import type { Hono } from "hono";
import type { GitHubAppClient } from "./github.js";
import type { JsonlStore } from "./store.js";

export interface AppConfig {
  port: number;
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
    credentialId: string;
    anthropicKey: string;
    model: string;
    limits: Limits;
  };
  review: {
    commandPrefix: string;
    includeDrafts: boolean;
    maxDiffChars: number;
    waitTimeoutMs: number;
    pollIntervalMs: number;
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
  store: JsonlStore;
}

export interface Runtime {
  app: Hono;
  reviewService: unknown;
}

export type OpenComputerSession = Session;
