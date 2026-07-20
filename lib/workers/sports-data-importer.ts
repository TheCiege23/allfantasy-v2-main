import 'server-only'

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { normalizePlayerName, normalizePosition, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { apiChain } from '@/lib/workers/api-chain'

const SPORTS_PLAYER_TTL_MS = 6 * 60 * 60 * 1000
const UPSERT_BATCH_SIZE = 100

type PlayerSeed = {
  id: string
  name: string
  team: string
  position: string
  status?: string | null
  source: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function currentSeasonForSport(): number {
  return new Date().getFullYear()
}

function buildPlayerId(sport: string, rawId: string | null | undefined, name: string, team?: string | null): string {
  if (rawId) return `${sport}:${rawId}`
  const slug = normalizePlayerName(name).replace(/\s+/g, '-')
  return `${sport}:${slug}:${team || 'FA'}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function asArrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : []
}

async function fetchProviderPlayerSeeds(sport: SupportedSport, season: number): Promise<PlayerSeed[]> {
  const response = await apiChain.fetch({
    sport,
    dataType: 'players',
    query: { season: String(season) },
  })

  const rows = asArrayRecords(response.data)
  const seeds: PlayerSeed[] = []
  for (const row of rows) {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) continue

    const team = normalizeTeamAbbrev(String(row.team ?? row.teamAbbrev ?? '')) ?? 'FA'
    const position = normalizePosition(String(row.position ?? row.pos ?? '')) ?? 'FLEX'
    const externalId = String(row.id ?? row.externalId ?? row.playerId ?? '').trim() || null

    seeds.push({
      id: buildPlayerId(sport, externalId, name, team),
      name,
      team,
      position,
      status: typeof row.status === 'string' ? row.status : null,
      source: response.source,
    })
  }

  return seeds
}

async function loadIdentitySeeds(sport: SupportedSport): Promise<PlayerSeed[]> {
  const rows = await prisma.playerIdentityMap.findMany({
    where: { sport },
    select: {
      canonicalName: true,
      currentTeam: true,
      position: true,
      sleeperId: true,
      clearSportsId: true,
      status: true,
    },
    take: 5000,
  })

  return rows
    .map((row) => ({
      id: buildPlayerId(sport, row.sleeperId ?? row.clearSportsId ?? null, row.canonicalName, row.currentTeam),
      name: row.canonicalName,
      team: normalizeTeamAbbrev(row.currentTeam) ?? 'FA',
      position: normalizePosition(row.position) ?? 'FLEX',
      status: row.status,
      source: 'manual',
    }))
    .filter((row) => Boolean(row.name))
}

function buildProjectionMap(rows: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) continue
    map.set(normalizePlayerName(name), row)
  }
  return map
}

function buildDynastyValueMap(rows: Array<Record<string, unknown>>): Map<string, number> {
  const map = new Map<string, number>()
  rows.forEach((row, index) => {
    const name = String(row.name ?? row.playerName ?? row.player ?? '').trim()
    if (!name) return
    const explicit = Number(row.dynasty_value ?? row.dynastyValue ?? row.score ?? row.value)
    const derived = Number.isFinite(explicit) ? explicit : clamp(100 - index, 1, 100)
    map.set(normalizePlayerName(name), Math.round(clamp(derived, 1, 100)))
  })
  return map
}

export async function runSportsDataImporter(options?: {
  sports?: string[]
}): Promise<{ imported: number; sports: string[]; staleFallbackApplied: boolean }> {
  const targetSports = (options?.sports?.length ? options.sports : SUPPORTED_SPORTS).map((sport) =>
    normalizeToSupportedSport(sport)
  )
  const uniqueSports = Array.from(new Set(targetSports))
  let imported = 0
  let staleFallbackApplied = false

  for (const sport of uniqueSports) {
    const season = currentSeasonForSport()
    const [identitySeeds, providerSeeds, latestStats, latestInjuries, latestNews, latestAdp, metaTrends, projectionsResponse, rankingsResponse] =
      await Promise.all([
        loadIdentitySeeds(sport),
        fetchProviderPlayerSeeds(sport, season),
        prisma.playerSeasonStats.findMany({
          where: { sport },
          orderBy: { fetchedAt: 'desc' },
          take: 4000,
          select: { playerId: true, playerName: true, stats: true },
        }),
        prisma.injuryReportRecord.findMany({
          where: { sport },
          orderBy: { reportDate: 'desc' },
          take: 2500,
        }),
        prisma.playerNewsRecord.findMany({
          where: { sport },
          orderBy: { publishedAt: 'desc' },
          take: 2500,
        }),
        prisma.adpDataRecord.findMany({
          where: { sport },
          orderBy: [{ season: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
          take: 4000,
        }),
        prisma.playerMetaTrend.findMany({
          where: { sport },
          take: 4000,
        }),
        apiChain.fetch({
          sport,
          dataType: 'projections',
          query: { season: String(season) },
        }),
        apiChain.fetch({
          sport,
          dataType: 'rankings',
          query: { season: String(season) },
        }),
      ])

    const projectionRows = asArrayRecords(projectionsResponse.data)
    const rankingRows = asArrayRecords(rankingsResponse.data)

    const seedMap = new Map<string, PlayerSeed>()
    for (const seed of [...identitySeeds, ...providerSeeds]) {
      const key = normalizePlayerName(seed.name)
      if (!key) continue
      if (!seedMap.has(key) || seed.source !== 'manual') seedMap.set(key, seed)
    }

    for (const row of latestAdp) {
      const key = normalizePlayerName(row.playerName)
      if (!seedMap.has(key)) {
        seedMap.set(key, {
          id: buildPlayerId(sport, row.playerId, row.playerName, row.team),
          name: row.playerName,
          team: normalizeTeamAbbrev(row.team) ?? 'FA',
          position: normalizePosition(row.position) ?? 'FLEX',
          source: row.source,
        })
      }
    }

    for (const row of latestInjuries) {
      const key = normalizePlayerName(row.playerName)
      if (!seedMap.has(key)) {
        seedMap.set(key, {
          id: buildPlayerId(sport, row.playerId, row.playerName, row.team),
          name: row.playerName,
          team: normalizeTeamAbbrev(row.team) ?? 'FA',
          position: 'FLEX',
          status: row.status,
          source: 'cached',
        })
      }
    }

    const projectionMap = buildProjectionMap(projectionRows)
    const dynastyValueMap = buildDynastyValueMap(rankingRows)
    const statMap = new Map<string, unknown>()
    const injuryMap = new Map<string, (typeof latestInjuries)[number]>()
    const adpMap = new Map<string, (typeof latestAdp)[number]>()
    const newsMap = new Map<string, Array<(typeof latestNews)[number]>>()
    const trendMap = new Map<string, number>(
      metaTrends.map((row) => [String(row.playerId), Number(row.trendScore ?? 0)])
    )

    for (const row of latestStats) {
      const key = normalizePlayerName(row.playerName)
      if (!statMap.has(key)) statMap.set(key, row.stats)
    }
    for (const row of latestInjuries) {
      const key = normalizePlayerName(row.playerName)
      if (!injuryMap.has(key)) injuryMap.set(key, row)
    }
    for (const row of latestAdp) {
      const key = normalizePlayerName(row.playerName)
      if (!adpMap.has(key)) adpMap.set(key, row)
    }
    for (const row of latestNews) {
      const key = normalizePlayerName(row.playerName)
      const current = newsMap.get(key) ?? []
      if (current.length < 3) current.push(row)
      newsMap.set(key, current)
    }

    const rows = Array.from(seedMap.values()).map((seed) => {
      const key = normalizePlayerName(seed.name)
      const injury = injuryMap.get(key)
      const adp = adpMap.get(key)
      const trendScore = trendMap.get(adp?.playerId ?? '')
      const projections = projectionMap.get(key) ?? {}
      const news = (newsMap.get(key) ?? []).map((item) => ({
        headline: item.headline,
        impact: item.impact,
        source: item.source,
        publishedAt: item.publishedAt.toISOString(),
      }))

      return {
        id: seed.id,
        sport,
        name: seed.name,
        team: seed.team,
        position: seed.position,
        stats: asRecord(statMap.get(key)) ?? {},
        projections,
        adp: adp?.adp ?? null,
        dynastyValue:
          dynastyValueMap.get(key) ??
          (typeof trendScore === 'number' ? Math.round(clamp(50 + trendScore, 0, 100)) : null),
        injuryStatus: injury?.status ?? seed.status ?? null,
        injuryNotes: injury?.notes ?? null,
        news,
        dataSource: projectionMap.has(key) ? projectionsResponse.source : seed.source,
      }
    })

    try {
      for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        await prisma.$transaction(
          batch.map((row) =>
            prisma.sportsPlayerRecord.upsert({
              where: { id: row.id },
              update: {
                sport: row.sport,
                name: row.name,
                team: row.team,
                position: row.position,
                stats: toPrismaJsonInput(row.stats),
                projections: toPrismaJsonInput(row.projections),
                adp: row.adp,
                dynastyValue: row.dynastyValue,
                injuryStatus: row.injuryStatus,
                injuryNotes: row.injuryNotes,
                news: toPrismaJsonInput(row.news),
                dataSource: row.dataSource,
              },
              create: {
                ...row,
                stats: toPrismaJsonInput(row.stats),
                projections: toPrismaJsonInput(row.projections),
                news: toPrismaJsonInput(row.news),
              },
            })
          )
        )
      }
      imported += rows.length
    } catch (error) {
      staleFallbackApplied = true
      await prisma.sportsPlayerRecord.updateMany({
        where: {
          sport,
          lastUpdated: {
            lt: new Date(Date.now() - SPORTS_PLAYER_TTL_MS),
          },
        },
        data: {
          dataSource: 'cached',
        },
      })
      console.error('[sports-data-importer] Failed to import player data', {
        sport,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    imported,
    sports: uniqueSports,
    staleFallbackApplied,
  }
}
