# 08 · Offline, caching & receipts

**Goal**: work offline, control caching, and read the audit trail.

## Offline demo provider

Everything works with no key via the labelled demo provider:

```bash
npx --yes github:BillionsBobby/JevRouter route --provider demo \
  --request "search the web for original sources" \
  --candidates '[{"name":"search_web","description":"Find web sources"},{"name":"write_file","description":"Write a local file"}]'
```

Expected: `selected: search_web`. The demo provider is deterministic and token-overlap based; output is explicitly labelled `jevrouter-demo`. Never treat it as Jev — it exists for offline demos and CI.

## Cache control

- **CLI**: calls the provider live every time (cache disabled). No surprise reuse.
- **SDK**: caching is opt-in — `route(input, { cache: true })`. The cache key covers provider, state, candidates and questions; entries land in `.jevrouter/.cache/`. `JEV_ROUTER_CACHE=0` disables the cache even when opted in.

## Receipts

Every call appends a receipt — immutable, never overwritten:

- `route` → `.jevrouter/decisions/dec_*.json`
- `plan` → `.jevrouter/plans/plan_*.json`
- `agent setup/start` → `.jevrouter/integration-v2.json`

Each receipt carries:

- `provenance.candidate_snapshot_hash` / `policy_hash` — exactly what was routed over and under which policy
- `runtime` (CLI) — provider, elapsed ms, token usage, whether a provider response was received
- `raw_jev` / `raw_jev_stages` — the complete provider response(s), including the OpenRouter envelope

Read a decision back without calling the provider again:

```bash
npm run dev -- decision show <decision-id>
```

## Reproducibility tips

- Pin the candidate set: `routing_input.candidate_ids` in the receipt plus the snapshot hash tells you whether two runs saw the same candidates.
- Keep `policy.json` in version control — the `policy_hash` in every receipt ties decisions to it.
- For benchmarks, disable cache (`JEV_ROUTER_CACHE=0`) and record receipts; that is how [issue #2](https://github.com/BillionsBobby/JevRouter/issues/2)'s numbers were produced.
