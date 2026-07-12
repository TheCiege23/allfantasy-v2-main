import type { PrismaClient } from '@prisma/client'
import type { NflRedraftProductionProviderResolution } from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import type {
  CanonicalNflInjury,
  CanonicalNflScore,
} from '@/lib/nfl-provider/nflRedraftScoreInjuryCanonical'

type PrismaLike = Pick<PrismaClient, 'sportsGame' | 'sportsInjury' | 'playerIdentityMap'>

function rowsFromResolution<T>(resolution: NflRedraftProductionProviderResolution, key: 'scores' | 'injuries'): T[] {
  const selected = resolution.canonicalData?.[key]
  if (Array.isArray(selected)) return selected as T[]
  const merged = resolution.mergedCanonicalData[key]
  return Array.isArray(merged) ? merged as T[] : []
}

function dateOrNull(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function projectCanonicalNflScores(
  resolution: NflRedraftProductionProviderResolution,
  prisma: PrismaLike,
): Promise<number> {
  const rows = rowsFromResolution<CanonicalNflScore>(resolution, 'scores')
  const source = resolution.selectedProvider ?? 'canonical_cache'
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000)
  let written = 0
  for (const row of rows) {
    if (!row.providerGameRef || !row.homeTeam || !row.awayTeam) continue
    await prisma.sportsGame.upsert({
      where: { sport_externalId_source: { sport: 'NFL', externalId: row.providerGameRef, source } },
      update: {
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        status: row.statusLabel ?? row.state,
        startTime: dateOrNull(row.scheduledStartIso),
        week: row.week,
        season: row.season,
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport: 'NFL',
        externalId: row.providerGameRef,
        source,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        status: row.statusLabel ?? row.state,
        startTime: dateOrNull(row.scheduledStartIso),
        week: row.week,
        season: row.season,
        fetchedAt: now,
        expiresAt,
      },
    })
    written += 1
  }
  return written
}

export async function projectCanonicalNflInjuries(
  resolution: NflRedraftProductionProviderResolution,
  prisma: PrismaLike,
): Promise<number> {
  const rows = rowsFromResolution<CanonicalNflInjury>(resolution, 'injuries')
  const source = resolution.selectedProvider ?? 'canonical_cache'
  const providerRefs = rows.map((row) => row.providerPlayerRef).filter((value): value is string => Boolean(value))
  const identities = source === 'api_sports' && providerRefs.length
    ? await prisma.playerIdentityMap.findMany({
        where: { sport: 'NFL', apiSportsId: { in: providerRefs } },
        select: { apiSportsId: true, id: true },
      })
    : []
  const canonicalIdByProviderRef = new Map(
    identities
      .filter((row) => row.apiSportsId && row.id)
      .map((row) => [String(row.apiSportsId), String(row.id)]),
  )
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  let written = 0
  for (const [index, row] of rows.entries()) {
    if (!row.playerName) continue
    const canonicalPlayerId = row.canonicalPlayerId
      ?? (row.providerPlayerRef ? canonicalIdByProviderRef.get(row.providerPlayerRef) ?? null : null)
    const externalId = [row.providerPlayerRef ?? canonicalPlayerId ?? row.playerName.toLowerCase(), row.sourceTimestampIso ?? index].join(':')
    await prisma.sportsInjury.upsert({
      where: { sport_externalId_source: { sport: 'NFL', externalId, source } },
      update: {
        playerName: row.playerName,
        playerId: canonicalPlayerId ?? row.providerPlayerRef,
        team: row.team,
        type: row.injuryType,
        status: row.status,
        description: row.description,
        date: dateOrNull(row.sourceTimestampIso),
        fetchedAt: now,
        expiresAt,
      },
      create: {
        sport: 'NFL',
        externalId,
        source,
        playerName: row.playerName,
        playerId: canonicalPlayerId ?? row.providerPlayerRef,
        team: row.team,
        type: row.injuryType,
        status: row.status,
        description: row.description,
        date: dateOrNull(row.sourceTimestampIso),
        fetchedAt: now,
        expiresAt,
      },
    })
    written += 1
  }
  return written
}
