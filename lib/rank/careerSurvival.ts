import { prisma } from '@/lib/prisma'
import type { CareerLedgerRow } from './careerLedger'

const leagueSelect = { id: true, name: true, platform: true, platformLeagueId: true, sport: true, leagueSize: true } as const
const nativePlatforms = ['allfantasy', 'af', 'manual', 'native']

type Season = { season: number; league: { id: string; name: string | null; platform: string; platformLeagueId: string | null; sport: string; leagueSize: number | null } }

function survivalRow(
  userId: string, entry: Season, specialty: 'guillotine' | 'survivor',
  periods: number, totalPeriods: number, won: boolean, field: number | null, updatedAt: Date,
): CareerLedgerRow {
  const { league, season } = entry
  const platform = 'allfantasy'
  return {
    userId,
    key: `${platform}:${league.platformLeagueId ?? league.id}:${season}`,
    source: 'native',
    platform,
    sport: league.sport,
    season,
    leagueName: league.name,
    refId: league.id,
    providerLeagueId: league.platformLeagueId,
    leagueSize: field ?? 12,
    leagueSizeKnown: field != null,
    playoffTeams: null,
    leagueType: 'redraft',
    specialty,
    scoring: 'unknown',
    superflex: null,
    tePremium: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: null,
    gamesPlayed: 0,
    madePlayoffs: false,
    wonChampionship: won,
    completed: true,
    updatedAt: updatedAt.toISOString(),
    survival: { periods: Math.max(0, Math.min(periods, totalPeriods)), totalPeriods },
  }
}

export async function loadCareerSurvival(userIds: string[]): Promise<CareerLedgerRow[]> {
  const [chops, survivors] = await Promise.all([
    Promise.resolve().then(() => prisma.guillotineSurvivalLog.findMany({
      where: {
        roster: { ownerId: { in: userIds } },
        season: { status: { in: ['completed', 'complete'] }, league: { platform: { in: nativePlatforms } } },
      },
      select: {
        survivalStatus: true,
        scoringPeriod: true,
        roster: { select: { ownerId: true } },
        season: { select: { id: true, season: true, totalTeamsStarted: true, currentScoringPeriod: true, updatedAt: true, league: { select: leagueSelect } } },
      },
    })).catch((err: unknown) => {
      console.error('[career-ledger] Guillotine results unavailable', err)
      return []
    }),
    Promise.resolve().then(() => prisma.survivorSeasonSnapshot.findMany({
      where: {
        league: { platform: { in: nativePlatforms }, survivorPlayers: { some: { userId: { in: userIds } } } },
      },
      select: { season: true, totalWeeks: true, finalStandings: true, winnerId: true, createdAt: true, league: { select: leagueSelect } },
    })).catch((err: unknown) => {
      console.error('[career-ledger] Survivor results unavailable', err)
      return []
    }),
  ])

  const guillotine = new Map<string, { season: typeof chops[number]['season']; userId: string; survived: Set<number>; observed: Set<number> }>()
  for (const result of chops) {
    const key = `${result.season.id}:${result.roster.ownerId}`
    const tally = guillotine.get(key) ?? {
      season: result.season, userId: result.roster.ownerId, survived: new Set<number>(), observed: new Set<number>(),
    }
    if (result.survivalStatus === 'survived') tally.survived.add(result.scoringPeriod)
    tally.observed.add(result.scoringPeriod)
    guillotine.set(key, tally)
  }
  const out: CareerLedgerRow[] = []
  for (const { season, userId, survived, observed } of guillotine.values()) {
    // Completed seasons record the final scoring period. Count audited passes, including a zero-pass exit.
    const total = Math.max(season.currentScoringPeriod, observed.size)
    if (total > 0) out.push(survivalRow(userId, season, 'guillotine', survived.size, total, false,
      season.totalTeamsStarted, season.updatedAt))
  }

  const users = new Set(userIds)
  for (const snapshot of survivors) {
    if (snapshot.totalWeeks <= 0 || !Array.isArray(snapshot.finalStandings)) continue
    for (const standing of snapshot.finalStandings) {
      if (!standing || typeof standing !== 'object' || Array.isArray(standing)) continue
      if (typeof standing.userId !== 'string' || !users.has(standing.userId)) continue
      const exit = standing.eliminatedWeek
      if (exit !== null && (typeof exit !== 'number' || !Number.isInteger(exit) || exit < 1)) continue
      const won = snapshot.winnerId === standing.userId
      const periods = won || exit === null ? snapshot.totalWeeks : exit - 1
      out.push(survivalRow(standing.userId, snapshot, 'survivor', periods, snapshot.totalWeeks, won,
        snapshot.finalStandings.length, snapshot.createdAt))
    }
  }
  return out
}
