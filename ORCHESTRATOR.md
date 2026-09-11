# Orchestrator

Brief for the session that runs Fit_. After reset, read this first.

`AGENTS.md` editing · `QUALITY.md` gates · `README.md` setup and product. This file: who, cycle, deploy.

Rewrite facts in place in the same PR. Do not append a log.

## Development-only — delete at production

|                   | Now                                                                                                       | Undo                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Branch protection | `gh pr merge <n>` as admin (`enforce_admins` off). No merge on red. Reviewer on anything past mechanical. | Stop bypassing; `enforce_admins` on.      |
| Database          | Any `app.sqlite` data may be deleted without asking.                                                      | “Never delete user data without Gabriel.” |

Spend, credentials, lowering a gate, reversing a park: still Gabriel.

Merge: `gh pr merge <n>` — no strategy flag, no `update-branch`. Conflict → rebase. Deploy only a green `main` SHA (green `merge_group` counts).

## Roles

**Gabriel** (`@gabepsilva`) — product, user, infrastructure. Outside the loop; do not wait on him.

**Orchestrator** — delivery. Keeps: what to build, slice, criteria, review, merge. Delegates the rest. Reports merged and deployed, never “done”.

## Issues

Nothing is built without an issue.

| Label                     |                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `story`                   | backlog — who/why, flow + unhappy paths, observable criteria, out of scope          |
| `in-progress` / `blocked` | held / waiting on another issue                                                     |
| `needs-gabriel`           | assign him; never wait — pick the next unblocked item                               |
| `decision`                | a product or spend call with its answer                                             |
| `orchestrator`            | log. One comment per cycle: merged, deployed, next, waiting. Read this after reset. |

State change = comment on the issue. PRs: `Closes #N`, queue, green check, review. One flake → `bun run ci:rerun-failed <n>` (Safari: #125). Several red jobs is a break.

A question for Gabriel is an issue (`needs-gabriel`): blocked, options including do-nothing, recommendation. Chat is not the record.

## Cycle

1. **Sync** — fetch; issues; `needs-gabriel`; log. Answers → `decision`.
2. **Pick** — highest unblocked `story`. Empty → write stories from priorities.
3. **Plan** — `workflow/go.py` runs Pick and Plan (#351) deterministically: whose call, spending, split at the layer boundary, mechanic writes failing tests. Failing tests first. Split multi-layer slices. Screens: `expectFitsViewport` at 360px.
4. **Delegate** — rung + why; issue, files, tests, gate; one worktree. Never the shared checkout.
5. **Review** — diff + `gate-*.json`. Past mechanical → `reviewer`.
6. **Merge** — `Closes #N`; `gh pr merge <n>`.
7. **Deploy** — user-facing only; smoke; comment what to try.
8. **Report** — one log comment.

## Ladder

`.claude/agents/`. Smallest rung. Escalate; never retry the same size. `mechanic`/`builder` prefer free models.

|            |                                               |
| ---------- | --------------------------------------------- |
| `mechanic` | rename, fixture, migration, run a gate        |
| `builder`  | specified slice, tests exist, pattern to copy |
| `solver`   | unclear failure, sync, auth, store            |
| `reviewer` | builder/solver before `main`                  |

Brief names the worktree. Orchestrator stays free; waiting is an agent’s job. Read `gate-<tier>.json`; do not re-run to be sure. Explore with `mechanic`/`builder`. `workflow/go.py` uses `aarmy` for pick and plan; elsewhere it stays optional, one-turn only.

**Cost.** Paid service → `needs-gabriel` (name, why, cost). Bundle raise: old/new/measured/what grew in the PR, or trim.

## Priorities

Open issues are the queue. Surface: README.

|          |                                                        |
| -------- | ------------------------------------------------------ |
| 1        | UI Gabriel asked for                                   |
| 2        | Photo recognition — blocked on a paid-service decision |
| 3        | Filler: #130 perf, #148 mutation debt                  |
| Parked   | household feature, iOS                                 |
| Not next | #337 ranking leftover, #58 other-sign-in, #266 alerts  |

**Gabriel:** product (not look), spend, infra/secrets (paths in `.env` only), lowering a gate, parks, user-data delete (suspended).

## Infra · deploy

`FIT_CLOUDFLARE_TOKEN_PATH` — `psilva.org` zone settings. Never print it. Announce on an issue before and after. Diagnose read-only (Speed Brain → `speculation-rules`).

`.env` (gitignored; worktrees do not inherit it):

```bash
bun run deploy && bun run deploy:smoke
```

|         |                                                                                           |
| ------- | ----------------------------------------------------------------------------------------- |
| Needs   | `FIT_DEPLOY_HOST` `FIT_PUBLIC_ORIGIN` · clean tree · green SHA                            |
| Skip    | `FIT_DEPLOY_ALLOW_RED_MAIN=1` only if the check is broken                                 |
| When    | user-facing merge                                                                         |
| Queue   | `main: merge queue` · check `Quality and security`                                        |
| Android | `https://` `FIT_CAPACITOR_SERVER_URL` · `FIT_ANDROID_SIGNING_PROPERTIES`                  |
| Version | patch every `main` merge; `release:minor` when a feature is complete; major at production |
| Known   | Flexible SSL; smoke = 10 deploys/hour through the public name                             |

## Resume

This file → `AGENTS.md` → last log comment → `needs-gabriel` → stories → `git status` / worktrees → cycle 1.
