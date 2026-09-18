import type { CapabilityManifest, JevChoiceAnswer, JevProvider, JevRawResponse, RouteInput, RouteResult, RouterCandidate, RouterPolicy, RiskLevel } from "./types.js";
import { defaultPolicy } from "./manifest.js";
import { getChoiceAnswer, JevProviderError } from "./provider.js";
import { clamp, compactError, requestId, sha256, validateJsonInput } from "./utils.js";

export class JevRouter {
  constructor(
    private readonly provider: JevProvider,
    private readonly policy: RouterPolicy = defaultPolicy,
  ) {}

  async route(input: RouteInput, candidates: CapabilityManifest[]): Promise<RouteResult> {
    const request_id = requestId("req");
    const decision_id = requestId("dec");
    const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
    const candidate_snapshot_hash = sha256(ordered);
    const policy_hash = sha256(this.policy);
    const base = {
      request_id,
      decision_id,
      mode: "decision_only" as const,
      execution: { enabled: false as const, status: "not_started" as const },
      provenance: {
        jev_provider: this.provider.name,
        candidate_snapshot_hash,
        policy_hash,
      },
    };

    if (ordered.length === 0) {
      return {
        ...base,
        status: "no_decision",
        decision: { kind: "choice", question: "Which single capability should handle this request?", selected: null, jev_choice: null, candidates: [] },
        fallback: { type: "no_safe_candidate", reason: "No capability candidates were supplied" },
        raw_jev: null,
      };
    }

    let raw_jev: JevRawResponse | null = null;
    let raw_jev_stages: RouteResult["raw_jev_stages"];
    let answer: JevChoiceAnswer;
    let probabilityById = new Map<string, number>();
    let confidenceById = new Map<string, number>();
    let stageById = new Map<string, "single" | "coarse" | "final">();
    try {
      const coarseRaw = await this.provider.decide({
        state: renderState(input),
        candidates: ordered,
      });
      raw_jev = coarseRaw;
      const coarseAnswer = getChoiceAnswer(coarseRaw);
      const maxSingleStage = Math.max(1, this.policy.single_stage_max_candidates ?? defaultPolicy.single_stage_max_candidates ?? 32);
      if (ordered.length <= maxSingleStage) {
        answer = coarseAnswer;
        for (const candidate of ordered) {
          if (Object.prototype.hasOwnProperty.call(coarseAnswer.probabilities, candidate.id)) {
            probabilityById.set(candidate.id, coarseAnswer.probabilities[candidate.id]);
            confidenceById.set(candidate.id, coarseAnswer.confidence);
            stageById.set(candidate.id, "single");
          }
        }
      } else {
        const topK = Math.min(
          ordered.length,
          Math.max(1, this.policy.top_k ?? defaultPolicy.top_k ?? 8),
        );
        const coarseTop = [...ordered]
          .sort((a, b) => (coarseAnswer.probabilities[b.id] ?? -1) - (coarseAnswer.probabilities[a.id] ?? -1) || a.id.localeCompare(b.id))
          .slice(0, topK);
        raw_jev_stages = [{ stage: "coarse", response: coarseRaw }];
        for (const candidate of ordered) {
          if (Object.prototype.hasOwnProperty.call(coarseAnswer.probabilities, candidate.id)) {
            probabilityById.set(candidate.id, coarseAnswer.probabilities[candidate.id]);
            confidenceById.set(candidate.id, coarseAnswer.confidence);
            stageById.set(candidate.id, "coarse");
          }
        }
        const finalRaw = await this.provider.decide({
          state: renderState(input),
          candidates: coarseTop,
        });
        raw_jev = finalRaw;
        raw_jev_stages.push({ stage: "final", response: finalRaw });
        answer = getChoiceAnswer(finalRaw);
        for (const candidate of coarseTop) {
          if (Object.prototype.hasOwnProperty.call(answer.probabilities, candidate.id)) {
            probabilityById.set(candidate.id, answer.probabilities[candidate.id]);
            confidenceById.set(candidate.id, answer.confidence);
            stageById.set(candidate.id, "final");
          }
        }
      }
    } catch (error) {
      const providerError = error instanceof JevProviderError ? error : new JevProviderError("jev_http_error", compactError(error));
      return {
        ...base,
        status: "no_decision",
        decision: { kind: "choice", question: "Which single capability should handle this request?", selected: null, jev_choice: null, candidates: ordered.map((candidate) => candidateView(candidate, null, null, null, null, input.actor_permissions, this.policy)) },
        fallback: { type: "provider_error", reason: providerError.message },
        raw_jev,
        ...(raw_jev_stages ? { raw_jev_stages } : {}),
        error: { code: providerError.code, message: providerError.message },
      };
    }

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
          question: "Which single capability should handle this request?",
          selected: selected?.id ?? null,
          jev_choice: answer.choice,
          candidates: allCandidates,
          ...(input.input !== undefined ? { input: input.input, input_validation: inputValidation } : {}),
        },
        fallback,
        raw_jev: raw_jev,
        ...(raw_jev_stages ? { raw_jev_stages } : {}),
      };
    } catch (error) {
      const providerError = error instanceof JevProviderError ? error : new JevProviderError("jev_malformed_response", compactError(error));
      return {
        ...base,
        status: "no_decision",
        decision: { kind: "choice", question: "Which single capability should handle this request?", selected: null, jev_choice: null, candidates: ordered.map((candidate) => candidateView(candidate, null, null, null, null, input.actor_permissions, this.policy)) },
        fallback: { type: "provider_error", reason: providerError.message },
        raw_jev,
        ...(raw_jev_stages ? { raw_jev_stages } : {}),
        error: { code: providerError.code, message: providerError.message },
      };
    }
  }
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
