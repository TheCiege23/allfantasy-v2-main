# Decision OS Demo — PR Readiness (clean review branch)

Companion to [DECISION_OS_DEMO_PROOF_PACKAGE.md](./DECISION_OS_DEMO_PROOF_PACKAGE.md). Records the
clean-branch preparation so the Decision OS demo workstream can be reviewed **without** the
unrelated concurrent churn on `g15-event-foundation`.

> **Status (2026-07-08):** Clean branch **pushed and reviewable directly** at
> `origin/decision-os-demo-review`. **Draft PR #157 was opened and then CLOSED** — the remote base
> was stale and it showed 848 files instead of the clean 55 (see
> [Why PR #157 was closed](#why-pr-157-was-closed-remote-base-mismatch)). **Do not reopen a PR
> until a remote base containing `58da8a44a` exists.** Review the branch directly for now (see
> [Direct review](#direct-review-do-this-now)). Foundation-push is a **separate, explicit
> release decision**, not part of this workstream.

## Clean branch

- **Branch:** `decision-os-demo-review` (worktree: `C:/tmp/af-decision-os-review`)
- **Base:** `58da8a44a` (Replay Framework Phase 22) — the commit just before the workstream; it
  carries the prior Replay/intelligence infra the workstream depends on.
- **Contents:** exactly the **15 workstream commits**, cherry-picked in order onto the base. The
  interleaved **foreign commit `3c1600131` ("Wire the NFL redraft Playoffs UI…") was EXCLUDED**
  (it sat between Commissioner P3 and P4 on g15; zero file overlap with the workstream, so the
  cherry-pick was conflict-free).

Cherry-picked order (g15 SHA → new SHA):
```
4752e6b35→077bb2eea  Manager P1 (hub shell)
f7e243e56→c53444f92  Manager P2 (Team Health)
7e1fa88ad→3b083200c  Manager P3 (Weekly Outlook)
dbe0cf85c→da6e5973b  Manager P4 (Transaction Readiness)
66e44e654→67f32ab09  Manager P5 (polish + live-like)
7ea0b6d21→442cc8898  Manager P6 (non-prod runbook)
c09e6f457→ffeffb0b0  Commissioner P1 (proof audit)
3b0898056→b4355e8ab  Commissioner P2 (demo readiness + seed runbook)
fbc233011→52e82a124  Commissioner P3 (Trade Review audit)
60d47c249→8c1e8385b  Commissioner P4 (Trade Review contract)
1fafc4b0c→841c6a753  Commissioner P5 (Rule/Settings audit)
f2af183f5→5a3234b16  Commissioner P6 (Rule/Settings contract)
1beaa47d6→a558a2fe9  Demo Layer P1 (launchers + flow)
ce3b2e9ba→75a679e26  Demo Layer P2 (storyboard)
c02766f90→7c60a09aa  Demo Layer P3 (proof package)
```

## Verification (on the clean branch, in the worktree)

- **Tests:** 15 files / **156 tests PASS** — the whole workstream surface (Manager aggregators +
  routes + hub, Commissioner aggregators + routes + hub + nav-entry + proof-surface, non-prod
  guard, demo-flow entry points).
- **Typecheck:** **176 errors — ALL pre-existing on the base `58da8a44a`; ZERO in workstream
  files.** (The workstream adds no type errors. The 176 are inherited from the mid-development
  base — playoffs config, waiver AI, world-cup, sleeper-import, scoring-runtime, etc.)
- **Working tree:** clean (no unrelated churn; every changed file vs base belongs to the workstream).
- **Boundaries preserved:** no recommendation endpoint consumed, no live DB, no prod defaults, no
  Replay/Manager/Commissioner-contract changes outside their own build phase.

## Honest mergeability caveat

`decision-os-demo-review` cleanly **isolates the workstream**, but it is **not independently
main-mergeable**: its base (Replay P22) is an unmerged development commit with 176 pre-existing
type errors and depends on prior g15/Replay/intelligence infra that is not on `main`. Review this
as a **stacked unit on top of that foundation** — it should land after (or together with) the
g15/Replay lineage it builds on, not as a standalone PR against `main`.

## Why PR #157 was closed (remote-base mismatch)

Draft PR #157 (`decision-os-demo-review` → `g15-event-foundation`) was opened, then **closed
unmerged** because it showed **848 files / 139,812 additions**, not the clean 55-file workstream
diff. Root cause:

- The clean branch's base is the **local** commit `58da8a44a` (Replay P22).
- **Remote `g15-event-foundation` is 171 commits BEHIND local** — its tip `9845cbd3e`
  ("Commissioner Intelligence Preview modal") does **not** contain `58da8a44a` or the Replay /
  Decision-OS foundation the workstream depends on. That foundation is **local-only, never pushed
  to any remote branch** (`git branch -r --contains 58da8a44a` → only `origin/decision-os-demo-review`).
- So the PR merge-base was the stale remote tip, and the diff = **foundation + workstream** (848
  files). A clean workstream-only PR is **impossible against any current remote base.**

> **⚠ Do NOT reopen a PR against remote `g15-event-foundation` (or `main`).** It will bundle the
> entire 171-commit foundation and mislead reviewers. Wait until a remote base that already
> contains `58da8a44a` exists.

## Direct review (do this now)

The branch is pushed and clean — review it **directly against its base `58da8a44a`**, which shows
exactly the **55-file / 15-commit** workstream (verified):

```bash
git fetch origin decision-os-demo-review

# the clean workstream diff (55 files, +6483/-19) — NOT the 848-file stale-remote diff:
git diff --stat 58da8a44a..origin/decision-os-demo-review
git diff        58da8a44a..origin/decision-os-demo-review      # full review diff

# the 15 workstream commits:
git log --oneline 58da8a44a..origin/decision-os-demo-review

# every changed file belongs to the workstream (this prints nothing = clean):
git diff --name-only 58da8a44a..origin/decision-os-demo-review \
  | grep -viE 'decision-os|commissioner-intelligence|manager-intelligence|manager-hub|commissioner/(trade-review|rule-settings)|app/api/app/leagues|LeagueTab|scripts/manager-intelligence|docs/(DECISION_OS|MANAGER_INTELLIGENCE|COMMISSIONER)|__tests__/(decision-os|commissioner-intelligence|dashboard/manager)'
```

### Re-run the verification (already green)

In a checkout/worktree of the branch (node_modules available):
```bash
npx vitest run \
  __tests__/decision-os/manager-team-health-aggregator.test.ts \
  __tests__/decision-os/manager-weekly-outlook-aggregator.test.ts \
  __tests__/decision-os/manager-weekly-outlook-route.test.ts \
  __tests__/decision-os/manager-transaction-readiness-aggregator.test.ts \
  __tests__/decision-os/manager-transaction-readiness-route.test.ts \
  __tests__/decision-os/commissioner-trade-review-aggregator.test.ts \
  __tests__/decision-os/commissioner-trade-review-route.test.ts \
  __tests__/decision-os/commissioner-rule-settings-aggregator.test.ts \
  __tests__/decision-os/commissioner-rule-settings-route.test.ts \
  __tests__/decision-os/manager-intelligence-nonprod-guard.test.ts \
  __tests__/decision-os/demo-flow-entry-points.test.ts \
  __tests__/dashboard/manager-intelligence-hub.test.tsx \
  __tests__/commissioner-intelligence/ \
  --no-file-parallelism
# → 15 files / 156 tests PASS (already verified on the clean branch)
```

The PR body draft (for whenever a real PR becomes possible) lives in the
[proof package](./DECISION_OS_DEMO_PROOF_PACKAGE.md#recommended-pr-description).

## Opening a real PR later (blocked until the foundation is on a remote base)

A clean workstream-only PR needs a **remote base branch that already contains `58da8a44a`**. Today
none exists. Options (all require an explicit, separate decision — the foundation is **not** part
of this workstream):

1. **Publish the foundation first.** Push local `g15-event-foundation` (or a dedicated
   `decision-os-foundation` branch at/after `58da8a44a`) to origin — a **large, shared** action
   that also publishes 171 commits of other sessions' work (incl. the foreign `3c1600131`). Then
   open `decision-os-demo-review` → that updated base; the PR would show only the 55 workstream
   files.
2. **Keep reviewing directly** via the commands above (no PR needed).

Until then, the correct status is: **Clean branch pushed and reviewable directly. PR blocked by
missing remote foundation. Do not reopen until a remote base containing `58da8a44a` exists.**
