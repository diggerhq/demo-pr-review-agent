export class OpenComputerApiError extends Error {
  constructor(message, { status, method, path, details }) {
    super(message);
    this.name = "OpenComputerApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class OpenComputerClient {
  constructor({ apiKey, baseUrl }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.agentId = "";
  }

  async request(method, path, { body, headers = {} } = {}) {
    const requestHeaders = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...headers,
    };
    const init = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text();

    if (!response.ok) {
      let details = text;
      try {
        details = JSON.parse(text);
      } catch {
        // Keep the raw response body.
      }

      throw new OpenComputerApiError(`OpenComputer ${method} ${path} failed with ${response.status}`, {
        status: response.status,
        method,
        path,
        details,
      });
    }

    if (!text) {
      return null;
    }

    return JSON.parse(text);
  }

  async ensureAgent({ agentId, name, prompt, model, credentialId, anthropicKey, limits }) {
    if (agentId) {
      return agentId;
    }

    if (this.agentId) {
      return this.agentId;
    }

    const body = {
      name,
      runtime: "claude",
      model,
      prompt,
      limits,
    };

    if (credentialId) {
      body.credential = credentialId;
    } else if (anthropicKey) {
      body.key = anthropicKey;
    }

    const agent = await this.request("POST", "/agents", { body });
    this.agentId = agent.id;
    return agent.id;
  }

  createSession({ agent, input, key, limits, idempotencyKey }) {
    return this.request("POST", "/sessions", {
      body: {
        agent,
        input,
        key,
        limits,
      },
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    });
  }

  getResult(sessionId) {
    return this.request("GET", `/sessions/${sessionId}/result`);
  }

  eventContent(sessionId, eventId) {
    return this.request("GET", `/sessions/${sessionId}/events/${eventId}/content`);
  }

  async waitForResult(sessionId, { timeoutMs, pollIntervalMs }) {
    const deadline = Date.now() + timeoutMs;
    let lastResult = null;

    while (Date.now() < deadline) {
      lastResult = await this.getResult(sessionId);
      if (lastResult?.last_turn?.yield_reason) {
        return lastResult;
      }
      await sleep(pollIntervalMs);
    }

    const error = new Error(`Timed out waiting for OpenComputer session ${sessionId}`);
    error.lastResult = lastResult;
    throw error;
  }
}
