import 'server-only'

import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS } from '../domain-os/types'

/**
 * Draft OS — maintained fact state for the draft runtime.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * 🛑 READ THIS BEFORE WIRING ANYTHING TO IT. `lib/decision-os/league-os/` HOLDS THE SAME FACT.
 *
 * Both cache `resolveCanonicalLeagueRules`. The duplication is deliberate and the two TTLs are two
 * correct answers to two different access patterns, not a bug and a fix:
 *
 *   draft-os   6h   right for a DRAFT. Rules do not change mid-event, the reader is inside one,
 *                   and a live draft polls constantly — a short TTL would re-derive seven queries
 *                   over and over for a fact that provably is not moving. Pinned by
 *                   __tests__/draft-os.test.ts, so it is a decision rather than a default.
 *   league-os  60s  right for ORDINARY READS. The realistic sequence there is "commissioner
 *                   changes scoring, then opens the roster screen", and a 6h entry answers that
 *                   with the old rules while looking authoritative.
 *
 * 🛑 AND THIS MODULE'S FACT NOW HAS NO CONSUMER AT ALL. `resolveNflRedraftDraftRuntime` was the
 * only one, it had zero callers of its own, and it was DELETED on 2026-09-06 — see the retirement
 * record below. Live drafts run on `lib/live-draft-engine/DraftSessionService`. Meanwhile
 * playoff-runtime (4 routes), roster-runtime (1) and schedule-runtime (1) all pay for the same
 * ruleset, which is why League OS exists and why it is the one that is wired.
 *
 * ⚠ SO `draftRulesSource` IS NOW A WRITE WITH NO READ — the cron warms it hourly and nothing
 * consumes it. That is stated plainly rather than softened, because it is the whole case for
 * eventually removing this module, and the next person should not have to re-derive it.
 *
 * ⚠ "SOLE CONSUMER" USED TO SAY *THIS MODULE'S*, AND THAT WAS WRONG — corrected 2026-09-06. The
 * resolver consumes the fact; `app/api/cron/domain-os-refresh/route.ts` consumes the MODULE, and
 * has since `63588d261` (2026-08-31 17:35). It warms `draft/rules` hourly: 242 rows in
 * `domain_os_facts`, all NFL, measured 2026-09-06. So this module is not dead code — it is a
 * fact that is written on a schedule and read by nobody, which is a different thing and has a
 * different fix.
 *
 * ── 1.2b, DECIDED 2026-08-31: DO NOT GIVE THE DRAFT RUNTIME A ROUTE ─────────────────────────
 *
 * The tempting argument is symmetry — three of four canonical runtime resolvers have routes, so
 * the fourth looks unfinished. That is an aesthetic claim, and acting on it would manufacture the
 * exact defect this codebase keeps paying for: a SECOND way to read draft state alongside
 * `live-draft-engine`, which is the adopted one and serves `/api/draft/room/state` and the
 * commissioner draft route today.
 *
 * The evidence for how that ends is in this repository, three times over: three modules computing
 * league health, two entry points for waiver settings, and a ruleset cached twice at different
 * lifetimes. Every one began as a reasonable second implementation. None of them is cheap to
 * reconcile now.
 *
 * ⚠ THE MODULE IS NOT DELETED, AND THAT IS ALSO A DECISION. It is tested, it is harmless, and
 * `live-draft-engine` has not been shown to cover everything the canonical resolver models.
 * Deleting on "nothing calls it" alone would be the same confidence that produced the three
 * duplicates above, pointed the other way.
 *
 * 🛑 SO IT IS DEPRECATED IN PLACE, WITH THE CONDITION FOR RETIRING IT WRITTEN DOWN RATHER THAN
 * LEFT TO JUDGEMENT. The condition was: *when someone confirms `live-draft-engine` covers every
 * fact `resolveNflRedraftDraftRuntime` returns, delete the resolver AND this module together,
 * since nothing else imports either.*
 *
 * ✅ THAT CHECK WAS RUN ON 2026-09-06. THE CONDITION COULD NOT BE SATISFIED, AND THE REASON WAS
 * STRUCTURAL RATHER THAN A MATTER OF EFFORT: the resolver was not a RIVAL to `live-draft-engine`,
 * it was a CONSUMER of it. Its line 3 imported `buildSessionSnapshot`
 * from `@/lib/live-draft-engine/DraftSessionService` and it built four further facts on top:
 *
 *   state            buildSessionSnapshot → buildCanonicalDraftRuntimeState   snapshot FROM it
 *   rules            resolveCanonicalLeagueRules                              absent from it
 *   recommendations  buildSmartDraftRecommendations                           absent from it
 *   intelligence     deriveDraftRuntimeIntelligence                           absent from it
 *   playerCoverage   getResolvedDraftPoolForLeague (limit 350)                see below
 *
 * Three of those five names appear NOWHERE under `lib/live-draft-engine/`. The pool appears once,
 * in `autopickBestAvailableSubmit.ts` behind a legacy fallback — not in the snapshot. So
 * "live-draft-engine covers every fact" could only become true by moving four capabilities INTO
 * it, which is the second implementation this header exists to prevent, pointed the other way.
 * A condition that can only be met by committing the defect it guards against is not a condition.
 *
 * 🛑 AND THE CLAUSE "SINCE NOTHING ELSE IMPORTS EITHER" WAS ALREADY FALSE FOR THIS MODULE WHEN IT
 * WAS WRITTEN — see the correction above. It is true of the resolver and only the resolver.
 *
 * ── WHAT WAS RETIRED, AND WHAT DELIBERATELY WAS NOT ─────────────────────────────────────────
 *
 *   1. ✅ DONE — `lib/draft-runtime/resolveNflRedraftDraftRuntime.ts` is DELETED (2026-09-06).
 *      0 callers by a four-form census (alias, relative, `require(`, `await import(`) plus a
 *      symbol sweep, and no test of its own. 185 lines of glue: it did I/O and composed other
 *      modules' output without producing a fact of its own, which is what made it free to remove.
 *
 *   2. 🛑 REFUSED — `lib/decision-os/draft-runtime-intelligence.ts` STAYS. An earlier draft of
 *      this header said it "dies with the resolver". That was wrong, and it was wrong because it
 *      was decided from a caller census without reading the module. It is a PURE function — no
 *      prisma, no fetch, no await — with real coverage (`__tests__/g34-draft-runtime.test.ts`
 *      asserts eleven named cards), and `DraftRuntimeIntelligenceResult` is named in EIGHT
 *      architecture documents as the contract behind a DEFERRED capability
 *      (`DRAFT_VALUE_ANALYTICS_DEFERRED`), not an absent one. `lib/executive-viz/
 *      draftDecisionViewModel.ts:200` ships a user-visible string saying draft value/ADP/tiers
 *      "exist only in the live draft-room runtime contract (DraftRuntimeIntelligenceResult),
 *      which no customer-facing route exposes". Deleting it would turn "deferred, backend exists,
 *      needs a route" into "does not exist" across all of that, and make a shipped string false.
 *      ⚠ A CALLER CENSUS ANSWERS "IS THIS REACHED", NEVER "SHOULD THIS EXIST".
 *
 *   3. ⏳ REMAINS — THIS MODULE. Removing it means also deleting the cron's
 *      `target('draft', createDraftOs({ store }), draftRulesSource)` line and accepting that the
 *      warmed rows stop. That is a live-behaviour change and belongs to whoever owns the cron.
 *
 * ⚠ `lib/draft-runtime/canonicalDraftRuntime.ts` STAYS, but on a WEAKER footing than this header
 * first claimed. Its only non-resolver consumer is
 * `lib/redraft-season-simulation/canonicalNflRedraftFullSeasonSimulation.ts:723`, and the only
 * thing reaching THAT is `app/e2e/g43-nfl-redraft-full-season/page.tsx` — a test HARNESS page
 * (one of 61 under `app/e2e/`, driven by the Playwright suite), not a product surface. So it is
 * "reached only by a harness plus `__tests__/g34-draft-runtime.test.ts`", which is a real reason
 * to keep it and not the same as being wired. Said precisely because the first version of this
 * line implied a production consumer that does not exist.
 *
 * So the honest trigger is no longer about live-draft-engine at all: retire this module when the
 * cron stops warming `draft/rules`. Until then, adding callers is still the one move that makes
 * the cleanup harder.
 *
 * If you are here anyway to wire something: use League OS's loader, not this one, unless you can
 * say why a draft needs the longer life — and if you can, say it here rather than assuming the 6h
 * was chosen for you.
 *
 * ⚠ THIS DOMAIN HAS EXACTLY ONE SOURCE, AND THE TWO IT DOES **NOT** HAVE ARE THE POINT.
 *
 * The deleted resolver loaded three things, and only one of them could be cached at all. The
 * reasoning is kept because it is the justification for this domain having ONE source, and that
 * is still true — it outlives the caller it was written about:
 *
 *   RULES   `resolveCanonicalLeagueRules(leagueId)` — one league row plus six config reads in
 *           parallel, keyed on nothing but the league. Changes a few times a season. CACHEABLE,
 *           and it is the expensive one: seven queries on every draft-runtime resolve, which
 *           during a live draft is every poll and every pick.
 *
 *   STATE   `buildSessionSnapshot(leagueId, now)` — NOT CACHED, AND NOT CACHEABLE. It changes on
 *           every pick. Other domains get away with a short TTL because their facts decay in
 *           minutes; a draft decays in seconds, and there is no TTL short enough to be both
 *           useful and safe. A cached snapshot would recommend a player who was taken while the
 *           entry was still warm.
 *
 *   POOL    `getResolvedDraftPoolForLeague(leagueId, { excludeDraftedNames })` — NOT CACHEABLE
 *           EITHER, for a subtler reason: it is parameterised by the set of already-drafted
 *           names, which is derived from the live session. Its result is a function of draft
 *           state even though its key looks like a league id. Caching on the league id would
 *           serve a pool containing players drafted seconds ago.
 *
 * Declaring sources for those two would look like better coverage and would produce exactly the
 * class of failure this codebase keeps finding: a confident answer built on a fact that is no
 * longer true. One honest source beats three that include a lie.
 *
 * The app level is unused here, as in Waiver OS: draft norms across leagues of a type (positional
 * run patterns, ADP drift by format) are a genuine app-level fact, but nothing computes them, and
 * an empty level is more honest than a placeholder that reads as populated.
 */

export type DraftOsArgs = { leagueId: string }

/**
 * League RULES for the draft: scoring, roster shape, draft config, waiver and playoff settings.
 *
 * 6h matches Waiver OS's league entry deliberately — these are the same class of fact (league
 * configuration a commissioner edits occasionally), and giving the same kind of fact the same
 * lifetime across domains is what makes two domains' evidence comparable.
 */
export const draftRulesSource: OsFactSource<DraftOsArgs, CanonicalLeagueRules> = {
  kind: 'rules',
  level: 'league',
  ttlMs: 6 * HOURS,
  scopeKey: (a) => a.leagueId,
  sport: () => 'NFL',
  // Resolves null rather than throwing when the league is missing, per the OsFactSource contract.
  derive: (a) => resolveCanonicalLeagueRules(a.leagueId).catch(() => null),
}

export function createDraftOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('draft', deps)
}

/**
 * 🛑 THE SLOT THIS WAS SHAPED FOR NO LONGER EXISTS. It matched `loadRules` on
 * `resolveNflRedraftDraftRuntime`, which was deleted 2026-09-06, so as of today the only thing
 * importing `createDraftOsLoaders` is `__tests__/draft-os.test.ts`. It is kept rather than removed
 * because the `DraftRuntimeDeps`-style injection shape is what any future draft reader would want,
 * and because deleting it would take the TTL decision's only executable pin with it — but it is
 * test-only, and saying so is the point: the next person should not read this as wired.
 *
 * There is no loader here for state or pool on purpose — see the header. If a future change adds
 * one, it needs a reason why a stale draft board is safe, not just a TTL.
 */
export function createDraftOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createDraftOs(deps)
  return {
    loadRules: (leagueId: string) => feed.get(draftRulesSource, { leagueId }),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const draftOsSources = [draftRulesSource] as const
