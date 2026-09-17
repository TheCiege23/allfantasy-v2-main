import {
  readStoredTitleGame,
  storedHistoricalRosterId,
  type StoredTitleGame,
} from '@/lib/league-import/sleeper/bracketPlacements'
import type { FinalResult } from '@/lib/core-app/careerFinals'

/**
 * Career "Finals", the resolving half: stored Sleeper title games → your result per season.
 *
 * ⚠ KEPT OUT OF `careerFinals.ts` ON PURPOSE. `careerModel.ts` is imported by client
 * components, and it only needs the summary; the bracket reader stays on the server side
 * with the loader (`career.ts`) that feeds it.
 *
 * ⚠ PURE. No prisma — the loader reads the rows.
 */

/** One `league_dynasty_seasons` row, reduced to what the verdict needs. */
export type DynastyTitleRow = {
  leagueId: string
  season: number
  platformLeagueId: string
  playoffStructure: unknown
}

/** Which roster is yours, per source. */
export type FinalsOwnership = {
  /** Sleeper league id (that season's) → your roster id in it, from legacy history. */
  legacyRosterBySleeperLeague: ReadonlyMap<string, number>
  /** `League.id` → the external id of the team you claimed there (the current season's id). */
  claimedTeamByLeagueId: ReadonlyMap<string, string>
}

type Resolved = { leagueId: string; season: number; platformLeagueId: string; title: StoredTitleGame; ps: unknown }

export type FinalsIndex = {
  byPlatformLeagueId: Map<string, Resolved[]>
  byLeagueSeason: Map<string, Resolved[]>
  ownership: FinalsOwnership
}

function push(map: Map<string, Resolved[]>, key: string, value: Resolved) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** Resolve every stored title game once; rows without a decided final are dropped. */
export function buildFinalsIndex(rows: readonly DynastyTitleRow[], ownership: FinalsOwnership): FinalsIndex {
  const byPlatformLeagueId = new Map<string, Resolved[]>()
  const byLeagueSeason = new Map<string, Resolved[]>()
  for (const row of rows) {
    const title = readStoredTitleGame(row.playoffStructure)
    if (!title) continue
    const resolved: Resolved = {
      leagueId: row.leagueId,
      season: row.season,
      platformLeagueId: row.platformLeagueId,
      title,
      ps: row.playoffStructure,
    }
    push(byPlatformLeagueId, row.platformLeagueId, resolved)
    push(byLeagueSeason, `${row.leagueId}|${row.season}`, resolved)
  }
  return { byPlatformLeagueId, byLeagueSeason, ownership }
}

/**
 * What the stored bracket says about your final in one league-season, or null when it
 * cannot say.
 *
 * A career row is matched to a stored season by the provider's league id (legacy and import
 * rows) or by `League.id` + season (imported season history), always within the same season.
 * Your roster is the legacy roster for that Sleeper league when there is one, otherwise the
 * team you claimed, traced back through the stored historical→current id map.
 *
 * ⚠ TWO STORED ROWS CAN DESCRIBE ONE SEASON — two `League` rows pointing at the same Sleeper
 * league. When their verdicts disagree the answer is null, not the first one found.
 */
export function finalResultFor(
  row: { platform: string; season: number; refId: string; providerLeagueId: string | null },
  index: FinalsIndex,
): FinalResult | null {
  if (row.platform !== 'sleeper') return null
  const seen = new Set<Resolved>()
  const candidates: Resolved[] = []
  const add = (list: Resolved[] | undefined) => {
    for (const r of list ?? []) {
      if (r.season !== row.season || seen.has(r)) continue
      seen.add(r)
      candidates.push(r)
    }
  }
  if (row.providerLeagueId) add(index.byPlatformLeagueId.get(row.providerLeagueId))
  add(index.byLeagueSeason.get(`${row.refId}|${row.season}`))

  const verdicts = new Set<FinalResult>()
  for (const c of candidates) {
    const mine =
      index.ownership.legacyRosterBySleeperLeague.get(c.platformLeagueId) ??
      storedHistoricalRosterId(c.ps, index.ownership.claimedTeamByLeagueId.get(c.leagueId))
    if (mine == null) continue
    verdicts.add(
      mine === c.title.championRosterId ? 'won' : mine === c.title.runnerUpRosterId ? 'lost' : 'out',
    )
  }
  return verdicts.size === 1 ? [...verdicts][0] : null
}

