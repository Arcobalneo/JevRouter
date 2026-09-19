# 07 · Policy, risk & confirmation

**Goal**: tune the policy layer — confidence gates, risk levels, permissions — and read `no_decision` correctly.

## The contract

Jev owns the probabilities; the router owns availability, permissions, risk and confirmation. Concretely:

- `min_confidence` (default **0.55**): below it, the result is `no_decision` with `selected: null` and `fallback.type: "low_confidence"`. `jev_choice` still reports what Jev would have picked.
- Medium/high/critical capabilities require confirmation by default → `status: "needs_confirmation"`.
- Missing permissions, unavailable capabilities, disallowed risk levels are hard filters (`router.filtered: true`, with `filter_reason`).
- If Jev's choice is filtered, the router may select the highest-probability safe candidate, recording `fallback.reason`; `jev_choice` stays unchanged.

## policy.json

`init` writes the defaults to `.jevrouter/policy.json`; point elsewhere with `--policy ./my-policy.json`:

```json
{
  "min_confidence": 0.55,
  "single_stage_max_candidates": 32,
  "top_k": 8,
  "allowed_risk_levels": ["low", "medium", "high"],
  "required_permissions": [],
  "confirmation_risk_levels": ["medium", "high", "critical"],
  "allow_unavailable_fallback": false
}
```

Common tunings:

| Situation | Change |
|---|---|
| Router abstains too often on fuzzy tasks | lower `min_confidence` (e.g. 0.3) and let `fallback.reason` keep the evidence |
| Strict environment (prod) | raise `min_confidence`, set `allowed_risk_levels: ["low"]`, require permissions |
| Huge candidate sets in batch plans | raise `single_stage_max_candidates`, or use serial mode |

## Caller permissions

```bash
OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter route --provider openrouter \
  --request "Delete the stale cache" \
  --candidates '[{"id":"cache_delete","name":"cache_delete","type":"cli","description":"Delete cache files","permissions":["cache.write"],"risk":{"level":"high"}},{"id":"cache_read","name":"cache_read","type":"cli","description":"Read cache stats"}]' \
  --actor-permissions "cache.read"
```

Expected: `cache_delete` is filtered (`router.filtered: true`, `filter_reason: "actor_missing_permissions:cache.write"`); the router selects `cache_read` instead and records the override (`fallback.type: "manual_review"`). Note: permissions/risk only survive on full manifests with an `id`; the bare `{name, description}` shorthand is routing signal only.

## Exit codes and automation

| Code | When |
|---|---|
| 0 | `selected` (route) / every plan step selected |
| 2 | review needed: `needs_confirmation` / `no_decision` on route, or any plan step `needs_confirmation` / `no_decision` |
| 1 | hard error (bad input, provider failure) |

`no_decision` is not a failure of the call — it is the router refusing to commit below policy. The receipt keeps `jev_choice`, probabilities and `fallback.reason` so you can fall back to your reasoning model with full context.
