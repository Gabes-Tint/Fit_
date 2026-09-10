# Fit_

[![CI](https://github.com/Gabes-Tint/Fit_/actions/workflows/ci.yml/badge.svg)](https://github.com/Gabes-Tint/Fit_/actions/workflows/ci.yml)

SvelteKit fitness app. Live: [fit.psilva.org](https://fit.psilva.org)

Mobile web (`adapter-node`) · Android Capacitor WebView · **no iOS shell**

| In                                                          | Out                |
| ----------------------------------------------------------- | ------------------ |
| today, catalog, plan, progress, profile                     | photo recognition  |
| `/exercise` — routines, session, planner                    | household features |
| log: text, voice, search, manual, barcode                   | iOS shell          |
| floating menu; left-handed mirror                           |                    |
| SQLite accounts; sign-in is the gate                        |                    |
| sync: per-account, offline `localStorage`, last-write-wins  |                    |
| catalog: ETL SQLite (`FIT_CATALOG_PATH`) + bundled fallback |                    |

## Setup

Bun + Node from `.tool-versions`. Chromium via Playwright. Docker for full gates.

```bash
bun install --frozen-lockfile
bunx playwright install --with-deps chromium
cp .env.example .env    # gitignored; worktrees do not inherit it
bun run dev
```

Never `PUBLIC_` / `VITE_` on operator names. Slice: `bun run worktree:new <slug>` / `worktree:done`.

## Commands

|                           |                              |
| ------------------------- | ---------------------------- |
| `bun run verify:changed`  | **pre-push** — only the diff |
| `bun run check`           | types; warnings fail         |
| `bun run lint:changed`    | ESLint on the diff           |
| `bun run test:e2e`        | `mobile-chrome`              |
| `bun run deploy`          | build → VM → smoke           |
| `bun run android:release` | signed APK, JDK 21           |

## Gates

`reports/quality/gate-<tier>.json` · one step: `bun scripts/quality/gate.ts <tier> --only <step>` · policy: `QUALITY.md`

Hosted `CI / Quality and security` merges. Do not run `ci` / `verify` / `verify:deep` locally to be sure. `failed` judged; `crashed` died first.

| Command          | What                                      | Needs            |
| ---------------- | ----------------------------------------- | ---------------- |
| `precommit`      | format, staged lint, suppressions         | —                |
| `verify:fast`    | static + server unit                      | —                |
| `verify:changed` | + specs / e2e / mutation the diff touches | varies           |
| `verify`         | + coverage, build, budgets                | Docker, Chromium |
| `verify:deep`    | + mutation, e2e                           | Docker, browsers |
| `ci`             | + Gitleaks, Semgrep — merge gate          | Docker, browsers |
| `audit:mutation` | daily lanes; debt, never a gate           | Chromium         |
| `nightly`        | Trivy, ZAP; never a gate                  | Docker, Chromium |

Catalog (not a gate, not in git; `node` does not load `.env`):

```bash
set -a; source .env; set +a
bun run search:eval && bun run etl:audit && bun run perf:measure
```

## Ship

`.env`: `FIT_DEPLOY_HOST` `FIT_PUBLIC_ORIGIN`. Clean tree. Green `main` or green `merge_group` for that SHA.

|         |                                                                                            |
| ------- | ------------------------------------------------------------------------------------------ |
| Web     | `bun run deploy` · `deploy:smoke` · `--tunnel` skips Cloudflare                            |
| VM env  | `scripts/deploy/fit.env.example` — on the machine, not `.env`                              |
| Android | `FIT_ANDROID_SIGNING_PROPERTIES` → `android/app/build/outputs/apk/release/app-release.apk` |
| Merge   | `gh pr merge <n>` — no `update-branch`                                                     |
| Flake   | `bun run ci:rerun-failed <n>`                                                              |

`AGENTS.md` rules · `QUALITY.md` policy · `ORCHESTRATOR.md` loop · `.env.example` operator env
