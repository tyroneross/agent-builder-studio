export class LocalLLM {
  constructor(options = {}) {
    this.mode = options.mode ?? process.env.AGENT_BUILDER_LLM ?? "auto";
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? "tinyllama:latest";
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.timeoutMs = Number(options.timeoutMs ?? process.env.AGENT_BUILDER_LLM_TIMEOUT_MS ?? 45000);
  }

  async status() {
    if (this.mode === "fixture") {
      return { mode: "fixture", available: true, model: "local-fixture" };
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 4000)),
      });
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      const body = await response.json();
      const models = body.models?.map((model) => model.name) ?? [];
      return {
        mode: "ollama",
        available: models.length > 0,
        model: models.includes(this.model) ? this.model : models[0],
        models,
      };
    } catch (error) {
      if (this.mode === "ollama") {
        throw new Error(`Ollama is not available at ${this.baseUrl}: ${error.message}`);
      }
      return { mode: "fixture", available: true, model: "local-fixture", fallbackReason: error.message };
    }
  }

  async generate({ system, prompt, schema }) {
    const status = await this.status();
    if (status.mode !== "ollama") {
      return {
        provider: "local-fixture",
        model: "fixture",
        text: fixtureResponse(prompt),
        parsed: {
          summary: fixtureResponse(prompt),
          artifacts: schema?.properties ? Object.keys(schema.properties) : [],
        },
      };
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: status.model,
        system,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama generation failed with ${response.status}`);
    }

    const body = await response.json();
    const text = body.response ?? "";
    return {
      provider: "ollama",
      model: status.model,
      text,
      parsed: parseJsonSafe(text),
      raw: body,
    };
  }
}

function fixtureResponse(prompt) {
  const firstLine = String(prompt).split("\n").find(Boolean) ?? "local agent run";
  return `Local fixture response for ${firstLine.slice(0, 90)}.`;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
