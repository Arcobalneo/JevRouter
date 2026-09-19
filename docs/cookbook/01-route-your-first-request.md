# 01 · Route your first request

**Goal**: get one routing decision from Jev in under a minute, with no registry and no setup.

## Prerequisites

- Node.js 20+
- `OPENROUTER_API_KEY` or `JEV_API_KEY` exported (or use the demo provider below)

## One-shot route with inline candidates

```bash
OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter route \
  --provider openrouter \
  --request "Find original sources before summarizing" \
  --candidates '[{"name":"search_web","description":"Find web sources"},{"name":"summarize","description":"Summarize existing sources"}]'
```

Expected output (abridged): `decision.selected` is `search_web`, `status` is `selected`, and every candidate carries its exact `jev_probability` plus a `router` block:

```json
{
  "status": "selected",
  "decision": {
    "selected": "search_web",
    "jev_choice": "search_web",
    "candidates": [
      { "id": "search_web", "jev_probability": 0.97, "router": { "filtered": false, "risk_level": "low" } }
    ]
  }
}
```

## Candidates from a file (JSON or YAML)

```bash
cat > candidates.json <<'EOF'
[{"name":"search_web","description":"Find web sources"},
 {"name":"summarize","description":"Summarize existing sources"},
 {"name":"write_file","description":"Write a local file"}]
EOF

OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter route \
  --provider openrouter --request "Find sources, then summarize" \
  --candidates-file candidates.json
```

For agent-to-router calls, prefer stdin (no shell interpolation of the request):

```bash
echo '{"request":"Find sources, then summarize","candidates":[{"name":"search_web","description":"Find web sources"},{"name":"summarize","description":"Summarize sources"}]}' \
  | OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter route --stdin --provider openrouter
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | `selected` — a capability was chosen within policy |
| 2 | `needs_confirmation` or `no_decision` — human review needed |
| 1 | hard error (bad input, provider failure, missing key) |

## No key? Use the labelled demo provider

```bash
npx --yes github:BillionsBobby/JevRouter route --provider demo \
  --request "search the web for original sources" \
  --candidates '[{"name":"search_web","description":"Find web sources"},{"name":"write_file","description":"Write a local file"}]'
```

Expected: `selected: search_web`, `status: selected`. The demo provider scores token overlap, so give it clearly-separable candidates; fuzzy 2-candidate prompts can land below the default `min_confidence: 0.55` gate and return `no_decision` — that is the policy layer working, see [07](07-policy-and-confirmation.md).

The demo provider is deterministic, offline, and explicitly labelled `jevrouter-demo` in the output — never treat it as Jev.

## Next

- Multi-step tasks → [02 · Multi-step plans](02-multi-step-plans.md)
- Let Codex/Claude route on their own → [03](03-use-with-codex.md) / [04](04-use-with-claude-code.md)
