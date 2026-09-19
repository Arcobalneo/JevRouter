# Contributing to JevRouter

Thanks for helping build the best agent decision layer. This project is small on purpose — keep it that way.

## Dev setup

```bash
git clone https://github.com/BillionsBobby/JevRouter.git
cd JevRouter
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (44+ tests, all offline)
npm run build       # tsc -p tsconfig.build.json
```

All three must be green before you open a PR; CI (`.github/workflows/ci.yml`) runs exactly these on every push and PR.

## Conventions

- **Contract first**: Jev owns probabilities; the router owns availability, permissions, risk, confirmation. Never re-normalize filtered candidates, never drop the raw provider response, never execute a capability implicitly.
- TypeScript ESM, `.js`-suffixed relative imports, Node.js 20+. No new runtime dependencies without a strong reason.
- Tests: `node:test` + `assert/strict`, offline providers only (see `tests/router.test.ts` and `tests/plan.test.ts` for the fake-provider patterns).
- Commits: conventional style (`feat:`, `fix:`, `refine:`, `docs:`).
- One PR = one concern. Bug fixes come with a failing test first when practical.

## Verifying changes against the real API

Unit tests are offline by design. If your change touches the provider or plan paths, also run one live smoke (your own key, never committed):

```bash
OPENROUTER_API_KEY="..." npm run dev -- route --provider openrouter \
  --request "check connectivity" \
  --candidates '[{"name":"a","description":"option a"},{"name":"b","description":"option b"}]'
```

## Issues and PRs

- Bug issues: problem + evidence (command, output, receipt). Feature PRs: link the motivation, include measurements when they affect routing quality (see [issue #2](https://github.com/BillionsBobby/JevRouter/issues/2) for the experiment-report format).
- Docs changes: run every command you document.

## License

By contributing you agree your work is licensed under [MIT](LICENSE).
