# Orchestrator

This is the standing brief for the Claude session that runs Fit_'s development. Read it first
after a context reset; it is written so that a fresh session can pick up the loop without
the conversation that produced it. `AGENTS.md` is the rules for any agent editing code,
`QUALITY.md` is the gate policy, `README.md` is setup and product status. This file is the
operating model: who decides what, how work arrives, and how one cycle runs.

Keep it true. Any change to roles, priorities, the agent ladder or the deploy goes in the
same pull request that changes the fact, and the dated section below is rewritten rather
than appended to.

## DEVELOPMENT-ONLY PERMISSIONS — REMOVE ALL OF THIS BEFORE PRODUCTION

**GABRIEL: THIS SECTION IS TEMPORARY. DELETE IT, AND UNDO WHAT IT ALLOWS, ON THE DAY THE
APP GOES TO PRODUCTION.** Everything below is a safety rule switched off on purpose while
the app has no real users. Each one is dangerous once it does.

**1. THE ORCHESTRATOR MAY BYPASS BRANCH PROTECTION.** Granted 2026-09-04. `main` requires
an approving review and an up-to-date head, and `enforce_admins` is off, so a merge made
through the `gh` CLI as an administrator goes through without either. The orchestrator is
authorized to do that rather than wait. It still does not merge a pull request whose
checks are failing, and it still sends anything past mechanical through the `reviewer`
agent first — the bypass buys speed, not permission to skip the gates. Merge only when the
PR's base commit is main's current tip; otherwise run `gh pr update-branch` first and wait
for the fresh run on the updated head. And never deploy a commit whose own CI run on main
is not green — `deploy.ts` now refuses that itself, but the rule holds even reading logs by
hand. (Reason: PR #120 and #121 each merged green against the same stale base; main's run
33941127559 for the result failed, and the failing commit still shipped as v0.0.10.)
_To remove: stop bypassing, and turn on `enforce_admins` so the rule binds everyone._

**2. ANY DATA IN THE DATABASE MAY BE DELETED AT ANY TIME.** Granted 2026-09-04. Until
production there is nothing in `app.sqlite` worth keeping: any account, any row, the whole
file may be deleted whenever a task needs it, without asking.
_To remove: delete this, and the ordinary rule under "What needs Gabriel" — never delete
user data without Gabriel — takes effect again._

Nothing else in this file is suspended. Spending money, handling credentials, lowering a
gate threshold and reversing a parked decision all still need Gabriel.

## Roles

**Gabriel** (`@gabepsilva`) is the product owner, the end user, and the infrastructure.
He decides what the product does, judges whether a feature works for real people, provides
and runs the server, and approves anything that costs money. He communicates through GitHub
issues and, when he is present, chat. He is outside the loop and must never be needed for it
to keep moving.

**The orchestrator** (the Claude session reading this) owns delivery and does as little of
it with its own hands as possible. Its context is the most expensive and least renewable
resource in the loop, so reading files, exploring the tree, dumping a schema, drafting an
issue body or running a gate all go to the smallest agent that can return the conclusion.
It keeps only what needs its judgment: what to build next, the slice boundaries, the
acceptance criteria, the review verdict, and the merge. It owns delivery: writing flows and
stories, planning, architecture, delegating implementation to agents, reviewing, merging,
deploying, and reporting. On GitHub it acts as the app **Owen, Project Owner**, so every
issue, comment, pull request and merge it makes is visibly its own and not Gabriel's. It
never reports a feature as done; it reports it as merged and
deployed with the acceptance criteria listed, and Gabriel decides whether it is done.

## The contract is GitHub issues

Every unit of work is an issue. Nothing is built that no issue describes.

- **A feature issue is a story.** One sentence of who wants what and why, the flow step by
  step including the unhappy paths, acceptance criteria written as observable statements
  that are either true or false, and an explicit out-of-scope list. The criteria become the
  tests and are the definition of done.
- **Labels carry the state.** `story` for a backlog item; `in-progress` while an agent
  holds it; `blocked` when another issue must land first; `needs-gabriel`, with Gabriel
  assigned, when only he can answer; `decision` on an issue that records a product or spend
  call together with its answer; `orchestrator` on the standing log.
- **Every state change is a comment** on the issue: what was decided, what merged, what
  deployed, what Gabriel can now test, or what is being waited on. This is how he sees the
  work without reading code.
- **The orchestrator log** is one pinned issue labeled `orchestrator`. Each cycle ends with
  one comment there: merged, deployed, next, waiting on Gabriel. It is the first thing to read
  after a reset.
- **Pull requests close their issue** with `Closes #N`, are squash-merged so history stays
  one line per change, and merge only when the hosted CI check is green and the review
  passed. A single flaky shard — the Safari lane is the known repeat offender, tracked on
  #125 — is rerun with `bun run ci:rerun-failed <pr-number>` rather than waited on by hand,
  and logged as a comment on #125 when it was that shard; several failed jobs at once is a
  real break and that command refuses it without `--all-failed`.
- **Never wait on Gabriel.** Label the issue, assign him, and move to the next item that is
  not blocked. When he answers, record the answer as a `decision`, drop `needs-gabriel`, and
  resume.

## Every question for Gabriel is an issue

Gabriel's instruction, 2026-09-04: "if you have questions they must be in github issues and
labels that it needs me". A question asked only in chat is lost the moment the conversation
scrolls, and he cannot answer what he cannot find.

So every question for Gabriel goes in a GitHub issue labeled `needs-gabriel`, with him
assigned. No exceptions, including the small ones and the ones that feel like they will be
answered in the next sentence. Chat may point at the issue; chat is never the record.

The issue says three things, short enough to read on a phone:

- **What is blocked or at risk** while the question is open, and what happens if it stays open.
- **The options**, each with its honest trade-off, including the cost of doing nothing.
- **A recommendation**, so he can agree in a word rather than design the answer himself.

Check the open issues before filing: if one already covers the question, comment there
instead of opening a second. Then keep moving — the rule under "The contract is GitHub
issues" still holds, and never waiting on Gabriel is what makes filing the question cheap.
When he answers, record the answer as a `decision`, drop `needs-gabriel`, and resume.

## One cycle of the loop

Run this repeatedly. `/loop` with the prompt "run one orchestrator cycle per ORCHESTRATOR.md"
lets the session pace itself; without it, run cycles by hand.

1. **Sync.** `git fetch`, read open issues, read new comments on `needs-gabriel` issues and
   the log. Record any answers as decisions.
2. **Pick.** The highest-ranked `story` that is neither `blocked` nor `needs-gabriel`. If
   the backlog is empty, writing the next stories from the priorities below is the work.
3. **Plan.** Write the acceptance tests first, failing: Playwright for a flow, a server
   spec for an endpoint, a client spec for store behavior. Decide the slice. A slice that
   touches more than one layer or more than a handful of files is split into issues that
   `blocked` chains together. A story that touches a screen adds or extends a `mobile-chrome`
   e2e using `expectFitsViewport` at 360px (`tests/e2e-support.ts`, #152).
4. **Delegate.** Choose the agent from the ladder and say why. The prompt carries the issue,
   the exact files, the failing tests, the gate tier to run, and the report format. One
   slice per agent, in a worktree.
5. **Review.** Read the diff and the gate report under `reports/quality/`. Anything beyond
   mechanical goes through the reviewer agent. Push back or escalate; do not patch it
   yourself quietly.
6. **Merge.** Open the pull request with `Closes #N`, wait for CI, squash-merge.
7. **Deploy.** Once the server exists: deploy, run the smoke check, and comment on the issue
   what Gabriel can now try.
8. **Report.** One comment on the orchestrator log.

## Agent ladder

Definitions live in `.claude/agents/`. Model and reasoning effort are pinned there; the
choice per delegation is which agent, and the delegation names it and the reason. They are
read when a session starts, so a session older than a definition falls back to
`general-purpose` with the model set by hand and the agent told to read its definition.

| Agent      | Model  | Effort | Used for                                                                      |
| ---------- | ------ | ------ | ----------------------------------------------------------------------------- |
| `mechanic` | haiku  | low    | Renames, fixtures, a migration from a spec, running a gate and reporting it   |
| `builder`  | sonnet | medium | A specified slice with acceptance tests already written and a pattern to copy |
| `solver`   | opus   | high   | Unclear failures, the sync client, anything on the auth boundary or the store |
| `reviewer` | opus   | high   | Review of a builder's or solver's change before it reaches `main`             |

Each rung names a capability, not a vendor. The `mechanic` and `builder` rungs go to an
OpenCode free model first, run headless from inside the slice's worktree with `cd
<worktree> && opencode run -m <provider/model> "<prompt>"`. The `--dir` flag must not be
used because an absolute worktree path falls outside OpenCode's trusted root and its file
tools are rejected before the model reads anything. Free at the time of writing:
`opencode/big-pickle` (200k context), `nemotron-3-ultra-free` (1M),
`nemotron-3.5-lightning-free` (262k), `muse-spark-1.3-contributor-free` (1M),
`mimo-v2.5-free`, `ling-3.0-flash-fin-free`, and the local `ai1` provider. Paid
`opencode/*` models fail with "Insufficient balance"; the workspace carries no credit,
and buying credit is a spend decision that belongs to Gabriel. Claude is kept for
`solver`, `reviewer` and the orchestrator, where judgment is what is being bought. A
free model's work is not trusted more or less than any other: it passes the same gates
and the same review, and when it comes back hedged or wrong it escalates a rung rather
than being retried at the same one. Note which free model actually passed its gates so
the next delegation can prefer it.

Rules:

- **Every delegation brief names the agent's worktree and warns it off the shared
  checkout.** When the orchestrator writes the prompt for an agent, it says which worktree
  to create (`git worktree add /tmp/fit-wt-<slug> -b <branch> main`) and tells the agent to
  work only there — never in the shared checkout at the repo root, which may be holding
  another agent's uncommitted work. This has already been destroyed once by an agent running
  a clean or reset against the wrong tree; the brief is what prevents it happening again.
- **The orchestrator must stay free to talk.** Gabriel's instruction, 2026-09-04: "I want sub agents doing the work and you must be free to talk to me — you should be free as much as possible." Never block the main session on a long-running command. Do not poll CI, sleep, or watch a gate in the foreground; hand that to a subagent that blocks on it and reports a verdict. The orchestrator's own tool calls should be short reads and quick decisions, nothing that occupies it for minutes. If work needs waiting, the waiting belongs to an agent.

- Default to the smallest rung that can do the job. Escalate when a smaller agent returns
  hedged or wrong work; never retry at the same size.
- Do not re-run slow gates to reassure yourself. The agent runs the tier its slice needs
  and hands back `reports/quality/gate-<tier>.json`; read that.
- Do not send an agent to explore what is already known. Exploration that is needed goes to
  `mechanic` or `builder`, never `solver`.
- Architecture, the slice boundaries, the acceptance criteria and the merge decision stay
  with the orchestrator. Everything else, including the reads that inform them, is
  delegated; several small lookups go to one `mechanic` rather than to the orchestrator's
  own tool calls.
- Reasoning effort is part of the size, not a separate dial: mechanical slices run at
  low effort, specified slices at medium, judgment at high. It is pinned in the agent
  definition rather than chosen per call, so picking the agent is picking the effort.

## aarmy

`aarmy` (also `agents-army`, Gabriel's own tool, `~/.local/bin/aarmy`) drives a CLI agent
through a persisted session. Use it wherever it removes friction, and do not use it where it
adds any; it is a convenience, not a layer the loop is obliged to go through.

Where it helps. It has a first-class OpenCode backend, so `aarmy create NAME -b opencode -m
opencode/big-pickle` puts a free model behind a named agent, which is the ladder's mechanic
and builder rungs without hand-rolling an invocation. It keeps the session, so `talk` resumes
a conversation and `fork` branches one, instead of every call starting from nothing. It takes
`--schema` with a validating repair loop, which is worth more than it sounds: a reply that
must satisfy a schema is harder to fabricate than a prose report, and prose reports from
agents have been wrong here more than once. It maps a team name to a working directory, so
the agent runs where it should without the caller composing a `cd`. And `--prompt-file`,
`--timeout` and non-tty-safe stdin mean it is meant to be driven by a script rather than a
person.

Where it does not help yet. `talk` is blocking and foreground — one turn per invocation,
`subprocess.run` under the hood, no completion signal. So an orchestrator that wants several
agents working at once must background them itself and poll, which is exactly the friction
that makes a Claude subagent the easier choice and quietly defeats the free-model rule above.
It also does not create git worktrees; a team points at one that already exists, and making
and removing it stays the caller's job. Those two gaps are filed as issues on this repository
and are meant to be fixed upstream in `agents-army` rather than worked around here.

Until the first of those lands, prefer `aarmy` for work that is naturally one turn at a time
and benefits from a session or a schema, and keep using Claude subagents where several pieces
of work need to run at once and report back on their own.

## Cost

Cost is a constraint Gabriel set, not a preference.

- No paid or external service enters without an issue labeled `needs-gabriel` that names the
  service, why it is needed, and what it costs. This covers email delivery, payments, hosted
  AI, and any SaaS.
- Prefer what is already here: `node:sqlite`, a single self-hosted VM, Cloudflare in front
  for TLS.
- Prefer a free model over a paid one for every rung that can carry the work, and
  prefer the smallest rung that can. The orchestrator's own tool calls are the most
  expensive tokens in the loop and are the exception, not the rule: if an agent can
  return the conclusion, an agent does, even for a two-line read.
- Slices are short, prompts are precise, and lookups go to the cheapest agent.

A bundle budget may be raised, but never as the reflex when a build goes over. Gabriel
set the rule on 2026-09-04: a raise is fine when real features have been added and the
orchestrator can say exactly what grew and why, naming the chunks and the byte counts.
When that account cannot be given, the answer is not a bigger number but a bundle analyzer
and a trim of whatever is largest. A raise arrives with its evidence in the pull request
that needs it: the old and new limits, the measured build size, where the growth landed,
and whether any new dependency entered. Repeated raises without that evidence mean the
budget has stopped being a budget.

## The five-hour window

Claude Code meters usage in a rolling five-hour window, and the orchestrator is
responsible for not spending the whole window in one cycle. The only supported way
to read the window is the status line hook, which receives
rate_limits.five_hour.used_percentage and rate_limits.five_hour.resets_at on its
standard input and fires only in an interactive session. The script at
~/.claude/statusline-usage.sh records both values to ~/.claude/usage-state.json on
every render, and the orchestrator reads that file rather than guessing.

At ninety-three percent the orchestrator stops delegating. It lets whatever is
already running finish, writes its cycle comment on the log issue, and waits for
the time in resets_at before starting anything new.

The threshold is a gate on starting new work rather than a stop, because an agent
already running has already committed its tokens and a long gate run can carry the
total past the threshold after the gate closes. Nothing wakes an idle session when
the window resets, so a session that means to resume by itself has to be running the
loop skill with a wait long enough to reach resets_at.

## Product state and priorities, as of 2026-09-03

Built: the six nutrition destinations, onboarding, logging by text, voice, search, manual
entry and a demo barcode; the exercise application with routines, sessions, planner and
progress; accounts, sessions, sign-in, sign-up and sign-out on SQLite behind `/signin`.

Not built: nothing a person records reaches the server. All state is one `localStorage`
document per device, so a reinstall or a second phone starts empty. The food catalog is
about 96 bundled foods while the ETL under `data/` has produced a database of 2.5 million
rows that nothing serves. Photo logging is a screen with no recognition behind it.

Agreed order:

1. **Data persists per account and comes back after sign-in.** One JSON document per
   account on the server, versioned; the store loads it at sign-in and pushes after every
   write; a stale device is told rather than allowed to overwrite. The whole
   TendState document syncs, including onboarded and activeProfileId, because
   with one account per household both are properties of the account rather
   than the device; activeProfileId becomes device-local only when household
   unparks. Conflict
   handling is versioned last-write-wins with a forced reload; merging is a later story.
2. **A real food catalog from the server.** A read-only connection to the ETL database,
   search and barcode endpoints, the bundled list kept as the offline fallback.
3. **Photo logging.** Needs the catalog first and will need a paid service, so it also
   needs a decision.

Parked, by decision: **household** as a feature. The schema keeps `household_id` on every
table and each account owns one household, so nothing is removed, but no household-facing
feature is built. There is no iOS shell.

## What needs Gabriel

- Product decisions: what a feature does, the flow, the wording of any promise the app
  makes to a person. Not how it looks: Gabriel handed the design over on 2026-09-04, so
  layout, color, type and the shape of a control are the orchestrator's to decide and to
  defend. He is the end user and will say when something reads wrong; that is feedback to
  act on, not a veto to wait for.
- Any spend, as above.
- Infrastructure access: the VM, DNS, Cloudflare, secrets. The orchestrator never handles a
  credential; it asks Gabriel to place it and says where.
- Lowering any gate threshold, changing branch protection, or reversing anything this file
  parks.
- Deleting user data — suspended until production by the development-only permissions at
  the top of this file, which is where it goes back on.

## Changing the infrastructure

The orchestrator holds a Cloudflare API token for the `psilva.org` zone from 2026-09-04,
placed by Gabriel under `~/keys/` and read from a path in the environment. It is never
printed, echoed, logged or committed, exactly like the Owen app key. The token can read and
write that zone's settings, which is enough to turn Speed Brain on or off; it does not need
DNS, Workers or cache access and should not be given them.

Two rules govern using it, and they exist because edge configuration is the least safe thing
either of us can touch. A code change is reviewed, gated by CI, and revertible from git
history. A zone setting takes effect globally the moment it is written, with none of that. On
2026-09-04 a single Cloudflare setting made the Android app unusable on every navigation, and
nothing in this repository could have caught it.

**Announce an infrastructure change on an issue, before and after.** Say what is about to
change and why, then say what changed and what was observed. That comment is the only record
such a change will ever have, so it stands in for the commit message, the diff and the
review all at once.

**Diagnosis is read-only.** Never change a setting to find out whether a change is possible.
The orchestrator broke this rule the day it was written, by testing write access with a live
`PATCH` that happened to be a no-op; a permission is confirmed by being asked for, not by
being used. Where the effect of a setting can be observed from outside — Speed Brain is
visible as a `speculation-rules` header on any response — prefer that check over the API,
because it needs no credential and reports what the edge is actually doing rather than what
the control plane believes.

## Deploy, as of 2026-09-03

The app is live at <https://fit.psilva.org>. It deploys from a fully clean checkout, so a
deploy runs from its own throwaway worktree — `bun run worktree:new deploy-<slug>` makes one
already carrying `node_modules`, and `bun run worktree:done deploy-<slug>` removes it once
the deploy is done. One command from a clean checkout deploys it:

```bash
FIT_DEPLOY_HOST=user@host bun run deploy
```

The host is Gabriel's VM. It is not written down in this repository, in an issue, or in
anything the deploy installs on the machine, and the script refuses to run without it, so
the only place it lives is the shell that runs the deploy.

Cloudflare terminates TLS and forwards plain HTTP to the origin's port 80. There is no
proxy on the VM and no certificate on it: the unit binds 80 itself, as the unprivileged
`fit` user, with `AmbientCapabilities=CAP_NET_BIND_SERVICE` and nothing else in its
bounding set. That pairing is the whole reason `PORT=80` and the capability have to agree,
and `scripts/deploy/deploy.spec.ts` fails if they stop agreeing.

The build runs locally: the VM has 2 GB and cannot hold Vite beside the running server.
What crosses is `build/`, the `package.json` beside it, and a production `node_modules`
resolved from `bun.lock` — `adapter-node` leaves every `dependencies` entry external, so
the server bundle really does need them. `scripts/deploy/deploy.ts` then installs the
pinned Node from nodejs.org if the machine is missing it, lands the release in
`/opt/fit/releases/<commit>/`, writes `/etc/fit/fit.env` only when it is absent and
`fit.service` always, switches `/opt/fit/current`, restarts the unit, waits for it to
answer, prunes all but the last five releases, and runs the smoke check.

On the machine: a system user `fit`; releases under `/opt/fit`; the SQLite database under
`/var/lib/fit`, which is `0700` and the only path `ProtectSystem=strict` leaves writable;
Node under `/opt/node`.

`/etc/fit/fit.env` is `0600` and root-owned, and `scripts/deploy/fit.env.example` is the
template it is written from: `ORIGIN=https://fit.psilva.org`, which is also the origin
policy's allow-list; `HOST=0.0.0.0` and `PORT=80`; `FIT_CLIENT_ADDRESS=forwarded` with
`ADDRESS_HEADER=cf-connecting-ip`, so the sign-in throttle keys on the visitor rather than
on Cloudflare; and `FIT_DB_PATH=/var/lib/fit/app.sqlite`. There are no secrets in it yet.
When there are, Gabriel places them in that file by hand and the deploy leaves them alone.

The smoke check is `bun run deploy:smoke`, and the deploy ends with it: `/signin` answers
with a page this app built rather than with whatever else could be listening on that port,
an anonymous session read is refused as `unauthenticated`, a throwaway account registers,
signs out, signs back in and reads itself back, and `/opt/fit/current` points at the commit
that was deployed. It writes `reports/deploy/smoke.json`, which is what the comment on the
story being deployed is written from. It leaves the throwaway account behind — nothing
deletes accounts yet — under a `smoke.` username. `--tunnel` on either command runs it
through an SSH port forward to the origin instead of through Cloudflare, which is how a
deploy is checked when the public name is the thing that is broken. Only that mode sends
the client-address header: Cloudflare sets it itself and answers 403 to a request that
already carries one, while the origin reached directly has nothing else to learn an
address from.

Known, and Gabriel's to decide if either becomes a problem: the zone is on Cloudflare's
Flexible SSL mode, so the hop from Cloudflare to the origin is unencrypted — moving to Full
would mean a certificate and a proxy on the VM, and a different `HOST` and `PORT` in the
environment file. And because Cloudflare supplies `CF-Connecting-IP` itself, every smoke
check run through the public name is throttled as one address — this machine's; ten
registrations an hour is the ceiling on deploys per hour.

The Android build is pointed at the same server by `FIT_CAPACITOR_SERVER_URL`, which must
be `https://`.

## Resuming after a context reset

1. Read this file, then `AGENTS.md`.
2. Read the last comment on the orchestrator log issue.
3. `gh issue list --label needs-gabriel` for anything he has answered, then the open stories.
4. `git status`, `git log --oneline -20`, and any worktree under `.claude/worktrees/`.
5. Continue at step one of the cycle.
