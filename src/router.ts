import type {
  CapabilityManifest,
  JevChoiceAnswer,
  JevRawResponse,
  JevProvider,
  PlanMode,
  RouteInput,
  RoutePlanResult,
  RoutePlanStep,
  RouteResult,
  RouterCandidate,
  RouterPolicy,
  RiskLevel,
} from "./types.js";
import { defaultPolicy } from "./manifest.js";
import { getChoiceAnswer, JevProviderError } from "./provider.js";
import { clamp, compactError, requestId, sha256, validateJsonInput } from "./utils.js";

export const MAX_PLAN_STEPS = 10;

export function stepQuestionKey(step: number): string {
  return `step${step}`;
}

export function stepQuestionInstructions(step: number): string {
  return `Which single capability should be called at step ${step} when handling this request? Choose only from the supplied options.`;
}

interface DecidedAnswer {
  answer: JevChoiceAnswer;
  probabilityById: Map<string, number>;
  confidenceById: Map<string, number>;
  stageById: Map<string, "single" | "coarse" | "final">;
  raw_jev: JevRawResponse | null;
  raw_jev_stages?: RouteResult["raw_jev_stages"];
}

export class JevRouter {
  constructor(
    private readonly provider: JevProvider,
    private readonly policy: RouterPolicy = defaultPolicy,
  ) {}

  async route(input: RouteInput, candidates: CapabilityManifest[]): Promise<RouteResult> {
    const ordered = sortCandidates(candidates);
    const base = this.baseResult(ordered);

    if (ordered.length === 0) {
      return {
        ...base,
        status: "no_decision",
        decision: { kind: "choice", question: "Which single capability should handle this request?", selected: null, jev_choice: null, candidates: [] },
        fallback: { type: "no_safe_candidate", reason: "No capability candidates were supplied" },
        raw_jev: null,
      };
    }

    let decided: DecidedAnswer;
    try {
      decided = await this.decideWithStages(renderState(input), ordered);
    } catch (error) {
      return this.errorResult(base, input, error, ordered);
    }
    return this.finalize(base, input, ordered, decided);
  }

  /**
   * Multi-step routing plan. Batch mode asks all step questions in a single
   * provider call (limited to single_stage_max_candidates). Serial mode runs
   * one full routing decision per step and feeds the selected capabilities
   * forward in the state so later steps are conditioned on earlier ones.
   */
  async plan(input: RouteInput, candidates: CapabilityManifest[], options: { steps?: number; mode?: PlanMode } = {}): Promise<RoutePlanResult> {
    const steps = options.steps ?? 3;
    const mode = options.mode ?? "serial";
    if (!Number.isInteger(steps) || steps < 1 || steps > MAX_PLAN_STEPS) {
      throw new Error(`plan steps must be an integer between 1 and ${MAX_PLAN_STEPS}, got ${steps}`);
    }
    const ordered = sortCandidates(candidates);
    const outcome = mode === "batch"
      ? await this.planBatch(input, ordered, steps)
      : await this.planSerial(input, ordered, steps);
    return {
      plan_id: requestId("plan"),
      mode,
      steps: outcome.steps,
      raw_jev: outcome.raw,
      provenance: {
        jev_provider: this.provider.name,
        candidate_snapshot_hash: sha256(ordered),
        policy_hash: sha256(this.policy),
      },
    };
  }

  private async planBatch(input: RouteInput, ordered: CapabilityManifest[], steps: number): Promise<{ steps: RoutePlanStep[]; raw: JevRawResponse | null }> {
    const maxSingleStage = Math.max(1, this.policy.single_stage_max_candidates ?? defaultPolicy.single_stage_max_candidates ?? 32);
    if (ordered.length > maxSingleStage) {
      throw new Error(`batch plan mode supports at most ${maxSingleStage} candidates (single_stage_max_candidates), got ${ordered.length}; use serial mode for larger candidate sets`);
    }
    const questions = Object.fromEntries(
      Array.from({ length: steps }, (_, index) => [stepQuestionKey(index + 1), { instructions: stepQuestionInstructions(index + 1) }]),
    );
    let raw: JevRawResponse;
    try {
      raw = await this.provider.decide({ state: renderState(input), candidates: ordered, questions });
    } catch (error) {
      const stepsOnError = Array.from({ length: steps }, (_, index) => ({
        step: index + 1,
        ...this.errorResult(this.baseResult(ordered), input, error, ordered),
      }));
      return { steps: stepsOnError, raw: null };
    }
    const stepResults: RoutePlanStep[] = [];
    for (let step = 1; step <= steps; step++) {
      const base = this.baseResult(ordered);
      try {
        const answer = getChoiceAnswer(raw, stepQuestionKey(step));
        stepResults.push({ step, ...this.finalize(base, input, ordered, singleStageDecision(answer, ordered, null), stepQuestionInstructions(step)) });
      } catch (error) {
        stepResults.push({ step, ...this.errorResult(base, input, error, ordered) });
      }
    }
    return { steps: stepResults, raw };
  }

  private async planSerial(input: RouteInput, ordered: CapabilityManifest[], steps: number): Promise<{ steps: RoutePlanStep[]; raw: null }> {
    const completed: string[] = [];
    const stepResults: RoutePlanStep[] = [];
    for (let step = 1; step <= steps; step++) {
      const request = completed.length
        ? `${input.request}\n\nCapabilities already routed in previous steps, in order: ${completed.join(", ")}.`
        : input.request;
      const result = await this.route({ ...input, request }, ordered);
      stepResults.push({ step, ...result });
      if (result.decision.selected) completed.push(result.decision.selected);
    }
    return { steps: stepResults, raw: null };
  }

  private baseResult(ordered: CapabilityManifest[]) {
    return {
      request_id: requestId("req"),
      decision_id: requestId("dec"),
      mode: "decision_only" as const,
      execution: { enabled: false as const, status: "not_started" as const },
      provenance: {
        jev_provider: this.provider.name,
        candidate_snapshot_hash: sha256(ordered),
        policy_hash: sha256(this.policy),
      },
    };
  }

  private errorResult(base: ReturnType<JevRouter["baseResult"]>, input: RouteInput, error: unknown, ordered: CapabilityManifest[]): RouteResult {
    const providerError = error instanceof JevProviderError ? error : new JevProviderError("jev_http_error", compactError(error));
    return {
      ...base,
      status: "no_decision",
      decision: { kind: "choice", question: "Which single capability should handle this request?", selected: null, jev_choice: null, candidates: ordered.map((candidate) => candidateView(candidate, null, null, null, null, input.actor_permissions, this.policy)) },
      fallback: { type: "provider_error", reason: providerError.message },
      raw_jev: null,
      error: { code: providerError.code, message: providerError.message },
    };
  }

  private async decideWithStages(state: string, ordered: CapabilityManifest[]): Promise<DecidedAnswer> {
    const coarseRaw = await this.provider.decide({ state, candidates: ordered });
    const coarseAnswer = getChoiceAnswer(coarseRaw);
    const maxSingleStage = Math.max(1, this.policy.single_stage_max_candidates ?? defaultPolicy.single_stage_max_candidates ?? 32);
    if (ordered.length <= maxSingleStage) {
      return singleStageDecision(coarseAnswer, ordered, coarseRaw);
    }
    const topK = Math.min(
      ordered.length,
      Math.max(1, this.policy.top_k ?? defaultPolicy.top_k ?? 8),
    );
    const coarseTop = [...ordered]
      .sort((a, b) => (coarseAnswer.probabilities[b.id] ?? -1) - (coarseAnswer.probabilities[a.id] ?? -1) || a.id.localeCompare(b.id))
      .slice(0, topK);
    const raw_jev_stages: NonNullable<RouteResult["raw_jev_stages"]> = [{ stage: "coarse", response: coarseRaw }];
    const coarse = singleStageDecision(coarseAnswer, ordered, coarseRaw);
    const finalRaw = await this.provider.decide({ state, candidates: coarseTop });
    raw_jev_stages.push({ stage: "final", response: finalRaw });
    const finalAnswer = getChoiceAnswer(finalRaw);
    const final_ = singleStageDecision(finalAnswer, coarseTop, finalRaw);
    return {
      answer: finalAnswer,
      probabilityById: new Map([...coarse.probabilityById, ...final_.probabilityById]),
      confidenceById: new Map([...coarse.confidenceById, ...final_.confidenceById]),
      stageById: new Map([...remapStages(coarse.stageById, "coarse"), ...remapStages(final_.stageById, "final")]),
      raw_jev: finalRaw,
      raw_jev_stages,
    };
  }

  private finalize(base: ReturnType<JevRouter["baseResult"]>, input: RouteInput, ordered: CapabilityManifest[], decided: DecidedAnswer, question = "Which single capability should handle this request?"): RouteResult {
    const { answer, probabilityById, confidenceById, stageById } = decided;
    try {
      if (!ordered.some((candidate) => candidate.id === answer.choice)) {
        throw new JevProviderError("jev_malformed_response", `Jev selected unknown capability ${answer.choice}`);
      }
      const missingProbabilities = ordered.filter((candidate) => !probabilityById.has(candidate.id));
      if (missingProbabilities.length > 0) {
        throw new JevProviderError("jev_malformed_response", `Jev response omitted probabilities for ${missingProbabilities.map((candidate) => candidate.id).join(", ")}`);
      }
      const allCandidates = ordered.map((candidate) => {
        const probability = probabilityById.get(candidate.id) ?? null;
        return candidateView(candidate, probability, confidenceById.get(candidate.id) ?? answer.confidence, stageById.get(candidate.id) ?? null, null, input.actor_permissions, this.policy);
      });
      const ranked = [...allCandidates].sort((a, b) => (b.jev_probability ?? -1) - (a.jev_probability ?? -1) || a.id.localeCompare(b.id));
      const rankById = new Map(ranked.map((candidate, index) => [candidate.id, index + 1]));
      for (const candidate of allCandidates) candidate.router_rank = rankById.get(candidate.id) ?? null;

      const safe = [...allCandidates]
        .filter((candidate) => !candidate.router.filtered)
        .sort((a, b) => (b.jev_probability ?? -1) - (a.jev_probability ?? -1) || a.id.localeCompare(b.id));
      const topSafe = safe[0] ?? null;
      const confidenceThreshold = thresholdFor(topSafe, this.policy);
      let selected: RouterCandidate | null = topSafe;
      let status: RouteResult["status"] = selected?.router.requires_confirmation ? "needs_confirmation" : "selected";
      let fallback: RouteResult["fallback"] = { type: null, reason: null };
      if (!selected) {
        status = "no_decision";
        fallback = { type: "no_safe_candidate", reason: "All candidates were filtered by availability, permission, or policy" };
      } else if (answer.confidence < confidenceThreshold) {
        selected = null;
        status = "no_decision";
        fallback = { type: "low_confidence", reason: `Jev confidence ${answer.confidence.toFixed(3)} is below ${confidenceThreshold.toFixed(3)}` };
      } else if (answer.choice !== topSafe?.id) {
        fallback = { type: "manual_review", reason: `Jev selected ${answer.choice}, which was filtered; router selected the highest-probability safe candidate` };
      }

      const selectedManifest = selected ? ordered.find((candidate) => candidate.id === selected?.id) : undefined;
      const inputErrors = selectedManifest && input.input !== undefined
        ? validateJsonInput(input.input, selectedManifest.input_schema)
        : [];
      const inputValidation = input.input === undefined ? null : { valid: inputErrors.length === 0, errors: inputErrors };
      if (inputValidation && !inputValidation.valid) {
        selected = null;
        status = "no_decision";
        fallback = { type: "manual_review", reason: `Input does not satisfy ${answer.choice} schema: ${inputErrors.join("; ")}` };
      }

      return {
        ...base,
        status,
        decision: {
          kind: "choice",
          question,
          selected: selected?.id ?? null,
          jev_choice: answer.choice,
          candidates: allCandidates,
          ...(input.input !== undefined ? { input: input.input, input_validation: inputValidation } : {}),
        },
        fallback,
        raw_jev: decided.raw_jev,
        ...(decided.raw_jev_stages ? { raw_jev_stages: decided.raw_jev_stages } : {}),
      };
    } catch (error) {
      const providerError = error instanceof JevProviderError ? error : new JevProviderError("jev_malformed_response", compactError(error));
      return {
        ...base,
        status: "no_decision",
        decision: { kind: "choice", question: "Which single capability should handle this request?", selected: null, jev_choice: null, candidates: ordered.map((candidate) => candidateView(candidate, null, null, null, null, input.actor_permissions, this.policy)) },
        fallback: { type: "provider_error", reason: providerError.message },
        raw_jev: decided.raw_jev,
        ...(decided.raw_jev_stages ? { raw_jev_stages: decided.raw_jev_stages } : {}),
        error: { code: providerError.code, message: providerError.message },
      };
    }
  }
}

function sortCandidates(candidates: CapabilityManifest[]): CapabilityManifest[] {
  return [...candidates].sort((a, b) => a.id.localeCompare(b.id));
}

function singleStageDecision(answer: JevChoiceAnswer, covered: CapabilityManifest[], raw: JevRawResponse | null): DecidedAnswer {
  return {
    answer,
    probabilityById: new Map(covered.filter((candidate) => Object.prototype.hasOwnProperty.call(answer.probabilities, candidate.id)).map((candidate) => [candidate.id, answer.probabilities[candidate.id]])),
    confidenceById: new Map(covered.filter((candidate) => Object.prototype.hasOwnProperty.call(answer.probabilities, candidate.id)).map((candidate) => [candidate.id, answer.confidence])),
    stageById: new Map(markStages(covered, "single")),
    raw_jev: raw,
  };
}

function markStages(covered: CapabilityManifest[], stage: "single" | "coarse" | "final"): Array<[string, "single" | "coarse" | "final"]> {
  return covered.map((candidate) => [candidate.id, stage]);
}

function remapStages(stages: Map<string, "single" | "coarse" | "final">, stage: "single" | "coarse" | "final"): Array<[string, "single" | "coarse" | "final"]> {
  return [...stages.keys()].map((id) => [id, stage]);
}

function renderState(input: RouteInput): string {
  const context = input.context && Object.keys(input.context).length > 0 ? `\nContext:\n${JSON.stringify(input.context)}` : "";
  const actor = input.actor ? `\nActor: ${input.actor}` : "";
  return `${input.request}${actor}${context}`;
}

function candidateView(
  candidate: CapabilityManifest,
  probability: number | null,
  confidence: number | null,
  stage: RouterCandidate["jev_stage"],
  routerRank: number | null,
  actorPermissions: string[] | undefined,
  policy: RouterPolicy,
): RouterCandidate {
  const riskLevel: RiskLevel = candidate.risk?.level ?? "low";
  const available = candidate.availability?.available !== false;
  const required = new Set(policy.required_permissions ?? []);
  const permissions = new Set(candidate.permissions ?? []);
  const missingPolicyPermissions = [...required].filter((permission) => !permissions.has(permission));
  const missingActorPermissions = actorPermissions === undefined
    ? []
    : [...permissions].filter((permission) => !new Set(actorPermissions).has(permission));
  const allowedRisk = (policy.allowed_risk_levels ?? defaultPolicy.allowed_risk_levels ?? []).includes(riskLevel);
  const reasons: string[] = [];
  if (!available && !policy.allow_unavailable_fallback) reasons.push(candidate.availability?.reason ?? "capability_unavailable");
  if (missingPolicyPermissions.length > 0) reasons.push(`manifest_missing_permissions:${missingPolicyPermissions.join(",")}`);
  if (missingActorPermissions.length > 0) reasons.push(`actor_missing_permissions:${missingActorPermissions.join(",")}`);
  if (!allowedRisk) reasons.push(`risk_not_allowed:${riskLevel}`);
  const requiresConfirmation = Boolean(
    candidate.policy?.requires_confirmation || (policy.confirmation_risk_levels ?? []).includes(riskLevel),
  );
  return {
    id: candidate.id,
    type: candidate.type,
    name: candidate.name,
    // These two fields intentionally copy the provider values without normalization.
    jev_probability: probability,
    jev_confidence: confidence,
    jev_stage: stage,
    router_rank: routerRank,
    router: {
      available,
      allowed: reasons.length === 0,
      risk_level: riskLevel,
      requires_confirmation: requiresConfirmation,
      filtered: reasons.length > 0,
      filter_reason: reasons.length > 0 ? reasons.join(";") : null,
    },
  };
}

function thresholdFor(candidate: RouterCandidate | null, policy: RouterPolicy): number {
  if (!candidate) return 1;
  return clamp(policy.min_confidence ?? 0.55);
}
