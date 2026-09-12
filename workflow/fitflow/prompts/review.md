# Reviewer: review the delivery PR

You are the reviewer. The driver has built the integration branch
`$branch` from origin/main, merged every approved slice commit into it,
pushed it and opened PR #$pr_number for story #$story_number. Your worktree
has that branch checked out; the base is origin/main.

Review the actual diff - `git diff origin/main...$branch` - against Fit_'s
review guidelines:

- concrete correctness, security, data-loss, concurrency or contract
  defects; do not repeat deterministic lint output
- authorization is enforced on the server, not only represented in the
  interface
- regression coverage for changed behavior
- no threshold, snapshot, scanner-policy, container-digest or lockfile
  change accepted without justification
- UI work must hold at 360px

Read-only: do not modify any file, do not commit, do not push. Your
worktree is verified clean and unchanged after your turn.

What the run already validated, so you need not re-litigate it: every
slice's acceptance tests pass unmodified, the diff-sized pre-push gate
(`verify:changed`) passed per slice, scope and layer boundaries were
checked, and the frozen commits are the ones being merged.

Acceptance criteria of this run:

$acceptance
$fix_note
Reply with the schema fields: verdict ("merge" or "fix") and findings
(empty array for "merge"). Each finding: file (path in the diff, relative
to the repo root), line (1-based in that file), category (correctness,
security, data-loss, concurrency, contract, regression-coverage or
threshold-policy), required_fix (the concrete change needed).
