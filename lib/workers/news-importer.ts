import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import {
  buildNewsPlayerIndex,
  tallyNewsResolution,
  attributionRate,
  emptyNewsResolutionTally,
} from '@/lib/player-identity/resolveNewsPlayer'
import { apiChain } from '@/lib/workers/api-chain'
import {
  SUPPORTED_SPORTS as API_CHAIN_SPORTS,
  apiChainSportToDbSport,
  legacySupportedSportToApiChain,
  type ApiChainSport,
} from '@/lib/workers/api-config'

function inferImpact(text: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase()
  if (/(out|ir|injured reserve|trade|traded|waived|surgery|season-ending|starting job)/.test(lower)) return 'high'
  if (/(questionable|limited|target share|role|practice|depth chart|committee)/.test(lower)) return 'medium'
  return 'low'
}

function extractPlayerName(row: Record<string, unknown>): string {
  const playerName = row.playerName ?? row.player ?? row.name
  if (typeof playerName === 'string' && playerName.trim()) return playerName.trim()
  return 'General Update'
}

function normalizeNewsRecord(
  sport: string,
  row: Record<string, unknown>,
  source: string
): {
  sport: string
  playerId?: string | null
  playerName: string
  team?: string | null
  headline: string
  body: string
  impact: string
  fantasyRelevant: boolean
  source: string
  publishedAt: Date
} | null {
  const headline = String(row.title ?? row.headline ?? '').trim()
  const body = String(row.content ?? row.description ?? row.body ?? '').trim()
  if (!headline) return null
  const playerName = extractPlayerName(row)
  const normalizedTeam = normalizeTeamAbbrev(String(row.team ?? row.teamAbbrev ?? ''))
  const team = normalizedTeam ?? (String(row.team ?? '').trim() || null)
  const publishedAtRaw = row.publishedAt ?? row.date ?? row.createdAt
  const publishedAt = publishedAtRaw ? new Date(String(publishedAtRaw)) : new Date()
  const impact = inferImpact(`${headline} ${body}`)

  return {
    sport,
    playerId: typeof row.playerId === 'string' ? row.playerId : null,
    playerName,
    team,
    headline,
    body,
    impact,
    fantasyRelevant: impact !== 'low' || /fantasy|waiver|start|sit|lineup|injur|trade/i.test(`${headline} ${body}`),
    source,
    publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
  }
}

export interface NewsImportAttribution {
  exact: number
  normalized: number
  team_disambiguated: number
  ambiguous: number
  unresolved: number
  /** Attributed share 0-1, or null when nothing was processed. */
  rate: number | null
}

export async function runNewsImporter(options?: {
  sports?: string[]
}): Promise<{ imported: number; sports: string[]; attribution: NewsImportAttribution }> {
  const sports: ApiChainSport[] = Array.from(
    new Set(
      options?.sports?.length
        ? options.sports.map((s) => legacySupportedSportToApiChain(normalizeToSupportedSport(s)))
        : [...API_CHAIN_SPORTS]
    )
  )

  let imported = 0
  const tally = emptyNewsResolutionTally()
  for (const sport of sports) {
    const dbSport = apiChainSportToDbSport(sport)
    const [legacyRows, chainResponse] = await Promise.all([
      prisma.sportsNews.findMany({
        where: { sport: dbSport },
        orderBy: { publishedAt: 'desc' },
        take: 250,
      }),
      apiChain.fetch({
        sport,
        dataType: 'news',
        query: { limit: 40 },
      }),
    ])

    const providerRows = Array.isArray(chainResponse.data)
      ? chainResponse.data.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      : []

    const records = [
      ...legacyRows
        .map((row) =>
          normalizeNewsRecord(
            dbSport,
            {
              playerId: row.playerId,
              playerName: row.playerName,
              team: row.team,
              title: row.title,
              description: row.description,
              content: row.content,
              publishedAt: row.publishedAt ?? row.createdAt,
            },
            row.source
          )
        )
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
      ...providerRows
        .map((row) => normalizeNewsRecord(dbSport, row, chainResponse.source))
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    ]

    if (records.length === 0) continue

    // Resolve each extracted name to a canonical player BEFORE writing. One registry read per
    // sport, not per item. A name that does not resolve is kept as general news with its headline
    // intact and a null playerId — this importer's own sources (espn, newsapi) were measured
    // writing non-players like "Power Rankings" and "Dallas Cowboys" into the player column ~50%
    // of the time, and those are not failed matches, they are not players.
    const index = await buildNewsPlayerIndex(dbSport)
    const attributed = records.map((r) => {
      const match = index.resolve(r.playerName, r.team)
      tallyNewsResolution(tally, match.matchType)
      // The canonical id WINS over any provider id already present. ADR_F2_7 established that
      // the provider value uses a foreign namespace and is not joinable to our players, so
      // keeping it would preserve an id nothing can use. An unresolved name keeps whatever was
      // there (usually null) and stays general news.
      return match.playerId ? { ...r, playerId: match.playerId } : r
    })

    await prisma.playerNewsRecord.createMany({
      data: attributed,
      skipDuplicates: true,
    })
    imported += attributed.length
  }

  return {
    imported,
    sports: sports.map((s) => apiChainSportToDbSport(s)),
    // Surfaced so a degraded extractor is visible in the cron's own output rather than only in
    // a later audit. `null` means nothing was processed — a rate over zero items is not 100%.
    attribution: { ...tally, rate: attributionRate(tally) },
  }
}
