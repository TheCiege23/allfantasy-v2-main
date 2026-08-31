import 'server-only'

import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS } from '../domain-os/types'
import {
  loadCanonicalProjectionFacts,
  rescoreProjectionFacts,
  type ProjectionFact,
} from '../projection/facts'

/**
 * Projection OS — maintained fact state for AF Projections (2.5).
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-os/*` points the other way.
 *
 * ── 🛑 THE SOURCE CACHES CANONICAL FACTS. THE LOADER RESCORES. ──────────────────────────────
 * This split is the whole reason the source is safe, and it was NOT free — `loadProjectionFacts`
 * originally rescored inside itself, so caching its output at app level would have stored one
 * league's IDP points for everybody.
 *
 * That is precisely the defect 1.1b spent a change unpicking: `waiverSettingsSource` and
 * `tradeSettingsSource` both declared `level: 'league'` while deriving user-specific facts, and
 * nothing caught it because nothing read the league entry. Here it would have been worse, because
 * the app level is shared by every league in the sport.
 *
 * So `loadCanonicalProjectionFacts` derives with NO league rules, the fact carries the raw
 * component amounts, and `rescoreProjectionFacts` applies a league's scoring at READ time — pure,
 * no IO, safe to run on a cached object. D4 in its intended shape.
 *
 * ⚠ AND THE CANONICAL VALUE IS NOT NEUTRAL, IT IS `balanced`. `AFProjectionSnapshot` has no
 * `scoringPresetId`, so the stored number was computed under one preset. A consumer that skips the
 * rescore is not getting "the default"; it is getting a balanced-IDP projection, which is
 * materially wrong for a tackle-heavy league. `ProjectionFact.rescored` is how a surface can tell.
 */

export type ProjectionOsArgs = {
  sport: string
  season: number
  week?: number | null
}

/**
 * Canonical projections. 6h.
 *
 * `writeAfProjectionSnapshots` runs from `/api/cron/compute-projections` daily at 07:50 UTC, so a
 * shorter TTL would re-read rows that have not changed. 6h bounds the lag on a fact that moves
 * once a day, and matches the market source for the same reason.
 */
export const canonicalProjectionSource: OsFactSource<ProjectionOsArgs, ProjectionFact[]> = {
  kind: 'canonical',
  level: 'app',
  ttlMs: 6 * HOURS,
  scopeKey: (a) => `${a.sport}:${a.season}:${a.week ?? 'season'}`,
  sport: (a) => a.sport,
  derive: async (a) => {
    const facts = await loadCanonicalProjectionFacts(a).catch(() => [])
    // Never cache an empty result: it would report "no projections exist" for 6h over one failed
    // read, and `createOsFeed` treats null as "unavailable" rather than storing it.
    return facts.length > 0 ? facts : null
  },
}

export function createProjectionOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('projection', deps)
}

/**
 * Shaped so a caller gets projections already correct for its league.
 *
 * `leagueIdpRules` is applied AFTER the cache read, so two leagues share one stored object and
 * each sees its own points. Passing null is legitimate and means "give me the canonical value" —
 * it is not a missing argument, and the returned `rescored: false` says so honestly.
 */
export function createProjectionOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createProjectionOs(deps)
  return {
    loadFor: async (
      args: ProjectionOsArgs,
      leagueIdpRules: Record<string, number> | null,
    ): Promise<ProjectionFact[] | null> => {
      const canonical = await feed.get(canonicalProjectionSource, args)
      if (!canonical) return null
      return rescoreProjectionFacts(canonical, leagueIdpRules)
    },
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const projectionOsSources = [canonicalProjectionSource] as const
