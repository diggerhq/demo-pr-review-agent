import type { AppConfig } from "./types.js";

type Env = Record<string, string | undefined>;

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function normalizePrivateKey(env: Env): string {
  if (env.GITHUB_PRIVATE_KEY_BASE64) {
    return Buffer.from(env.GITHUB_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }

  if (!env.GITHUB_PRIVATE_KEY) {
    return "";
  }

  return env.GITHUB_PRIVATE_KEY.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

export function loadConfig(env: Env = process.env): AppConfig {
  const webhookPath = env.WEBHOOK_PATH || "/webhooks/github";
  const publicUrl = (env.PUBLIC_URL || "").replace(/\/$/, "");

  return {
    port: integer(env.PORT, 3000),
    publicUrl,
    webhookPath,
    github: {
      appId: env.GITHUB_APP_ID || "",
      clientId: env.GITHUB_CLIENT_ID || env.GITHUB_APP_ID || "",
      privateKey: normalizePrivateKey(env),
      webhookSecret: env.GITHUB_WEBHOOK_SECRET || "",
      appSlug: env.GITHUB_APP_SLUG || "",
      apiVersion: env.GITHUB_API_VERSION || "2026-03-10",
    },
    openComputer: {
      apiKey: env.OPENCOMPUTER_API_KEY || "",
      baseUrl: (env.OPENCOMPUTER_BASE_URL || "https://api.opencomputer.dev/v3").replace(/\/$/, ""),
      agentId: env.OPENCOMPUTER_AGENT_ID || "",
      agentName: env.OPENCOMPUTER_AGENT_NAME || "opencomputer-pr-reviewer",
      webhookPath: env.OPENCOMPUTER_WEBHOOK_PATH || "/webhooks/opencomputer",
      webhookToken: env.OPENCOMPUTER_WEBHOOK_TOKEN || "",
      credentialId: env.OPENCOMPUTER_CREDENTIAL_ID || "",
      anthropicKey: env.ANTHROPIC_API_KEY || "",
      model: env.OPENCOMPUTER_AGENT_MODEL || "anthropic/claude-opus-4-8",
      limits: {
        turns: integer(env.OPENCOMPUTER_LIMIT_TURNS, 1),
        turnSeconds: integer(env.OPENCOMPUTER_LIMIT_TURN_SECONDS, 600),
        tokens: integer(env.OPENCOMPUTER_LIMIT_TOKENS, 120000),
      },
    },
    review: {
      commandPrefix: env.REVIEW_COMMAND_PREFIX || "/oc-review",
      includeDrafts: bool(env.REVIEW_DRAFT_PRS, false),
      maxDiffChars: integer(env.REVIEW_MAX_DIFF_CHARS, 60000),
      waitTimeoutMs: integer(env.REVIEW_WAIT_TIMEOUT_MS, 20 * 60 * 1000),
      pollIntervalMs: integer(env.REVIEW_POLL_INTERVAL_MS, 5000),
      commentMaxChars: integer(env.REVIEW_COMMENT_MAX_CHARS, 62000),
    },
  };
}

export function missingRequiredConfig(config: AppConfig): string[] {
  const missing: string[] = [];

  if (!config.github.appId) missing.push("GITHUB_APP_ID");
  if (!config.github.clientId) missing.push("GITHUB_CLIENT_ID or GITHUB_APP_ID");
  if (!config.github.privateKey) missing.push("GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_BASE64");
  if (!config.github.webhookSecret) missing.push("GITHUB_WEBHOOK_SECRET");
  if (!config.openComputer.apiKey) missing.push("OPENCOMPUTER_API_KEY");
  if (!config.openComputer.agentId) missing.push("OPENCOMPUTER_AGENT_ID");
  if (!config.publicUrl) missing.push("PUBLIC_URL");
  if (!config.openComputer.webhookToken) missing.push("OPENCOMPUTER_WEBHOOK_TOKEN");

  return missing;
}

export function validateConfig(config: AppConfig): void {
  const missing = missingRequiredConfig(config);

  if (missing.length > 0) {
    const error = new Error(`Missing required environment variables: ${missing.join(", ")}`) as Error & { missing?: string[] };
    error.missing = missing;
    throw error;
  }
}

export function webhookUrl(config: AppConfig): string {
  if (!config.publicUrl) {
    return config.webhookPath;
  }

  return `${config.publicUrl}${config.webhookPath}`;
}
