import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, missingRequiredConfig } from "../src/config.js";

test("missingRequiredConfig reports required deploy secrets without throwing", () => {
  const config = loadConfig({});

  assert.deepEqual(missingRequiredConfig(config), [
    "GITHUB_APP_ID",
    "GITHUB_CLIENT_ID or GITHUB_APP_ID",
    "GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_BASE64",
    "GITHUB_WEBHOOK_SECRET",
    "OPENCOMPUTER_API_KEY",
    "OPENCOMPUTER_AGENT_ID",
    "PUBLIC_URL",
    "OPENCOMPUTER_WEBHOOK_TOKEN",
  ]);
});

test("missingRequiredConfig accepts a fully configured service", () => {
  const config = loadConfig({
    GITHUB_APP_ID: "123",
    GITHUB_PRIVATE_KEY: "key",
    GITHUB_WEBHOOK_SECRET: "secret",
    OPENCOMPUTER_API_KEY: "oc_key",
    OPENCOMPUTER_AGENT_ID: "agt_123",
    PUBLIC_URL: "https://agent.example.com",
    OPENCOMPUTER_WEBHOOK_TOKEN: "token",
  });

  assert.deepEqual(missingRequiredConfig(config), []);
});
