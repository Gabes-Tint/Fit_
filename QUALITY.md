# Fit_ quality

Settled policy. Gaps are deliberate — do not propose additions already listed as done.
`README.md` has the tier table. `AGENTS.md` has the editing rules.

## Standing rules

|             |                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bar         | Thresholds only ratchet up.                                                                                                                                                                                |
| Suppression | Issue key or URL on the line or the line above.                                                                                                                                                            |
| Fixture     | No self-test (`bun run test:gates`) → unfinished.                                                                                                                                                          |
| Merge       | Only deterministic checks. Trivy and ZAP never gate.                                                                                                                                                       |
| Proof       | Green tool ≠ green feature.                                                                                                                                                                                |
| State       | Every `TendState` shape change ships a migration in the same PR: bump `SCHEMA_VERSION`, append `migrate_N_to_N+1`, extend `FIELD_CHECKS`, test an old-document fixture. Pure. Newer documents are refused. |

**Settled, do not add:** format, types, lint, Svelte diagnostics, test discipline, dead code, duplication/complexity caps, secret scanning, SAST, bundle budgets, production build, workflow lint, report retention, branch protection.

## Gate operation

Tiers run to completion → `reports/quality/gate-<tier>.json`. Re-run: `bun scripts/quality/gate.ts <tier> --only <step>`.

|           |                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `failed`  | Judged the change. Exit 1.                                                                                                                                   |
| `crashed` | Died first. Exit 97. Still red. A mutation lane with no `verdict.json` writes `crash.json`. Missing ≠ survived.                                              |
| Where     | Hosted by default. Local: `verify:changed`. Not `ci` / `verify` / `verify:deep` “to be sure”. Exceptions: deploy; `gate.ts ci --job <name>` on one red lane. |
| `make ci` | Hosted steps, one machine. Do not reorder (`build/` and ports from 4173).                                                                                    |

### Pre-push

Foreground. Never background. Preferred: `bun run verify:changed`.

- `npm run check`
- `npm run lint:changed` — diff vs `origin/main` + working tree, still on disk
- specs for files touched
- affected `*.e2e.ts` once (`E2E_PROJECT=mobile-chrome`)
- mutation only under `src/lib/{domain,server,state}`: `changed:node` or `changed:client`

`lint:staged` = current bytes of staged paths (pre-commit). Never local `test:e2e` / `verify` / `verify:deep` before a push.

| Check                | Rule                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:ci-contract`  | Hosted jobs = local slices, in `all-green.needs`. Bun → setup action. Uploads `if: always()`. `Quality and security` listens for `merge_group`. |
| `check:stale-revert` | Branch must not restore `main`’s previous contents. Escape: `Reverts: <sha>`.                                                                   |
| `check:schedules`    | `audit` and `nightly` have a `cron` and can open an issue.                                                                                      |
| `check:thresholds`   | Lowering coverage, mutation, bundle, duplication, or suppressions fails.                                                                        |
| E2E                  | `mobile-chrome`. Safari/desktop = CI. Workers: half the cores.                                                                                  |
| ZAP                  | Pins a Playwright project. A timeout is not a pass.                                                                                             |
| Trivy                | High/Critical. `overrides` only inside the parent’s range.                                                                                      |

## Slop · duplication · bundle

Slop (#129): one directory per PR. A test is slop iff deleting it does not drop _killed_. A wrapper is slop iff inlining leaves `check`/`lint`/`knip` clean. Wrong comment → fix the sentence. Leave files that already carry mutation debt.

Duplication: `maxClones: 0` on production. Specs ignored in `.jscpd.json`. Do not raise the cap.

Bundle: `check:bundle` always rebuilds with `FIT_BUNDLE_MEASURE_VERSION`. Four metrics: total JS, always-loaded JS, CSS, largest asset. Raise only with that output quoted.

## Mutation lanes

PRs block on **security** only. Other three report daily. Specs/e2e never targeted.

### Where the mutation lanes run

| Lane                           | Where                                   | Blocks? |
| ------------------------------ | --------------------------------------- | ------- |
| `test:mutation:security`       | every PR                                | yes     |
| `test:mutation:changed:node`   | daily on `main` (base = `main` 24h ago) | no      |
| `test:mutation:changed:client` | daily                                   | no      |
| `test:mutation:full`           | daily, forced cold                      | no      |

Security blocks because a survivor in `src/lib/server/users/` is an unnoticed auth break. Self-test mutation runs on a PR only when gate scripts / `quality/` / Stryker / workflows / lockfile / `.tool-versions` change.

Nothing merged → skip changed lanes out loud, still run full. No base → audit fails.

### Strict verdict

Only `Killed` passes. Timeout, uncovered, error, stale, wrong scope, empty security: fail.

|             |                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Equivalents | file + mutator + replacement + `sourceHash` (mutated line ±1). Not `location`. Ambiguous → stale. Never edit `quality/mutation-equivalents.json`; propose in the PR. |
| Fallback    | Changed files strict; unchanged background 80% (`strict-changed-with-legacy-background`).                                                                            |
| Inert       | Comment/doc/reordered import only. Deletion, rename, security: never.                                                                                                |
| Full        | 80% aggregate, `mutation.break`.                                                                                                                                     |
| Cache       | Per lane, only after a passing verdict. Audit is cold.                                                                                                               |

### What the mutation lanes do not reach

Issue #76. Mutate production `src/**/*.ts` not excluded by `quality/mutate-patterns.mjs` (includes `+server.ts`). Outside: `.svelte`, `scripts/`, `tests/`, ten `!` files.

| Outside              | Covered by                                                    |
| -------------------- | ------------------------------------------------------------- |
| Svelte `src/lib/`    | component specs + client coverage                             |
| Svelte `src/routes/` | `*.e2e.ts`. No coverage floor.                                |
| `scripts/**`         | server-project unit specs (`security/` and `eval/` have none) |
| `tests/**`           | running e2e                                                   |
| `!` patterns         | reason on the pattern                                         |

`check:mutation-scope` vs `quality/mutation-uncovered.json`. New blind spot fails static until `--write`. Widening the glob is Gabriel’s call.

### Paying down mutation debt

Issue #87: every survivor is debt, even at 80%.

`bun run debt:pay` → three worst files. One PR, real tests, owning lane, before/after table. Ledger issue `<!-- mutation-debt-ledger -->` is overwritten each run. A crash is a separate `quality` issue.
