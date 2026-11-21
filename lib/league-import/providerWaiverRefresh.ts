import 'server-only'

import { prisma } from '@/lib/prisma'
import { rotationSlice } from '@/lib/league-import/sleeper/sleeperTradeFactRotation'
import { persistProviderTransactionFacts, type ProviderTransactionFactInput } from '@/lib/league-import/persistProviderTransactionFacts'

/**
 * ESPN AND MFL WAIVER CLAIMS STAY CURRENT AFTER IMPORT (Manager Psychology, Cron axis, 2026-11-21 — owner's
 * "daily current-season refresh").
 *
 * A manager record counts an ESPN or MFL manager's waiver claims from the `waiver_add` rows the historical backfill
 * writes (`lib/competitive-edge/providerManagerHistory.ts`). The backfill runs once, at import — so a claim filed the
 * week after a league was imported never reached anyone's record, and the record said "may be out of date" after 14
 * days with nothing scheduled to make it current. Refreshing at import only was a provider-quota choice.
 *
 * Now each league is re-read once a day: THIS SEASON ONLY, never the multi-year walk the backfill does, through the
 * import's own fetch (the importer's own provider sign-in) and the backfill's own row builder
 * (`espnTransactionFactRows` / `mflTransactionFactRows`). The facts are immutable and keyed deterministically
 * (`persistProviderTransactionFacts`), so a claim already stored is a no-op and nothing is deleted or rewritten.
 *
 * ⚠ BOUNDED. A stateless rotation, the Sleeper trade-fact rotation's (`rotationSlice`): leagues sorted by id, each
 * six-hour tick takes the next slice, so every league comes round once a day while there are at most
 * 4 × MAX_PER_TICK of them, and the lap lengthens — said in the result — beyond that. Each league is one current-season
 * fetch; a tick stops starting leagues when its runway runs out. A league that fails is skipped for this lap only.
 *
 * ⚠ FANTRAX IS NOT HERE, AND CANNOT BE: Fantrax trades reach AllFantasy only from the commissioner's own trade-history
 * upload — there is no feed to schedule. Yahoo import is off and Fleaflicker imports no waiver activity.
 *
 * DB-first: this is ingestion on a cron, never a request path. `PROVIDER_WAIVER_REFRESH=off` switches it off.
 */

export const PROVIDER_WAIVER_REFRESH_ENV = 'PROVIDER_WAIVER_REFRESH'
/** The `?intel=1` tick fires every six hours, so four slots make a day. */
export const PROVIDER_WAIVER_SLOT_MS = 6 * 60 * 60 * 1000
export const PROVIDER_WAIVER_SLOTS_PER_DAY = 4
/** At most this many leagues a tick. */
export const PROVIDER_WAIVER_MAX_PER_TICK = 12
/** A league is started only with at least this much of the tick's runway left. */
export const PROVIDER_WAIVER_MIN_RUNWAY_MS = 30_000

export const REFRESHED_PLATFORMS = ['espn', 'mfl'] as const
export type RefreshedPlatform = (typeof REFRESHED_PLATFORMS)[number]

export type RefreshLeague = { id: string; platform: string; platformLeagueId: string; season: number; userId: string }

/** The earliest season still being played: last year's until March (an NFL season's playoffs end in February). */
export function currentSeasonFloor(now: Date): number {
  return now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
}

/** How many leagues a tick takes so the whole list comes round once a day, within the cap. */
export function perTickFor(leagueCount: number): number {
  return Math.min(PROVIDER_WAIVER_MAX_PER_TICK, Math.max(1, Math.ceil(leagueCount / PROVIDER_WAIVER_SLOTS_PER_DAY)))
}

/** Days a full lap takes at that rate — 1 while the list fits, longer beyond it. */
export function lapDays(leagueCount: number): number {
  return leagueCount === 0 ? 0 : Math.ceil(leagueCount / (perTickFor(leagueCount) * PROVIDER_WAIVER_SLOTS_PER_DAY))
}

export type RefreshDeps = {
  listLeagues: (seasonFloor: number) => Promise<RefreshLeague[]>
  /** This season's transactions for one league, as provider facts. */
  readRows: (league: RefreshLeague) => Promise<ProviderTransactionFactInput[]>
  persist: (rows: ProviderTransactionFactInput[]) => Promise<number>
  remainingMs: () => number
  now: () => number
}

export type ProviderWaiverRefreshResult = {
  off?: true
  leagues: number
  picked: number
  refreshed: number
  factsWritten: number
  claimsRead: number
  lapDays: number
  slot: number
  deferred: number
  errors: string[]
}

const isWaiverAdd = (r: ProviderTransactionFactInput) => r.type === 'waiver_add'

export async function refreshProviderWaivers(deps: RefreshDeps, env: NodeJS.ProcessEnv = process.env): Promise<ProviderWaiverRefreshResult> {
  const result: ProviderWaiverRefreshResult = { leagues: 0, picked: 0, refreshed: 0, factsWritten: 0, claimsRead: 0, lapDays: 0, slot: 0, deferred: 0, errors: [] }
  if (String(env[PROVIDER_WAIVER_REFRESH_ENV] ?? '').trim().toLowerCase() === 'off') return { ...result, off: true }

  const now = deps.now()
  const leagues = (await deps.listLeagues(currentSeasonFloor(new Date(now)))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const byId = new Map(leagues.map((l) => [l.id, l]))
  result.leagues = leagues.length
  result.lapDays = lapDays(leagues.length)
  result.slot = Math.floor(now / PROVIDER_WAIVER_SLOT_MS)
  const picked = rotationSlice(leagues.map((l) => l.id), perTickFor(leagues.length), result.slot)
  result.picked = picked.length

  for (const id of picked) {
    if (deps.remainingMs() < PROVIDER_WAIVER_MIN_RUNWAY_MS) {
      result.deferred += 1
      continue
    }
    const league = byId.get(id)!
    try {
      const rows = await deps.readRows(league)
      result.claimsRead += rows.filter(isWaiverAdd).length
      result.factsWritten += rows.length ? await deps.persist(rows) : 0
      result.refreshed += 1
    } catch (err) {
      result.errors.push(`${league.platform} ${league.id}: ${err instanceof Error ? err.message.slice(0, 120) : 'failed'}`)
    }
  }
  return result
}

/** The live dependencies: imported ESPN/MFL leagues in a current season, read through the import's own fetch. */
export function defaultRefreshDeps(budget: { remainingMs: () => number }): RefreshDeps {
  return {
    listLeagues: async (seasonFloor) => {
      const rows = await prisma.league.findMany({
        where: {
          platform: { in: [...REFRESHED_PLATFORMS], mode: 'insensitive' },
          platformLeagueId: { not: '' },
          season: { gte: seasonFloor },
        },
        select: { id: true, platform: true, platformLeagueId: true, season: true, userId: true },
      })
      return rows.flatMap((r) =>
        r.platformLeagueId && r.userId ? [{ id: r.id, platform: r.platform.toLowerCase(), platformLeagueId: r.platformLeagueId, season: r.season, userId: r.userId }] : [],
      )
    },
    readRows: async (league) => {
      const source = `${league.season}:${league.platformLeagueId}`
      if (league.platform === 'espn') {
        const [{ fetchEspnLeagueForImport }, { espnTransactionFactRows }] = await Promise.all([
          import('@/lib/league-import/espn/EspnLeagueFetchService'),
          import('@/lib/league-import/espn/EspnHistoricalBackfillService'),
        ])
        return espnTransactionFactRows(league.id, await fetchEspnLeagueForImport(league.userId, source, { includePreviousSeasons: false }))
      }
      if (league.platform === 'mfl') {
        const [{ fetchMflLeagueForImport }, { mflTransactionFactRows }] = await Promise.all([
          import('@/lib/league-import/mfl/MflLeagueFetchService'),
          import('@/lib/league-import/mfl/MflHistoricalBackfillService'),
        ])
        return mflTransactionFactRows(league.id, await fetchMflLeagueForImport(league.userId, source, { includePreviousSeasons: false }))
      }
      return []
    },
    persist: persistProviderTransactionFacts,
    remainingMs: budget.remainingMs,
    now: () => Date.now(),
  }
}
