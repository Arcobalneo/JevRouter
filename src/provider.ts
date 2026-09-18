import type {
  CapabilityManifest,
  JevChoiceAnswer,
  JevRawResponse,
  JevProvider,
  JevRouteRequest,
} from "./types.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clamp, sha256 } from "./utils.js";

export class JevProviderError extends Error {
  constructor(
    public readonly code: "jev_auth_error" | "jev_timeout" | "jev_malformed_response" | "jev_http_error",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "JevProviderError";
  }
}

export interface HttpJevProviderOptions {
  apiKey: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

export class HttpJevProvider implements JevProvider {
  readonly name = "typesafe";
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpJevProviderOptions) {
    this.endpoint = options.endpoint ?? "https://api.typesafe.ai/v1/systemone";
    this.model = options.model ?? "jev-latest";
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async decide(request: JevRouteRequest): Promise<JevRawResponse> {
    const criteria = Object.fromEntries(
      request.candidates.map((candidate) => [candidate.id, describeCapability(candidate)]),
    );
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: request.state,
        model: request.model ?? this.model,
        questions: {
          tool: {
            type: "choice",
            instructions: "Which single capability should handle this request? Choose only from the supplied options.",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new JevProviderError("jev_timeout", `Jev request timed out after ${this.timeoutMs}ms`);
      }
      throw new JevProviderError("jev_http_error", error instanceof Error ? error.message : String(error));
    });

    if (response.status === 401 || response.status === 403) {
      throw new JevProviderError("jev_auth_error", "Jev provider rejected the API key", response.status);
    }
    if (!response.ok) {
      const body = await response.text();
      throw new JevProviderError("jev_http_error", `Jev provider returned HTTP ${response.status}: ${body.slice(0, 240)}`, response.status);
    }
    const raw = (await response.json()) as unknown;
    if (!isJevRawResponse(raw)) throw new JevProviderError("jev_malformed_response", "Jev response is not an object");
    return raw;
  }
}

/** OpenRouter's native Decisions adapter. It uses the same typed request/response
 * shape as TypeSafe's endpoint, but through OpenRouter's alpha decisions route. */
export class OpenRouterJevProvider implements JevProvider {
  readonly name = "openrouter:~typesafe/jev-latest";
  constructor(
    private readonly apiKey: string,
    private readonly model = "~typesafe/jev-latest",
    private readonly timeoutMs = 20_000,
  ) {}

  async decide(request: JevRouteRequest): Promise<JevRawResponse> {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/jevrouter/jevrouter",
        "X-OpenRouter-Title": "JevRouter",
      },
      body: JSON.stringify({
        state: request.state,
        model: this.model,
        questions: {
          tool: {
            type: "choice",
            instructions: "Which single capability should handle this request? Choose only from the supplied options.",
            criteria: Object.fromEntries(request.candidates.map((candidate) => [candidate.id, describeCapability(candidate)])),
          },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "TimeoutError") throw new JevProviderError("jev_timeout", `OpenRouter request timed out after ${this.timeoutMs}ms`);
      throw new JevProviderError("jev_http_error", error instanceof Error ? error.message : String(error));
    });
    if (response.status === 401 || response.status === 403) throw new JevProviderError("jev_auth_error", "OpenRouter rejected the API key", response.status);
    if (!response.ok) throw new JevProviderError("jev_http_error", `OpenRouter returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`, response.status);
    const envelope = (await response.json()) as Record<string, unknown>;
    const answers = envelope.answers;
    if (!answers || typeof answers !== "object") throw new JevProviderError("jev_malformed_response", "OpenRouter Decisions response has no answers");
    return {
      ...envelope,
      model: typeof envelope.model === "string" ? envelope.model : this.model,
      answers: answers as Record<string, unknown>,
      usage: envelope.usage as Record<string, unknown> | undefined,
      _openrouter: { id: envelope.id, provider: "openrouter", model: envelope.model },
    };
  }
}

/** Persistent local cache keyed by the exact provider input and candidate snapshot. */
export class CachedJevProvider implements JevProvider {
  readonly name: string;
  constructor(
    private readonly inner: JevProvider,
    private readonly directory = ".jevrouter/.cache",
  ) {
    this.name = inner.name;
  }

  async decide(request: JevRouteRequest): Promise<JevRawResponse> {
    const key = sha256({ provider: this.inner.name, state: request.state, candidates: request.candidates });
    const path = join(this.directory, `${key.slice("sha256:".length)}.json`);
    try {
      return JSON.parse(await readFile(path, "utf8")) as JevRawResponse;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const response = await this.inner.decide(request);
    await mkdir(this.directory, { recursive: true });
    try {
      await writeFile(path, `${JSON.stringify(response)}\n`, { flag: "wx" });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return response;
  }
}

/** Offline provider for local demos. It is intentionally labelled and must not be treated as Jev. */
export class DemoProvider implements JevProvider {
  readonly name = "jevrouter-demo";

  async decide(request: JevRouteRequest): Promise<JevRawResponse> {
    const requestTokens = tokenize(request.state);
    const rawScores = request.candidates.map((candidate) => {
      const haystack = tokenize(`${candidate.id} ${candidate.name} ${candidate.description} ${(candidate.metadata?.tags ?? "") as string}`);
      const overlap = [...requestTokens].filter((token) => haystack.has(token)).length;
      const sourceBoost = candidate.type === "mcp_tool" ? 0.03 : 0;
      return { candidate, score: overlap + sourceBoost + 0.01 };
    });
    const total = rawScores.reduce((sum, item) => sum + item.score, 0);
    const probabilities = Object.fromEntries(rawScores.map(({ candidate, score }) => [candidate.id, score / total]));
    const choice = [...rawScores].sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))[0]?.candidate.id;
    const top = choice ? probabilities[choice] : 0;
    const confidence = rawScores.length <= 1
      ? 1
      : clamp((top - 1 / rawScores.length) / Math.max(1 - 1 / rawScores.length, 0.0001));
    return {
      model: "jevrouter-demo",
      answers: {
        tool: {
          type: "choice",
          choice,
          probabilities,
          confidence,
        },
      },
      usage: { input_tokens: request.state.length, output_tokens: 0 },
    };
  }
}

export function getChoiceAnswer(raw: JevRawResponse): JevChoiceAnswer {
  const answer = raw.answers?.tool;
  if (!answer || typeof answer !== "object") throw new JevProviderError("jev_malformed_response", "Jev response is missing answers.tool");
  const value = answer as Record<string, unknown>;
  if (value.type !== "choice" || typeof value.choice !== "string" || !value.probabilities || typeof value.probabilities !== "object") {
    throw new JevProviderError("jev_malformed_response", "answers.tool is not a Choice answer");
  }
  const probabilities: Record<string, number> = {};
  for (const [key, probability] of Object.entries(value.probabilities as Record<string, unknown>)) {
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new JevProviderError("jev_malformed_response", `Invalid probability for ${key}`);
    }
    probabilities[key] = probability;
  }
  const confidence = typeof value.confidence === "number" ? value.confidence : Math.max(...Object.values(probabilities), 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new JevProviderError("jev_malformed_response", "Invalid confidence");
  }
  return { ...(value as JevChoiceAnswer), type: "choice", choice: value.choice, probabilities, confidence };
}

function isJevRawResponse(value: unknown): value is JevRawResponse {
  return Boolean(value && typeof value === "object");
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function describeCapability(candidate: CapabilityManifest): string {
  const metadata = candidate.metadata ?? {};
  const keys = ["provider", "model", "latency_class", "cost_class", "context_tokens", "max_steps", "budget_tokens", "tags"];
  const hints = keys
    .filter((key) => metadata[key] !== undefined)
    .map((key) => `${key}=${String(metadata[key])}`)
    .join(", ");
  return `${candidate.name}: ${candidate.description} [type=${candidate.type}${hints ? `; ${hints}` : ""}]`;
}
