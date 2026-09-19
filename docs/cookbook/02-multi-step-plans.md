# 02 · Multi-step plans

**Goal**: route a multi-step task — "which capability handles step 1..N?" — with serial, batch, and decomposed strategies.

## Prerequisites

- A key (`OPENROUTER_API_KEY` or `JEV_API_KEY`)
- A candidates file (see [01](01-route-your-first-request.md)); the examples use three tools: `search_web`, `summarize`, `write_file`

## Serial mode (default): each step conditions on earlier selections

```bash
OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter plan \
  --provider openrouter \
  --request "Search sources about Jev, summarize them, save to notes.md" \
  --candidates-file candidates.json --steps 3 --mode serial
```

Expected: three steps, each a full routing decision; step 2+ states carry `Capabilities already routed in previous steps, in order: ...`. A healthy run looks like:

```
step1: search_web selected
step2: summarize selected
step3: write_file selected
```

## Batch mode: one provider call for all steps

```bash
OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter plan \
  --provider openrouter --request "..." --candidates-file candidates.json \
  --steps 3 --mode batch
```

One call answers `step1..stepN`. Cheapest shape; requires the candidate count to fit `single_stage_max_candidates` (default 32; raise via `--policy`).

## Beam sequence selection (batch): fix "same tool five times"

Independent per-step argmax can repeat one "most central" tool in every step. Beam mode searches the joint sequence over Jev's per-step probabilities with a repetition penalty — zero extra provider calls:

```bash
OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter plan \
  --provider openrouter --request "..." --candidates-file candidates.json \
  --steps 5 --mode batch --sequence beam --diversity-penalty 2.0
```

`decision.jev_choice` still reports Jev's per-step argmax; when the beam overrides it, `fallback.reason` records `sequence beam selected <tool> over jev_choice <argmax>`. Tune `diversity_penalty` down (0.5–1.0) when legitimate repeats matter (e.g. reading several files), up (2.0+) when degeneration dominates.

## Decompose mode: sub-goals first, then single-step routes

Multi-step requests are where single-shot routing is weakest — Jev tends to pick the deliverable-producing tool for the whole request. Decompose first:

```bash
OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter plan \
  --provider openrouter --request "First, read new_law.pdf. Then compare each judgment. Finally, write revised_terms.csv." \
  --candidates-file candidates.json --decompose rule
```

The built-in `rule` splitter uses discourse markers (`First/Then/Finally/首先/然后/最后`) and bullet/numbered lines. From the SDK you can inject any decomposer — e.g. an LLM that also sees the tool catalog (measured best in our benchmark):

```ts
import { plan } from "jevrouter";

const result = await plan(
  { request, candidates },
  {
    decompose: async (req) => myLlmDecompose(req, candidates), // string[]
    thread_context: true, // each step sees the original request + progress so far
  },
);
```

## Other knobs

- `--group-by server|type`: hierarchical routing (coarse Choice over groups, then within the winner).
- `--state-detail targets`: adds files/URLs/identifiers extracted from the request to the serial state.
- `--thread-context`: decompose mode threads the original request, `Sub-goal k of N`, and progress into each step.
- SDK-only: `plan_hint: string[]` adds an ordered plan sketch to every serial step's state.

## What we measured

On 10 Toolathlon tasks (real MCP tool inventories, first-5 tool-call prediction): serial 38% → **44%** position-wise hits with tool-aware LLM decompose + `thread_context`; batch 28% → **36%** with beam (λ=2.0). Details: [issue #2](https://github.com/BillionsBobby/JevRouter/issues/2).

## Reading the receipt

Plans are saved append-only to `.jevrouter/plans/plan_*.json`: per-step `selected`/`jev_choice`/`status`, probabilities, `router` annotations, `fallback` reasons, and the raw provider envelope (`raw_jev` at plan level for batch, per-step for serial/decompose).
