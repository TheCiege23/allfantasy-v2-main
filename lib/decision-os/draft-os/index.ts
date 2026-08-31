import 'server-only'

import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS } from '../domain-os/types'

/**
 * Draft OS — maintained fact state for the draft runtime.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-os/*` points the other way.
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
 * ⚠ AND ONLY ONE OF THEM IS REACHED BY ANYTHING. Measured 2026-08-31:
 * `resolveNflRedraftDraftRuntime` — this module's sole consumer — has ZERO callers. Live drafts
 * run on `lib/live-draft-engine/DraftSessionService`. Meanwhile playoff-runtime (4 routes),
 * roster-runtime (1) and schedule-runtime (1) all pay for the same ruleset, which is why League OS
 * exists and why it is the one that is wired.
 *
 * SO: if you are here to give the draft runtime a route, use League OS's loader unless you can say
 * why a draft needs the longer life — and if you can, say it here rather than assuming the 6h was
 * chosen for you. If instead the draft runtime is being retired in favour of `live-draft-engine`,
 * this module goes with it; nothing else imports it. That decision is tracked as 1.2b in
 * docs/decision-os/HUB_BUILD_PLAN.md and is deliberately left open rather than settled by whoever
 * happened to touch this file.
 *
 * ⚠ THIS DOMAIN HAS EXACTLY ONE SOURCE, AND THE TWO IT DOES **NOT** HAVE ARE THE POINT.
 *
 * `resolveNflRedraftDraftRuntime` loads three things. Only one of them can be cached at all:
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
 * Shaped for the `loadRules` slot on `resolveNflRedraftDraftRuntime`, so the feed can be adopted
 * without touching the draft path.
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
