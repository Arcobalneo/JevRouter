export type CapabilityType = "skill" | "mcp_tool" | "cli" | "dsh" | "model" | "subagent";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type DecisionStatus = "selected" | "needs_confirmation" | "no_decision";

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  [key: string]: unknown;
}

export interface CapabilityManifest {
  id: string;
  name: string;
  type: CapabilityType;
  version?: string;
  description: string;
  input_schema?: JsonSchema;
  output_schema?: JsonSchema;
  permissions?: string[];
  risk?: {
    level: RiskLevel;
    categories?: string[];
  };
  availability?: {
    available?: boolean;
    reason?: string;
    command?: string;
    healthcheck?: boolean;
  };
  execution?: {
    mode: "mcp" | "cli" | "skill" | "dsh" | "model" | "subagent" | "custom";
    target?: string;
    dry_run?: boolean;
  };
  policy?: {
    requires_confirmation?: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface OpenAIFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
  };
}

export interface AgentToolDescriptor {
  name: string;
  description?: string;
  input_schema?: JsonSchema;
  inputSchema?: JsonSchema;
}

export type CapabilityInput = CapabilityManifest | OpenAIFunctionTool | AgentToolDescriptor;

export interface RouteInput {
  request: string;
  context?: Record<string, unknown>;
  actor?: string;
  actor_permissions?: string[];
  input?: unknown;
  /** Optional candidates supplied by an Agent at call time. */
  candidates?: CapabilityInput[];
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  [key: string]: unknown;
}

export interface JevRawResponse {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JevChoiceQuestion {
  instructions?: string;
}

export interface JevRouteRequest {
  state: string;
  candidates: CapabilityManifest[];
  model?: string;
  /** Optional batch of Choice questions keyed by name (e.g. step1..stepN).
   * When omitted, providers ask the single default `tool` question. */
  questions?: Record<string, JevChoiceQuestion>;
}

export interface JevProvider {
  readonly name: string;
  decide(request: JevRouteRequest): Promise<JevRawResponse>;
}

export interface RouterPolicy {
  min_confidence?: number;
  single_stage_max_candidates?: number;
  top_k?: number;
  allowed_risk_levels?: RiskLevel[];
  required_permissions?: string[];
  confirmation_risk_levels?: RiskLevel[];
  allow_unavailable_fallback?: boolean;
}

export interface RouterCandidate {
  id: string;
  type: CapabilityType;
  name: string;
  jev_probability: number | null;
  jev_confidence: number | null;
  jev_stage: "single" | "coarse" | "final" | null;
  router_rank: number | null;
  router: {
    available: boolean;
    allowed: boolean;
    risk_level: RiskLevel;
    requires_confirmation: boolean;
    filtered: boolean;
    filter_reason: string | null;
  };
}

export interface RouteResult {
  request_id: string;
  decision_id: string;
  mode: "decision_only";
  status: DecisionStatus;
  decision: {
    kind: "choice";
    question: string;
    selected: string | null;
    jev_choice: string | null;
    candidates: RouterCandidate[];
    input?: unknown;
    input_validation?: {
      valid: boolean;
      errors: string[];
    } | null;
  };
  fallback: {
    type: "manual_review" | "provider_error" | "no_safe_candidate" | "low_confidence" | null;
    reason: string | null;
  };
  execution: {
    enabled: false;
    status: "not_started";
  };
  raw_jev: JevRawResponse | null;
  raw_jev_stages?: Array<{
    stage: "coarse" | "final";
    response: JevRawResponse;
  }>;
  provenance: {
    jev_provider: string;
    candidate_snapshot_hash: string;
    policy_hash: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export type PlanMode = "batch" | "serial";

/** One step of a multi-step plan: a full routing decision plus its step index (1-based). */
export interface RoutePlanStep extends RouteResult {
  step: number;
}

export interface RoutePlanResult {
  plan_id: string;
  mode: PlanMode;
  steps: RoutePlanStep[];
  /** Batch mode: the single provider envelope covering all step questions.
   * Serial mode: null (each step keeps its own raw_jev). */
  raw_jev: JevRawResponse | null;
  provenance: {
    jev_provider: string;
    candidate_snapshot_hash: string;
    policy_hash: string;
  };
}
