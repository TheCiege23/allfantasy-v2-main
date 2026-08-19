# Decision OS Demo — Foundation Publication Decision Audit (Phase 7)

**Decision audit only.** No branches pushed/created/deleted, no PR opened, no history rewritten,
no code, no live DB. Answers: *how (if at all) should the missing remote foundation be published
so a clean GitHub PR for the Decision OS demo workstream becomes possible?*

**Headline recommendation:** **Do NOT publish the foundation just to enable a PR.** Keep
**direct branch review (Option C)** for now. The "foundation" is **154 commits of mixed,
multi-session, week-long development** — not a clean isolated dependency — so publishing it is a
**cross-workstream release decision** that belongs to those workstreams' owners, not to this demo
workstream.

---

## Remote mismatch summary

- Clean review branch `origin/decision-os-demo-review` (tip `7c60a09aa`) is based on the **local**
  commit `58da8a44a` (Replay P22).
- **Remote `g15-event-foundation` is 171 commits BEHIND local**; its tip `9845cbd3e`
  ("feat(import): Commissioner Intelligence Preview modal", 2026-06-30) does **not** contain
  `58da8a44a`.
- **No remote branch contains `58da8a44a`** (`git branch -r --contains 58da8a44a` → only the
  review branch). So a clean PR (`decision-os-demo-review` → any current remote base) is
  impossible; PR #157 against remote g15 showed 848 files and was closed.

The "missing foundation" a clean PR base would need = **`9845cbd3e..58da8a44a`**.

## Foundation commit inventory (`9845cbd3e..58da8a44a`)

- **154 commits**, spanning **2026-06-30 → 2026-07-07** (a week).
- The foreign NFL-playoffs commit `3c1600131` is **NOT** in this range (it's above `58da8a44a`, in
  the demo workstream, already excluded from the review branch).
- **Mixed, multi-workstream, multi-session** — NOT a clean "Replay-only foundation":

| Theme (approx.) | Commits | Notes |
| --- | --- | --- |
| `feat(...)` app work | ~42 | broad, many sessions |
| Replay Framework (Phases → 22) | 19 | the actual Decision-OS-demo dependency |
| Decision OS / Trade Learning | ~10 | **off-limits workstream** (calibration/learning) |
| Provider migration (GG–GJ) | ~4 | NFL redraft provider orchestration/validation |
| RC Launch / Closed Beta / certification | several | **production-readiness work** |
| Landing page redesign, stabilization passes, docs, chores, `gm-profile` retirement, etc. | rest | mixed |

- **15 commits touch high-stakes / off-limits themes** (Trade Learning, RC/beta certification,
  provider migration) — work this demo workstream was explicitly told **not** to touch.
- **Type status:** the foundation is **not type-clean** — the base `58da8a44a` alone carries **176
  pre-existing typecheck errors** (measured on the clean branch; all inherited from the base, zero
  from the demo workstream).

**Conclusion:** the foundation is a large, shared, partially-off-limits, not-type-clean history.
Publishing it is a **release/branch-management decision across multiple workstreams**, not a step
this demo workstream should trigger on its own.

---

## Publication options

### Option A — Push local `g15-event-foundation` to remote
Fast-forwards remote g15 by 171 commits; makes the existing branch current; enables a clean PR from
`decision-os-demo-review` afterward.
- **Risk: HIGH.** Silently publishes all 171 local commits — Replay + **Trade Learning** + RC/beta
  certification + provider migration + ~42 feats + the foreign `3c1600131` — much of it other
  sessions' and possibly unfinished/off-limits work. Overwrites the shared remote branch's tip.

### Option B — Create a dedicated foundation review branch (`decision-os-foundation-review`)
Branch at `58da8a44a`, push it, then open **stacked PRs**: PR1 foundation → g15, PR2 demo →
foundation. Does not overwrite remote g15; gives a clean foundation/demo split.
- **Risk: MEDIUM.** Still publishes the same **154 mixed commits** as PR1's review surface (Trade
  Learning, RC/beta, provider work included). Requires a **deliberate cross-workstream
  publish-readiness review** and reviewers who understand the stack. Larger review surface.

### Option C — Keep direct branch review only (current)
Review `origin/decision-os-demo-review` directly against `58da8a44a` (clean 55-file / 15-commit
diff; 156 tests verified). No foundation publish.
- **Risk: LOW.** No GitHub PR diff against a proper base; slightly less convenient CI/reviewer
  workflow. Already available and working.

## Risk table

| Option | Publishes foundation? | Touches shared remote g15 | Exposes off-limits work | Review surface | Risk |
| --- | --- | --- | --- | --- | --- |
| A — push local g15 | yes (171 commits) | **yes, fast-forwards it** | yes (Trade Learning/RC/provider) | huge | **HIGH** |
| B — foundation branch + stacked PRs | yes (154 commits, new branch) | no | yes (in PR1) | large (split) | MEDIUM |
| C — direct review only | no | no | no | clean 55-file | **LOW** |

---

## Recommendation

1. **Now: Option C (direct review).** It is already working, publishes nothing, and gives a clean
   55-file / 15-commit review of exactly the demo workstream. See
   [DECISION_OS_PR_READINESS.md](./DECISION_OS_PR_READINESS.md#direct-review-do-this-now).
2. **Do NOT do Option A.** Never fast-forward the shared remote `g15-event-foundation` just to
   enable a demo PR — it silently publishes 171 commits of mixed, partially-off-limits,
   not-type-clean work owned by other workstreams.
3. **If a GitHub PR workflow is truly required later: Option B, not A — and only after an explicit,
   separate cross-workstream sign-off** that the 154-commit foundation (Replay + Trade Learning +
   RC/beta + provider migration) is ready to be published. Then open the stack:
   - **PR 1:** `decision-os-foundation-review` → `g15-event-foundation` (the 154-commit foundation)
   - **PR 2:** `decision-os-demo-review` → `decision-os-foundation-review` (the clean 15-commit demo)

## Exact commands (do NOT run without explicit approval)

**Option B (recommended path, if approved):**
```bash
# 1) create + publish a foundation review branch at the base (does NOT touch remote g15)
git branch decision-os-foundation-review 58da8a44a
git push -u origin decision-os-foundation-review
# 2) stacked PRs (both can be drafts):
gh pr create --base g15-event-foundation --head decision-os-foundation-review \
  --title "Decision OS foundation (Replay + intelligence) — review base" --draft
gh pr create --base decision-os-foundation-review --head decision-os-demo-review \
  --title "Decision OS Demo Layer: Manager + Commissioner Intelligence" \
  --body-file docs/DECISION_OS_DEMO_PROOF_PACKAGE.md --draft
```

**Option A (NOT recommended):** `git push origin g15-event-foundation` — fast-forwards the shared
remote branch by 171 commits. **Do not run.**

## What NOT to do

- ❌ Do not push local `g15-event-foundation` (Option A).
- ❌ Do not open a PR against stale remote `g15-event-foundation` or `main` (bundles the 154+
  foundation commits → 848-file diff, as in the closed #157).
- ❌ Do not create/push a foundation branch, merge, delete branches, or rewrite history **without
  an explicit, separate release decision** by the owners of the Replay / Trade Learning / provider
  / RC workstreams in that foundation.
- ✅ Until such a decision: **review `origin/decision-os-demo-review` directly.**
