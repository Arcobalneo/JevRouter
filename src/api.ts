import { CapabilityRegistry, defaultPolicy, normalizeCapability } from "./manifest.js";
import { CachedJevProvider, DemoProvider, HttpJevProvider, OpenRouterJevProvider } from "./provider.js";
import { JevRouter } from "./router.js";
import type { CapabilityInput, CapabilityManifest, JevProvider, RouteInput, RouteResult, RouterPolicy } from "./types.js";

export interface RouteOptions {
  candidates?: CapabilityInput[];
  capabilityDir?: string;
  apiKey?: string;
  provider?: "typesafe" | "openrouter" | "demo";
  endpoint?: string;
  model?: string;
  policy?: RouterPolicy;
  cache?: boolean;
}

/**
 * One-call SDK entrypoint. Pass candidates directly, or let it load the local
 * .jevrouter/capabilities registry. API keys are read from the environment.
 */
export async function route(input: RouteInput, options: RouteOptions = {}): Promise<RouteResult> {
  const rawCandidates = options.candidates ?? input.candidates ?? await new CapabilityRegistry(options.capabilityDir ?? ".jevrouter/capabilities").list();
  const candidates = rawCandidates.map((candidate, index) => normalizeCapability(candidate, `candidates[${index}]`));
  const provider = createProvider(options);
  return new JevRouter(provider, { ...defaultPolicy, ...(options.policy ?? {}) }).route(input, candidates);
}

export function createSdkProvider(options: RouteOptions = {}): JevProvider {
  return createProvider(options);
}

function createProvider(options: RouteOptions): JevProvider {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY ?? process.env.OPENROUTER_API_KEY;
  let provider: JevProvider;
  if (options.provider === "demo" || (!apiKey && !options.provider)) {
    provider = new DemoProvider();
  } else {
    if (!apiKey) throw new Error("Set JEV_API_KEY/TYPESAFE_API_KEY or pass apiKey");
    const openrouter = options.provider === "openrouter" || (!options.provider && Boolean(process.env.OPENROUTER_API_KEY) && !process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY);
    provider = openrouter
      ? new OpenRouterJevProvider(apiKey, options.model ?? "~typesafe/jev-latest")
      : new HttpJevProvider({ apiKey, endpoint: options.endpoint, model: options.model ?? "jev-latest" });
  }
  return options.cache === false || process.env.JEV_ROUTER_CACHE === "0" ? provider : new CachedJevProvider(provider);
}
