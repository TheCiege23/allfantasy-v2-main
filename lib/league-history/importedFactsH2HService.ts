/**
 * Head-to-head intelligence for IMPORTED (non-Sleeper) leagues — Yahoo, ESPN,
 * and any other provider whose historical backfill persisted matchup facts.
 *
 * Where sleeperH2HService walks the live Sleeper API chain, this reads the
 * facts warehouse the import wrote (`matchupFact` per game, `rosterSnapshot`
 * for manager names) and feeds the EXACT same aggregation
 * (aggregateH2HSeasons) so records, rivalries, streaks, and weekly awards are
 * computed identically for every platform.
 *
 * Honesty contract:
 * - ownerIds are provider team keys (not AllFantasy or Sleeper user ids);
 *   avatars aren't available from imported data and ship as null.
 * - A matchup stored with both scores at 0 is treated as unplayed (providers
 *   persist full schedules); it is excluded rather than counted as a 0-0 tie.
 * - Anything unresolvable lands in `missing[]`, never silently dropped.
 */

import { prisma } from '@/lib/prisma'
import {
  aggregateH2HSeasons,
  type H2HGame,
  type H2HSeasonData,
  type LeagueH2HPayload,
} from './sleeperH2HService'

const CACHE_PREFIX = 'h2h-facts:v1:'
const TTL_MS = 6 * 60 * 60 * 1000 // imported facts only change on re-import

type SnapshotPlayerRow = {
  id?: string
  name?: string | null
  position?: string | null
  ownerId?: string
  ownerName?: string
  rosterId?: string
}

/** teamId → display name, newest season wins. */
function buildIdentityFromSnapshots(
  snapshots: { teamId: string; season: number | null; rosterPlayers: unknown }[],
): Map<string, string> {
  const identity = new Map<string, string>()
  const sorted = [...snapshots].sort((a, b) => (a.season ?? 0) - (b.season ?? 0))
  for (const snap of sorted) {
    const players = Array.isArray(snap.rosterPlayers) ? (snap.rosterPlayers as SnapshotPlayerRow[]) : []
    const named = players.find((p) => typeof p?.ownerName === 'string' && p.ownerName.trim())
    if (named?.ownerName) identity.set(snap.teamId, named.ownerName.trim())
  }
  return identity
}

function shortTeamLabel(teamId: string): string {
  // Provider team keys are long ("461.l.12345.t.7"); the tail is the readable bit.
  const tail = teamId.split('.').pop() ?? teamId
  return `Team ${tail}`
}

export async function getImportedLeagueH2H(leagueId: string): Promise<LeagueH2HPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${leagueId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as LeagueH2HPayload)
      : null
  if (cachedPayload?.version === 2 && cached && cached.expiresAt > now) return cachedPayload

  const [facts, snapshots] = await Promise.all([
    prisma.matchupFact
      .findMany({
        where: { leagueId },
        select: {
          season: true,
          weekOrPeriod: true,
          teamA: true,
          teamB: true,
          scoreA: true,
          scoreB: true,
        },
        orderBy: [{ season: 'asc' }, { weekOrPeriod: 'asc' }],
      })
      .catch(() => [] as never[]),
    prisma.rosterSnapshot
      .findMany({
        where: { leagueId },
        select: { teamId: true, season: true, rosterPlayers: true },
      })
      .catch(() => [] as never[]),
  ])

  if (facts.length === 0) {
    return cachedPayload?.version === 2 && cached
      ? { ...cachedPayload, staleAsOf: cached.expiresAt.toISOString() }
      : null
  }

  const missing: string[] = []
  const identity = buildIdentityFromSnapshots(snapshots)
  if (identity.size === 0) missing.push('manager names (no roster snapshots)')

  // Group played games by season; both-zero rows are unplayed schedule slots.
  const bySeason = new Map<number, typeof facts>()
  for (const f of facts) {
    if (f.season == null || f.weekOrPeriod == null) continue
    if ((f.scoreA ?? 0) === 0 && (f.scoreB ?? 0) === 0) continue
    const list = bySeason.get(f.season) ?? []
    list.push(f)
    bySeason.set(f.season, list)
  }

  const seasons = [...bySeason.keys()].sort((a, b) => a - b)
  const syncs: H2HSeasonData[] = []
  const allTeamIds = new Set<string>()

  for (const season of seasons) {
    const rows = bySeason.get(season) ?? []
    const seasonStr = String(season)
    const games: H2HGame[] = []
    // week → teamId → points, to compute the weekly top-half median.
    const weekScores = new Map<number, Map<string, number>>()

    for (const f of rows) {
      allTeamIds.add(f.teamA)
      allTeamIds.add(f.teamB)
      games.push({
        season: seasonStr,
        week: f.weekOrPeriod as number,
        aOwnerId: f.teamA,
        bOwnerId: f.teamB,
        aPoints: f.scoreA ?? 0,
        bPoints: f.scoreB ?? 0,
      })
      const wk = weekScores.get(f.weekOrPeriod as number) ?? new Map<string, number>()
      wk.set(f.teamA, f.scoreA ?? 0)
      wk.set(f.teamB, f.scoreB ?? 0)
      weekScores.set(f.weekOrPeriod as number, wk)
    }

    const weekly: H2HSeasonData['weekly'] = {}
    for (const [week, scores] of weekScores) {
      const sorted = [...scores.values()].sort((a, b) => a - b)
      const mid =
        sorted.length % 2 === 1
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      for (const [teamId, points] of scores) {
        ;(weekly[teamId] ??= []).push({ week, points, topHalf: points > mid })
      }
    }
    for (const list of Object.values(weekly)) list.sort((a, b) => a.week - b.week)

    const managers: H2HSeasonData['managers'] = {}
    for (const teamId of allTeamIds) {
      if (!rows.some((f) => f.teamA === teamId || f.teamB === teamId)) continue
      managers[teamId] = {
        name: identity.get(teamId) ?? shortTeamLabel(teamId),
        avatar: null, // not available from imported provider data
        teamName: null,
      }
    }

    syncs.push({ season: seasonStr, games, weekly, managers })
  }

  if (syncs.length === 0) {
    return cachedPayload?.version === 2 && cached
      ? { ...cachedPayload, staleAsOf: cached.expiresAt.toISOString() }
      : null
  }

  const agg = aggregateH2HSeasons(syncs)

  const fresh: LeagueH2HPayload = {
    version: 2,
    fetchedAt: now.toISOString(),
    staleAsOf: null,
    sleeperLeagueId: leagueId, // AllFantasy league id for imported sources — see type doc
    source: 'imported-facts',
    ...agg,
    missing,
  }

  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + TTL_MS) },
      create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + TTL_MS) },
    })
    .catch(() => null)
  return fresh
}
