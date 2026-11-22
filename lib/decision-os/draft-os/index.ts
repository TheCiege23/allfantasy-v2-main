import 'server-only'

import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { MINUTES } from '../domain-os/types'
import type { DraftRosterRules } from '@/lib/shared-services/draft/DraftContextAssembler'

/**
 * Draft OS — maintained fact state for the draft engine (2026-11-20: it has a reader again).
 *
 * 🛑 WHAT THIS MODULE WAS, SO NOBODY RESTORES IT. It cached `resolveCanonicalLeagueRules` for six hours, for
 * `resolveNflRedraftDraftRuntime` — deleted 2026-09-06 with zero callers — and a cron warmed it every hour for two
 * more months (242 NFL rows) until the owner retired that warm on 2026-11-17 (`app/api/cron/domain-os-refresh`). A
 * write with no read, then a module with neither. The draft engine never read it: it assembled its rules itself on
 * every call.
 *
 * ✅ WHAT IT IS NOW: the draft engine's OWN rules — starting slots, IDP, superflex / 2QB, scoring format, TE premium
 * (`DraftRosterRules`) — exactly what `buildDraftDecisionContext` and the queue reorder took from the league on every
 * call. Derived by the one function that computed them inline (`deriveDraftRosterRules`), so there is still one
 * derivation, now cached. It is read through `readDraftRosterRules`, which falls back to that derivation, so a cache
 * problem is never a draft problem.
 *
 * ⚠ NOT League OS's ruleset. `leagueRulesSource` caches `CanonicalLeagueRules`, which carries the league's raw
 * `starters`, not the roster TEMPLATE the draft engine counts slots from (`getRosterTemplate`), and for a native
 * football redraft league its `starters` is filled from the saved layout where the draft reads the raw column — so
 * deriving the draft's slots from it would be a second derivation that disagrees with the first.
 *
 * ⚠ 60 SECONDS, NOT SIX HOURS. A live draft polls every few seconds per manager, so one minute already collapses a
 * league's polls into one read; the cost of a long life is a commissioner editing roster slots minutes before the
 * draft and the advice counting the old ones for hours. One minute is the most that edit can lag. No cron warms it —
 * a 60-second entry is warm only while a draft is running, which is when it is read (League OS, same choice).
 *
 * ── THE TWO THINGS THIS DOMAIN DOES NOT CACHE, AND MUST NOT ─────────────────────────────────────────
 *
 *   STATE   the draft session and its picks — change on every pick. A draft decays in seconds; no TTL is both useful
 *           and safe, and a cached board recommends a player taken while the entry was warm.
 *   POOL    who is still available — a function of the drafted set even when its key looks like a league id.
 *
 * Declaring sources for those would look like better coverage and would serve a confident answer built on a fact
 * that is no longer true. Adding one needs a reason a stale board is safe, not just a TTL.
 */

type DraftOsArgs = { leagueId: string; sport?: string | null }

export const draftRosterRulesSource: OsFactSource<DraftOsArgs, DraftRosterRules> = {
  /*
   * A NEW kind, not `rules`: the retired entries under `draft/rules` hold a CanonicalLeagueRules. The TTL already
   * keeps them from being served, but a kind name that means one shape forever is cheaper than relying on that.
   */
  kind: 'rosterRules',
  level: 'league',
  ttlMs: 1 * MINUTES,
  scopeKey: (a) => a.leagueId,
  sport: (a) => (a.sport ?? 'NFL').toUpperCase(),
  /*
   * Lazily imported: the assembler reads THROUGH this module, so a static import would be a cycle. Resolves null
   * rather than throwing when the league is missing or a read fails, per the OsFactSource contract.
   */
  derive: async (a) => {
    const { deriveDraftRosterRules } = await import('@/lib/shared-services/draft/DraftContextAssembler')
    return deriveDraftRosterRules(a.leagueId).catch(() => null)
  },
}

export function createDraftOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('draft', deps)
}

export function createDraftOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createDraftOs(deps)
  return {
    loadRosterRules: (args: DraftOsArgs) => feed.get(draftRosterRulesSource, args),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

const sharedLoaders = createDraftOsLoaders()

/** The draft rules through the cache. Null when neither the cache nor the derivation could answer. */
export function loadDraftRosterRules(args: DraftOsArgs): Promise<DraftRosterRules | null> {
  return sharedLoaders.loadRosterRules(args)
}

export const draftOsSources = [draftRosterRulesSource] as const
