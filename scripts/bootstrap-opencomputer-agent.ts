import { readFile } from "node:fs/promises";
import { OpenComputer } from "@opencomputer/sdk";
import { loadConfig } from "../src/config.js";
import { REVIEW_AGENT_PROMPT } from "../src/prompts.js";

async function loadDotEnv(path = ".env"): Promise<void> {
  try {
    const raw = await readFile(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      process.env[key] ??= rawValue.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

await loadDotEnv();

const config = loadConfig();
if (!config.openComputer.apiKey) {
  throw new Error("OPENCOMPUTER_API_KEY is required");
}

const oc = new OpenComputer({
  apiKey: config.openComputer.apiKey,
  baseUrl: config.openComputer.baseUrl,
});

const existing = await oc.agents.list({ limit: 100 });
const agent = existing.data.find((item) => item.name === config.openComputer.agentName) || await oc.agents.create({
  name: config.openComputer.agentName,
  runtime: "claude",
  model: config.openComputer.model,
  prompt: REVIEW_AGENT_PROMPT,
  credential: config.openComputer.credentialId || undefined,
  key: config.openComputer.credentialId ? undefined : config.openComputer.anthropicKey || undefined,
  limits: config.openComputer.limits,
});

console.log(`OpenComputer agent ready: ${agent.id}`);
console.log(`Set OPENCOMPUTER_AGENT_ID=${agent.id}`);
