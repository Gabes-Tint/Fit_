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

`workflow/go.py` is the driver for this complete cycle, from issue to
production. It implements blocks 1-5: **Pick and plan, Delegate,
Implement/validate, Review/CI/merge, and Ship** - after the merge it waits
for the version tag and main's CI, deploys QA, decides flakiness, deploys
production, builds the APK and cleans up. `FIT_FLOW_SHIP_TO=qa` stops the
ship at QA; hosts and origins come only from the environment.

The [delegation and implementation gates](workflow/delegation-contract.md)
define role selection, validation, corrections, escalation, the all-slice
barrier, the delivery gates and the ship gates; blocks 1-5 implement them.
An external operator
may start and observe a run; it must not mutate the active workflow,
configuration or slice worktrees. Coordinated cancellation is not implemented:
an external interruption leaves retained state for audit rather than a clean
resume point.

1. **Sync** — fetch; issues; `needs-gabriel`; log. Answers → `decision`.
2. **Pick** — explicit issue, or lowest-numbered open `story` not held. Empty → stop; queue replenishment is outside this run.
3. **Plan** — `workflow/go.py` checks whose call (including spend), then creates one slice or exactly two, domain then UI. Domain includes all non-UI work; UI means Svelte interface/routes. Mechanics write failing tests in existing isolated worktrees. Screens: `expectFitsViewport` at 360px.
4. **Delegate** — rung + why; issue, files, tests, gate; one worktree. Never the shared checkout.
5. **Implement/validate** — bounded corrections and escalation in each retained worktree; the driver runs the foreground gates, commits and freezes each successful slice, then joins all slices.
6. **Review** — integration branch, PR; past mechanical → `reviewer`, findings must cite the diff; fix rounds re-freeze and re-review.
7. **Merge** — `Closes #N`; the driver reads `gh pr checks` itself, one counted rerun; `gh pr merge <n>`.
8. **Ship** — tag, main CI, QA deploy with smoke, flaky → QA only, else prod, APK; `DEPLOY_FAILED` → `needs-gabriel`, never a rollback.
9. **Report delivery** — worktrees and branches cleaned once proven landed; one "Shipped" comment on the story.

## Ladder

Driver role configuration comes from `workflow/agents.yaml`; all four roles
(planner, mechanic, builder, solver) are required and configured. Choose the
smallest capable rung by uncertainty and judgment,
never by diff size. Policy: one initial attempt
plus at most two repairs with the same agent/session/worktree; then escalate
exactly one rung. An exhausted solver stops and preserves its worktree.
Infrastructure, authentication, network and tool failures stop immediately
without retry or capability escalation. Configuration fixes backend, model and
effort at startup; there is no runtime model fallback.

|            |                                                           |
| ---------- | --------------------------------------------------------- |
| `mechanic` | determined procedure, nothing relevant to decide          |
| `builder`  | clear objective, known area/pattern, construction remains |
| `solver`   | uncertain solution/cause, auth, shared state/store        |
| `reviewer` | builder/solver before `main`                              |

Brief names the worktree. The driver waits for foreground checks and reads
`gate-<tier>.json`; do not re-run to be sure. `workflow/go.py` uses `aarmy`
for Pick and plan and for the delegate/implement loops. Implementation slices
run independently; a
successful slice stays frozen while its sibling repairs or escalates, and
delivery waits for all slices to succeed.

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
