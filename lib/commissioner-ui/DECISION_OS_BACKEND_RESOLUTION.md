# Decision OS Backend Gap — Resolution

Date: 2026-07-03. All findings below come from direct git archaeology
(commit history, diffs, tree comparisons) against the actual repository
state — not from memory, which was itself found to be branch-scoped and
corrected during Phase 3.0 (see `LIVE_INTEGRATION_FOUNDATION.md` §1). No
code was checked out, merged, or modified as part of this investigation;
no Commissioner OS UI, adapter contract, or `live.ts` was touched.

## 1. Decision OS Backend Discovery Report

**All Decision OS backend work lives on a single branch: `g15-event-foundation`.**

```
git log --oneline --all -- 'lib/decision-os/*'
```
resolves every matching commit to `refs/heads/g15-event-foundation` — no
other branch among the 20+ in this repository (`git branch -a`) contains
any of it.

Key facts about that branch:
- **161 commits ahead of `main`, 0 behind** (`git rev-list --left-right --count main...g15-event-foundation`
  → `0  161`) — a clean, linear extension of `main` with zero divergence
  on `main`'s side. `main` has not advanced since this branch forked from
  it.
- **76 of those 161 commits touch `lib/decision-os/*`** specifically. The
  other ~85 are unrelated feature work — NFL redraft production
  providers, draft runtime, canonical league runtime, live scoring — most
  recently as of **today** (`2026-07-03 08:01:48`, "G49H wire NFL redraft
  production providers").
- **This branch is actively being worked on right now, or very recently.**
  The repository's primary checkout (`F:/allfantasy-v2-main`, not this
  worktree) is currently sitting *on* `g15-event-foundation` with **238
  uncommitted paths** — live, in-progress, uncommitted work. I did not
  touch it, run anything in it, or check it out anywhere else; this is
  very likely a concurrent session's active work, and treating it as
  available for me to experiment against would risk disturbing someone
  else's in-progress state.
- `lib/decision-os/` itself: **192 files, 42,704 insertions, 0 deletions**
  relative to `main` — a purely additive body of work, not a modification
  of anything pre-existing within its own directory.

## 2. Branch Compatibility Report

| Dimension | Finding |
|---|---|
| **Architecture compatibility** | Sound in isolation — Canonical World (origin-blind fact layer), Behavioral Events (new `DomainEvent`/`EventOutbox` Prisma models — a real event-sourcing/outbox pattern), Behavioral Intelligence derivers, and a deliberately curated external "Intelligence API" (`app/api/v1/intelligence/{platform,league,manager}/route.ts`) with its own auth/scopes/rate-limit design. The Intelligence API is exactly the kind of clean HTTP boundary Commissioner OS's Phase 3.0 transport (`callDecisionOS`) was built to call — see §3 below for why this matters. |
| **Adapter compatibility** | **No direct coupling exists or is needed.** Commissioner OS's adapter never imports anything from `lib/decision-os/`, and the reverse is also true. The connection, if made, would be over HTTP (Commissioner OS's `DECISION_OS_BASE_URL` → the Intelligence API), not a code-level import — so "adapter compatibility" is really a question of whether the Intelligence API's response shapes can be mapped into Commissioner OS's existing Platform Contracts, which is a Phase 3.1+, per-module question, not a foundation-level blocker. |
| **Contract compatibility** | Commissioner OS's `CommissionerPlatformResponse<T>`/`CommissionerErrorContract` were not designed against the Intelligence API's actual response shapes (that API predates this cross-reference). Expect a real mapping/translation layer to be needed per module in Phase 3.1 — this is normal, expected integration work, not a red flag. |
| **Test coverage** | Substantial and real: **72 dedicated test files** under `__tests__/decision-os/`, plus `scripts/decision-os-*-conformance.ts` (5 conformance scripts per commit-message convention) and `scripts/slice{1,2,3,4}-staging-parity.ts`. I did **not** re-execute this suite — see Risk Assessment #1 for why, and what to do before relying on it. |
| **Dependency conflicts** | **None found.** `package.json` diff shows only new *scripts* (`dev:staging-lite`, `worker:live-score`, etc.), zero new npm dependencies. No version-conflict risk. |
| **Stale assumptions** | The branch's own Prisma migrations (4 new files, 186 insertions, purely additive — `DomainEvent`, `EventOutbox`) do not exist on `main` or this branch at all (`grep -c "model DomainEvent\|model EventOutbox" prisma/schema.prisma` → `0` on this branch) — no naming collision, and this branch's own `prisma/schema.prisma` is otherwise identical to `main`'s (zero diff), so these migrations would apply cleanly. |
| **Merge risk — Commissioner OS specifically** | **Zero.** Verified twice, two different ways: a direct path-scoped diff (`git diff --stat main..g15-event-foundation -- 'lib/commissioner-os/*' 'components/commissioner-os/*' 'app/commissioner-os/*'` → empty) and an exhaustive file-list check across all 76 decision-os commits (`grep -i "commissioner-os"` across every file they touch → zero matches). The three files *this* branch has modified (`app/globals.css`, `middleware.ts`, `vitest.setup.ts`) are also untouched by `g15-event-foundation` relative to `main`. |
| **Merge risk — broader** | The 76 decision-os commits also modify **3 pre-existing production routes** outside `lib/decision-os/` (`app/api/redraft/trade-proposals/route.ts`, `app/api/today/lineup-actions/route.ts`, `app/api/waiver-ai/engine/route.ts`) — consistent with the "Shadow Validation" pattern (beside-legacy, flag-gated) described in this program's own commit messages. These need real review before merge, but are unrelated to Commissioner OS. A **separate, distinct concern (not Commissioner OS's)**: real UI consumers already exist for a *different* surface — `components/decision-os/*`, wired into `app/dashboard/*` and `app/commissioner-hub/*` (a separate, older "Commissioner Hub" feature — confirmed structurally distinct from this program's `commissioner-os` naming; this is what caused two background research agents to falsely report "commissioner-os doesn't exist" during Phase 2, having found this instead). |
| **Commit structure** | Decision-os commits arrive in substantial clusters (runs of 7, 8, 11, 16, 17 commits) interleaved with the ~85 unrelated commits, ending in one 25-commit unrelated tail (the most recent NFL redraft work). Not one clean contiguous range — a commit-by-commit cherry-pick would be needlessly fragile. A path-scoped snapshot port (§3) sidesteps this entirely. |

## 3. Merge / Port / Rebuild Recommendation

**Selectively port — not a full merge, not reference-only, not discard, and not a rebuild.**

**Do not merge the whole branch.** `g15-event-foundation` is 161 commits
covering far more than Decision OS — merging it wholesale would pull in
~85 commits of unrelated NFL redraft/draft-runtime/staging work, and the
3 pre-existing-route modifications need their own independent review
regardless of what happens with Decision OS.

**Do not discard or reference-only.** The work is real, substantial,
already tested (72 test files), architecturally sound, and has zero
merge conflict with Commissioner OS. Discarding it and rebuilding from
scratch would be pure waste; treating it as "read for inspiration only"
undersells how close to usable it already is.

**Do not rebuild a new backend on the current branch.** There is no
technical reason to — the existing work is compatible, untested-here but
not conflicting, and rebuilding would duplicate 42,704 lines of already-written,
already-tested logic for no benefit.

**The concrete recommendation:**

1. **Port only the Decision OS-relevant subset** — `lib/decision-os/` in
   full, its 4 new Prisma migrations, `app/api/v1/intelligence/*` +
   `app/api/decision-os/*`, its own `__tests__/decision-os/` suite, and
   the `scripts/decision-os-*-conformance.ts` validation tooling. **Not**
   `components/decision-os/*`, the dashboard/commissioner-hub wiring, or
   the Widget SDK/partner-sandbox surface — none of that serves
   Commissioner OS, and each adds its own separate review burden.
2. **Port via a path-scoped snapshot, not a commit-by-commit cherry-pick**
   — e.g. `git checkout g15-event-foundation -- <paths>` on a fresh
   branch off `main`, taking the *current state* of just those paths
   rather than replaying 76 interleaved commits and their dependencies on
   the ~85 unrelated ones in between. This is safer and dramatically
   simpler given the interleaving found in §2.
3. **Target `main`, not this Commissioner OS branch.** Commissioner OS's
   own branch has no reason to carry a separate team's backend engine.
   Once the ported subset lands on `main`, is reviewed, and is deployed
   (its Intelligence API reachable at a real URL), Commissioner OS
   connects to it purely over HTTP: set `DECISION_OS_BASE_URL` to that
   URL. **Zero code-level coupling is needed** — this is exactly why
   Phase 3.0 built `callDecisionOS` as a generic HTTP transport rather
   than a direct in-process import. The "port" question is about getting
   a real backend *deployed and reachable*, not about pulling its source
   into Commissioner OS's own files.
4. **Coordinate before touching `g15-event-foundation` at all.** It was
   committed to as recently as this morning and its primary checkout
   currently has 238 uncommitted paths — this reads as active,
   concurrent work. Porting from it without checking first risks
   clobbering or ignoring very recent progress.

## 4. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Decision OS test suite's *current* pass/fail state was not re-verified live in this investigation | Medium | Deliberately not run — the branch's primary checkout has 238 uncommitted paths suggesting concurrent work; running a heavy test suite against a live, in-flux checkout risked interfering with someone else's session. **Re-run the full `__tests__/decision-os/` suite against whatever exact commit is chosen for the port, before relying on it — this is a hard prerequisite**, not optional. |
| The branch is under active/concurrent development | Medium-High | Do not port silently. Confirm with whoever is currently working on `g15-event-foundation` before pulling from it, and re-diff immediately before porting (state may have moved since this report). |
| 3 pre-existing production routes are modified by decision-os commits | Medium | Out of Commissioner OS's scope, but if the port includes anything touching those (it doesn't need to — they're not in the recommended port list above), they need independent review by whoever owns those routes' current behavior. |
| Intelligence API response shapes don't yet map onto Commissioner OS's Platform Contracts | Low (expected) | Normal Phase 3.1 integration work, one module at a time — not a foundation-level blocker. Each module's real `live.ts` will need its own response-mapping code, same as any external API integration. |
| The "Commissioner Hub" / `commissioner-hub` naming collision with this program's "Commissioner OS" naming | Low, but real | Already caused two background research agents to falsely report this program's own code didn't exist (Phase 2). Purely a naming-confusion risk for humans and agents alike, not a technical one — worth a clear one-line note in team-facing docs distinguishing the two. |
| Porting introduces the 4 new Prisma migrations to a shared schema | Low | Verified additive-only, zero naming collision, this branch's own schema is otherwise identical to `main`'s — low technical risk, but any schema migration to a shared database still needs the normal migration-review process before applying in any real environment. |

## 5. Proposed Phase 3.1 Plan

1. **Confirm and coordinate** — verify with the team/session currently on
   `g15-event-foundation` that porting the subset in §3 is expected and
   safe, and get a final commit hash to port from (not "whatever HEAD is
   right now").
2. **Re-verify test health** — check out that exact commit in an isolated
   worktree, run `__tests__/decision-os/` and the conformance scripts,
   confirm they're genuinely green before proceeding.
3. **Port the subset** (§3) into a new branch off `main`, reviewed as its
   own PR — this is infrastructure work independent of Commissioner OS's
   own branch and should be reviewed on its own merits.
4. **Deploy** that branch (or merge to `main` and deploy normally) so the
   Intelligence API is reachable at a real URL in at least one real
   environment (staging first).
5. **Set `DECISION_OS_BASE_URL`/`DECISION_OS_API_KEY`** for that
   environment — Commissioner OS's Phase 3.0 transport needs no other
   change to start reaching it.
6. **Pick the first namespace to wire for real** — likely League Health
   or Mission Control (the modules the Intelligence API's existing
   `platform`/`league`/`manager` endpoints most directly match) — and,
   for that one namespace only: map its real response shape onto the
   namespace's Platform Contract, replace its `live.ts` placeholder with
   a real `callDecisionOS` call gated by `isLiveReady(moduleId)`, verify
   parity against demo data, then call `setLiveReady(moduleId, true)`.
7. **Repeat per namespace**, in whatever order real backend readiness
   supports — this was already the Phase 3.0 roadmap's own step 3, now
   unblocked with a concrete backend to point at.

No module-specific `live.ts` work has been started as part of this
report, per your instruction. Nothing in Commissioner OS's UI, adapter
public contracts, or any page changed.
