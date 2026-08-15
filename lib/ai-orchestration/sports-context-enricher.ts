/**
 * PROMPT 154 — AI + ClearSports orchestration. Enriches AI context envelopes with
 * normalized sports data (ClearSports or fallback). Deterministic-first; missing data
 * surfaced via dataQualityMetadata; no invented stats.
 */

import type { AIContextEnvelope } from '@/lib/unified-ai/types'
import { getSportsData, type DataType as SportsRouterDataType } from '@/lib/sports-router'
import { isSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { normalizeOrchestrationToolKey } from './tool-key-normalizer'
import { getADP, getADPTrends } from '@/lib/data/adp'
import { getLatestNews, getHighImpactNews } from '@/lib/data/news'
import { getPlayerNews, searchPlayers } from '@/lib/data/players'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { getUpcomingGames } from '@/lib/data/schedules'

type SportWithData = SupportedSport

function canFetchSportsData(sport: string): sport is SportWithData {
  return isSupportedSport(sport)
}

type CoreSportsEnrichmentDataType = Extract<
  SportsRouterDataType,
  'teams' | 'games' | 'schedule' | 'players' | 'standings' | 'team_stats'
>
type OptionalSportsEnrichmentDataType = 'projections' | 'rankings' | 'trends' | 'news'
export type SportsEnrichmentDataTypes = CoreSportsEnrichmentDataType | OptionalSportsEnrichmentDataType

export interface EnrichmentOptions {
  /** Which data types to fetch. When omitted, inferred from featureType. */
  dataTypes?: SportsEnrichmentDataTypes[]
  /** Optional player search terms to resolve player rows for deterministic tools. */
  playerSearchTerms?: string[]
  /** Optional season for games/schedule (e.g. "2024"). */
  season?: string
}

interface SportsContextFetchResult {
  sportsData: Record<string, unknown> | null
  source: string
  cached: boolean
  missing: string[]
  stale?: boolean
  attemptedSources: string[]
}

const FEATURE_PROFILE_WITH_STANDINGS = new Set([
  'rankings',
  'commentary',
  'power_rankings',
])

const FEATURE_PROFILE_WITH_GAMES = new Set([
  'matchup',
  'simulation',
  'matchup_simulator',
  'commentary',
  'story_creator',
  'chimmy_chat',
  'fantasy_coach',
])

const FEATURE_PROFILE_WITH_PLAYERS = new Set([
  'trade_analyzer',
  'trade_evaluator',
  'waiver_ai',
  'draft_helper',
  'matchup',
  'simulation',
  'rankings',
  'chimmy_chat',
  'fantasy_coach',
  'trend_detection',
  'player_comparison',
])

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function collectCandidatePlayerTerms(input: unknown, out: Set<string>, depth: number = 0): void {
  if (depth > 3 || input == null) return
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.length >= 3 && trimmed.length <= 60) out.add(trimmed)
    return
  }
  if (Array.isArray(input)) {
    for (const item of input.slice(0, 25)) collectCandidatePlayerTerms(item, out, depth + 1)
    return
  }
  if (typeof input !== 'object') return
  const record = input as Record<string, unknown>
  const directNameKeys = ['name', 'player', 'playerName', 'fullName', 'displayName']
  for (const key of directNameKeys) {
    const value = record[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length >= 3 && trimmed.length <= 60) out.add(trimmed)
    }
  }
  const nestedKeys = [
    'players',
    'candidates',
    'targets',
    'board',
    'lineup',
    'lineups',
    'roster',
    'comparison',
    'comparisons',
    'waiverTargets',
  ]
  for (const key of nestedKeys) {
    if (key in record) collectCandidatePlayerTerms(record[key], out, depth + 1)
  }
}

function extractPlayerSearchTermsFromEnvelope(envelope: AIContextEnvelope): string[] {
  const terms = new Set<string>()
  collectCandidatePlayerTerms(envelope.deterministicPayload, terms, 0)
  collectCandidatePlayerTerms(envelope.statisticsPayload, terms, 0)
  return Array.from(terms).slice(0, 8)
}

function resolveDataTypesForFeature(featureType: string, explicit?: SportsEnrichmentDataTypes[]): SportsEnrichmentDataTypes[] {
  if (explicit && explicit.length > 0) return unique(explicit)
  const normalizedFeature = normalizeOrchestrationToolKey(featureType)
  const raw = featureType.toLowerCase()

  const types: SportsEnrichmentDataTypes[] = ['teams']
  if (
    FEATURE_PROFILE_WITH_GAMES.has(normalizedFeature) ||
    raw.includes('matchup') ||
    raw.includes('simulation') ||
    raw.includes('power-rankings')
  ) {
    types.push('games')
  }
  if (
    FEATURE_PROFILE_WITH_PLAYERS.has(normalizedFeature) ||
    raw.includes('player-comparison') ||
    raw.includes('waiver') ||
    raw.includes('draft')
  ) {
    types.push('players')
  }
  if (
    FEATURE_PROFILE_WITH_STANDINGS.has(normalizedFeature) ||
    raw.includes('rankings') ||
    raw.includes('power-rankings')
  ) {
    types.push('standings')
  }
  if (raw.includes('trend')) types.push('trends')
  if (raw.includes('chimmy') || raw.includes('coach') || raw.includes('story')) types.push('news')
  if (raw.includes('draft') || raw.includes('waiver') || raw.includes('matchup') || raw.includes('comparison')) {
    types.push('projections')
  }
  if (raw.includes('rankings')) types.push('rankings')
  return unique(types)
}

/**
 * Fetch normalized sports data (ClearSports or fallback) and return a payload safe for
 * statisticsPayload.sportsData. Never throws; on failure returns null and missing list.
 */
export async function fetchSportsContextForEnvelope(
  sport: string,
  options: EnrichmentOptions = {},
): Promise<SportsContextFetchResult> {
  const dataTypes = options.dataTypes ?? ['teams']
  const missing: string[] = []
  const attemptedSources: string[] = []

  if (!sport || !isSupportedSport(sport)) {
    return {
      sportsData: null,
      source: 'none',
      cached: false,
      missing: ['teams', 'games', 'schedule'].filter((d) => dataTypes.includes(d as any)),
      attemptedSources,
    }
  }

  if (!canFetchSportsData(sport)) {
    return {
      sportsData: null,
      source: 'none',
      cached: false,
      missing: dataTypes.slice(),
      stale: false,
      attemptedSources,
    }
  }

  const sportTyped = sport as SportWithData
  const out: Record<string, unknown> = {}
  let source = 'none'
  let cached = false
  let stale = false
  const resolvedPlayerRows: Array<Record<string, unknown>> = []

  const trackSource = (value: string | undefined, fallbackSources?: string[]) => {
    if (value && value !== 'none' && source === 'none') source = value
    if (Array.isArray(fallbackSources)) attemptedSources.push(...fallbackSources)
  }

  try {
    if (dataTypes.includes('teams')) {
      const res = await getSportsData({ sport: sportTyped, dataType: 'teams' })
      const teams = Array.isArray(res.data) ? res.data : []
      out.teams = teams.slice(0, 50)
      if (teams.length > 0) {
        trackSource(res.source, res.attemptedSources)
        cached = cached || res.cached
        stale = stale || Boolean(res.stale)
      } else missing.push('teams')
    }

    if (dataTypes.includes('games') || dataTypes.includes('schedule')) {
      const games = await getUpcomingGames(sportTyped, 14)
      out.games = games.slice(0, 30)
      if (games.length > 0) {
        trackSource('database_first', ['game_schedules'])
      }
      if (games.length === 0) missing.push('games')
    }

    if (dataTypes.includes('standings')) {
      const res = await getSportsData({
        sport: sportTyped,
        dataType: 'standings',
      })
      const standings = Array.isArray(res.data) ? res.data : []
      out.standings = standings.slice(0, 30)
      if (standings.length > 0) {
        trackSource(res.source, res.attemptedSources)
        cached = cached || res.cached
        stale = stale || Boolean(res.stale)
      } else {
        missing.push('standings')
      }
    }

    if (dataTypes.includes('team_stats')) {
      const res = await getSportsData({
        sport: sportTyped,
        dataType: 'team_stats',
      })
      const teamStats = Array.isArray(res.data) ? res.data : []
      out.teamStats = teamStats.slice(0, 30)
      if (teamStats.length > 0) {
        trackSource(res.source, res.attemptedSources)
        cached = cached || res.cached
        stale = stale || Boolean(res.stale)
      } else {
        missing.push('team_stats')
      }
    }

    if (dataTypes.includes('players')) {
      const terms = unique(options.playerSearchTerms ?? []).filter((term) => term.trim().length >= 3).slice(0, 6)
      if (terms.length === 0) {
        missing.push('players_query_context')
      } else {
        const playerSearchResults = await Promise.all(terms.map((term) => searchPlayers(term, sportTyped)))
        const players: Array<Record<string, unknown>> = []
        for (const rows of playerSearchResults) {
          for (const row of rows.slice(0, 10)) {
            const rec = toRecord(row)
            if (rec) {
              players.push(rec)
              resolvedPlayerRows.push(rec)
            }
          }
        }
        const deduped = Array.from(
          new Map(
            players.map((item) => {
              const id = typeof item.id === 'string' ? item.id : JSON.stringify(item).slice(0, 80)
              return [id, item]
            })
          ).values()
        )
        out.players = deduped.slice(0, 60)
        if (deduped.length === 0) missing.push('players')
        else {
          trackSource('database_first', ['sports_players'])

          const playerIds = deduped
            .map((item) => (typeof item.id === 'string' ? item.id : null))
            .filter((item): item is string => Boolean(item))
            .slice(0, 12)

          if (playerIds.length > 0) {
            const [injuryList, news] = await Promise.all([
              // Canonical injury read port — TTL-respected and self-reporting on
              // staleness. This previously used getInjuryReport, which reads
              // injury_report_records and only refreshes when that table is
              // EMPTY; it has not been empty since April, so this enricher fed
              // the model 108-day-old designations with no dates attached.
              listInjuryFacts({ sport: sportTyped, limit: 25 }),
              Promise.all(playerIds.slice(0, 6).map((playerId) => getPlayerNews(playerId, 3))),
            ])
            // Stale rows are dropped rather than caveated here: this payload is
            // consumed as structured context, so a caveat in a sibling field is
            // not reliably carried into the answer. Each surviving row states
            // when it was reported.
            const freshInjuries = (injuryList.facts ?? []).filter((f) => !f.stale)
            if (freshInjuries.length > 0) {
              out.injuries = freshInjuries.slice(0, 25).map((f) => ({
                playerName: f.playerName,
                team: f.team,
                // Null means no designation was stated — NOT healthy.
                status: f.status ?? 'no designation stated',
                bodyPart: f.type,
                notes: f.description,
                reportedHoursAgo: Math.max(0, Math.round(f.ageHours)),
                asOf: f.fetchedAt.toISOString(),
              }))
            } else {
              out.injuriesUnavailable =
                injuryList.feedStale || (injuryList.facts ?? []).length === 0
                  ? `No live injury feed for ${sportTyped}; do not state any player's injury status.`
                  : `Injury feed for ${sportTyped} is past its freshness window; do not state any player's injury status.`
            }
            const flattenedNews = news.flat()
            if (flattenedNews.length > 0) out.playerNews = flattenedNews.slice(0, 18)
          }
        }
      }
    }

    if (dataTypes.includes('projections')) {
      const projections = resolvedPlayerRows
        .map((row) => {
          const projection = toRecord(row.projections)
          if (!projection || Object.keys(projection).length === 0) return null
          return {
            id: row.id,
            name: row.name,
            team: row.team,
            position: row.position,
            projection,
          }
        })
        .filter(Boolean)

      if (projections.length > 0) {
        out.projections = projections.slice(0, 80)
        trackSource('database_first', ['sports_players'])
      } else {
        missing.push('projections')
      }
    }

    if (dataTypes.includes('rankings')) {
      const rankings = await getADP(sportTyped, 'redraft', 'standard')
      if (rankings.length > 0) {
        out.rankings = rankings.slice(0, 80).map((row, index) => ({
          rank: index + 1,
          playerId: row.playerId,
          playerName: row.playerName,
          team: row.team,
          position: row.position,
          adp: row.adp,
          source: row.source,
          providerCount: (row as any).providerCount ?? null,
          adpSpread: (row as any).adpSpread ?? null,
          confidenceScore: (row as any).confidenceScore ?? null,
          providerBreakdown: (row as any).providerBreakdown ?? null,
        }))
        trackSource('database_first', ['adp_data'])
      } else {
        missing.push('rankings')
      }
    }

    if (dataTypes.includes('trends')) {
      const playerTrendIds = resolvedPlayerRows
        .map((row) => (typeof row.id === 'string' ? row.id : null))
        .filter((row): row is string => Boolean(row))
        .slice(0, 8)
      const [adpTrends, highImpactNews] = await Promise.all([
        Promise.all(playerTrendIds.map((playerId) => getADPTrends(playerId, 4))),
        getHighImpactNews(sportTyped),
      ])
      const flattened = adpTrends.flat()
      if (flattened.length > 0 || highImpactNews.length > 0) {
        out.trends = [
          ...flattened.slice(0, 24).map((row) => ({
            playerId: row.playerId,
            playerName: row.playerName,
            adp: row.adp,
            adpChange: row.adpChange,
            source: row.source,
            providerCount: (row as any).providerCount ?? null,
            adpSpread: (row as any).adpSpread ?? null,
            confidenceScore: (row as any).confidenceScore ?? null,
            providerBreakdown: (row as any).providerBreakdown ?? null,
          })),
          ...highImpactNews.slice(0, 12).map((row) => ({
            playerId: row.playerId,
            playerName: row.playerName,
            headline: row.headline,
            impact: row.impact,
            publishedAt: row.publishedAt.toISOString(),
          })),
        ]
        trackSource('database_first', ['adp_data', 'player_news'])
      } else {
        missing.push('trends')
      }
    }

    if (dataTypes.includes('news')) {
      const news = await getLatestNews(sportTyped, 25)
      if (news.length > 0) {
        out.news = news.slice(0, 25)
        trackSource('database_first', ['player_news'])
      } else {
        missing.push('news')
      }
    }
  } catch (_e) {
    for (const item of dataTypes) {
      if (!missing.includes(item)) missing.push(item)
    }
  }

  const hasAny = Object.values(out).some((value) => Array.isArray(value) && value.length > 0)
  const finalMissing = unique(missing)
  const finalSources = unique(attemptedSources)
  return {
    sportsData: hasAny ? out : null,
    source,
    cached,
    missing: finalMissing,
    stale: stale || cached,
    attemptedSources: finalSources,
  }
}

/**
 * Enrich an envelope with sports data when sport is set. Merges into statisticsPayload.sportsData,
 * sets dataQualityMetadata when data is missing or from fallback. Never throws.
 */
export async function enrichEnvelopeWithSportsData(
  envelope: AIContextEnvelope,
  options?: EnrichmentOptions,
): Promise<AIContextEnvelope> {
  const sport = envelope.sport?.trim()
  if (!sport) return envelope

  const dataTypes = resolveDataTypesForFeature(envelope.featureType, options?.dataTypes)
  const inferredPlayerTerms = options?.playerSearchTerms?.length
    ? options.playerSearchTerms
    : extractPlayerSearchTermsFromEnvelope(envelope)

  const { sportsData, source, missing, stale, cached, attemptedSources } = await fetchSportsContextForEnvelope(sport, {
    dataTypes,
    playerSearchTerms: inferredPlayerTerms,
    season: options?.season,
  })

  const statisticsPayload = { ...(envelope.statisticsPayload ?? {}) }
  statisticsPayload.sportsDataSource = source
  statisticsPayload.sportsDataCached = cached
  statisticsPayload.sportsDataState = sportsData ? (stale ? 'stale' : cached ? 'cached' : 'live') : 'missing'
  statisticsPayload.sportsDataCoverage = {
    requested: dataTypes,
    available: sportsData ? Object.keys(sportsData) : [],
    missing,
  }
  statisticsPayload.sportsDataAttemptedSources = attemptedSources
  if (sportsData && Object.keys(sportsData).length > 0) {
    statisticsPayload.sportsData = sportsData
  }

  const dataQualityMetadata = { ...(envelope.dataQualityMetadata ?? {}) }
  const missingForMetadata = missing.map((item) => `sports:${item}`)
  if (missingForMetadata.length > 0) {
    dataQualityMetadata.missing = [...new Set([...(dataQualityMetadata.missing ?? []), ...missingForMetadata])]
  }
  if (stale) dataQualityMetadata.stale = true

  const hardConstraints = [...(envelope.hardConstraints ?? [])]
  hardConstraints.push(
    'Use deterministic context and statisticsPayload.sportsData as the only factual sports context. Do not invent unsupported player/team/game stats.'
  )
  if (sportsData) {
    hardConstraints.push(
      `Sports context keys available: ${Object.keys(sportsData).join(', ')}. Cite only values present in these keys when making sports-specific claims.`
    )
  }
  if (missingForMetadata.length > 0) {
    hardConstraints.push(
      `Do not invent or assume data for: ${missingForMetadata.join(', ')}. When information is unavailable, say so explicitly.`,
    )
  }

  return {
    ...envelope,
    statisticsPayload: Object.keys(statisticsPayload).length > 0 ? statisticsPayload : envelope.statisticsPayload,
    dataQualityMetadata: Object.keys(dataQualityMetadata).length > 0 ? dataQualityMetadata : envelope.dataQualityMetadata,
    hardConstraints: hardConstraints.length > 0 ? hardConstraints : envelope.hardConstraints,
  }
}
