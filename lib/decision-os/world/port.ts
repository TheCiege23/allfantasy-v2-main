/**
 * Decision OS — Phase 2 Canonical World Assembly: the READ-ONLY data-access port.
 *
 * This is the ONLY file in the substrate permitted to import prisma, and it exposes ONLY read methods
 * (`findUnique` / `findMany`). There is intentionally no create/update/upsert/delete surface anywhere
 * in the world module, so the read-only guarantee is structural: nothing the assembler can reach is
 * able to write. In particular this NEVER calls `resolveRedraftRosterLookup` (which performs owner
 * repair via `prisma.redraftRoster.update`).
 */
import { prisma } from '@/lib/prisma'
import type {
  RawAdpRow,
  RawInjuryContextRow,
  RawLeagueActivityCounts,
  RawLeagueReputationRow,
  RawLeagueRow,
  RawMarketValueRow,
  RawNewsRow,
  RawPerformanceRow,
  RawPlayerGameFactRow,
  RawPlayerMetadataRow,
  RawProjectionRow,
  RawRosterRow,
  RawScheduleGameRow,
  RawTeamRow,
  RawWeatherRow,
} from './facts'
import { mapRedraftRosterRowToRawRoster, unionRosterRows, type RawRedraftRosterRow } from './redraftRoster'

export interface CanonicalWorldPort {
  loadLeague(leagueId: string): Promise<RawLeagueRow | null>
  loadTeams(leagueId: string): Promise<RawTeamRow[]>
  loadRosters(leagueId: string): Promise<RawRosterRow[]>
  loadPerformances(teamIds: string[], season: number): Promise<RawPerformanceRow[]>
}

export const defaultCanonicalWorldPort: CanonicalWorldPort = {
  async loadLeague(leagueId) {
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        sport: true,
        season: true,
        scoring: true,
        scoringPresetId: true,
        leagueType: true,
        isDynasty: true,
        rosterSize: true,
        starters: true,
        irSlots: true,
        taxiSlots: true,
        waiverType: true,
        waiverBudget: true,
        waiverMinBid: true,
        waiverHours: true,
        tradeReviewHours: true,
        tradeDeadlineWeek: true,
        draftPickTrading: true,
        settings: true,
        lastSyncedAt: true,
        syncStatus: true,
        platform: true,
        platformLeagueId: true,
      },
    })
    if (!row) return null
    return {
      id: row.id,
      sport: String(row.sport),
      season: row.season,
      scoring: row.scoring ?? null,
      scoringPresetId: row.scoringPresetId ?? null,
      leagueType: row.leagueType ?? null,
      isDynasty: row.isDynasty,
      rosterSize: row.rosterSize ?? null,
      starters: row.starters ?? null,
      irSlots: row.irSlots ?? null,
      taxiSlots: row.taxiSlots ?? null,
      waiverType: row.waiverType ?? null,
      waiverBudget: row.waiverBudget ?? null,
      waiverMinBid: row.waiverMinBid ?? null,
      waiverHours: row.waiverHours ?? null,
      tradeReviewHours: row.tradeReviewHours ?? null,
      tradeDeadlineWeek: row.tradeDeadlineWeek ?? null,
      draftPickTrading: row.draftPickTrading ?? null,
      settings: row.settings ?? null,
      lastSyncedAt: row.lastSyncedAt ?? null,
      syncStatus: row.syncStatus ?? null,
      platform: row.platform ?? null,
      platformLeagueId: row.platformLeagueId ?? null,
    }
  },

  async loadTeams(leagueId) {
    const rows = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: {
        id: true,
        externalId: true,
        ownerName: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        pointsAgainst: true,
        currentRank: true,
        role: true,
        isOrphan: true,
        isCommissioner: true,
        isCoCommissioner: true,
        platformUserId: true,
        claimedByUserId: true,
      },
    })
    return rows.map((row: {
      id: string
      externalId: string | null
      ownerName: string | null
      teamName: string | null
      wins: number | null
      losses: number | null
      ties: number | null
      pointsFor: number | null
      pointsAgainst: number | null
      currentRank: number | null
      role: string | null
      isOrphan: boolean | null
      isCommissioner: boolean | null
      isCoCommissioner: boolean | null
      platformUserId: string | null
      claimedByUserId: string | null
    }) => ({
      id: row.id,
      externalId: row.externalId ?? '',
      ownerName: row.ownerName ?? '',
      teamName: row.teamName ?? '',
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      ties: row.ties ?? 0,
      pointsFor: row.pointsFor ?? 0,
      pointsAgainst: row.pointsAgainst ?? 0,
      currentRank: row.currentRank ?? null,
      role: row.role ?? 'member',
      isOrphan: row.isOrphan ?? false,
      isCommissioner: row.isCommissioner ?? false,
      isCoCommissioner: row.isCoCommissioner ?? false,
      platformUserId: row.platformUserId ?? null,
      claimedByUserId: row.claimedByUserId ?? null,
    }))
  },

  async loadRosters(leagueId) {
    // Source 1 — canonical `Roster.playerData` (imported leagues + some native AF leagues).
    const rows = await prisma.roster.findMany({
      where: { leagueId },
      select: {
        id: true,
        platformUserId: true,
        playerData: true,
        faabRemaining: true,
        waiverPriority: true,
        settings: true,
      },
    })
    const canonical: RawRosterRow[] = rows.map((row: {
      id: string
      platformUserId: string | null
      playerData: unknown
      faabRemaining: number | null
      waiverPriority: number | null
      settings: unknown
    }) => ({
      id: row.id,
      platformUserId: row.platformUserId ?? '',
      playerData: row.playerData ?? null,
      faabRemaining: row.faabRemaining ?? null,
      waiverPriority: row.waiverPriority ?? null,
      settings: row.settings ?? null,
      sourceModel: 'Roster',
    }))

    // Source 2 — native redraft `RedraftRoster` / `RedraftRosterPlayer` (read-only; only non-dropped
    // players). Projected into the SAME RawRosterRow shape, then unioned with canonical (Roster wins on
    // owner conflict). See ADR_CANONICAL_WORLD_REDRAFT_COVERAGE.md. This NEVER calls the write-prone
    // `resolveRedraftRosterLookup`; it reads the rows directly with a `findMany`.
    const redraftRows = await prisma.redraftRoster.findMany({
      where: { leagueId },
      select: {
        id: true,
        ownerId: true,
        faabBalance: true,
        waiverPriority: true,
        players: {
          where: { droppedAt: null },
          select: { playerId: true, slotType: true },
        },
      },
    })
    const redraft: RawRosterRow[] = redraftRows.map((row: RawRedraftRosterRow) =>
      mapRedraftRosterRowToRawRoster(row),
    )

    return unionRosterRows(canonical, redraft)
  },

  async loadPerformances(teamIds, season) {
    if (teamIds.length === 0) return []
    const rows = await prisma.teamPerformance.findMany({
      where: { teamId: { in: teamIds }, season },
      select: {
        teamId: true,
        week: true,
        season: true,
        points: true,
        opponent: true,
        result: true,
      },
    })
    return rows.map((row: {
      teamId: string
      week: number
      season: number
      points: number | null
      opponent: string | null
      result: string | null
    }) => ({
      teamId: row.teamId,
      week: row.week,
      season: row.season,
      points: row.points ?? 0,
      opponent: row.opponent ?? null,
      result: row.result ?? null,
    }))
  },
}

/**
 * READ-ONLY player-metadata read for the canonical enrichment seam (lib/decision-os/world/playerMetadata).
 *
 * Resolves raw canonical roster ids (provider ids for imported leagues, native ids for AF leagues) to
 * persisted player rows from the SportsPlayer cache — the SAME table + key the existing imported-league
 * lineup scan reads (lib/lineup-actions/sleeperLineupScan.ts). This is a single `findMany` ONLY: it never
 * writes, never warms the cache, and NEVER calls a live provider API (it reads only already-persisted
 * rows; the live Sleeper players endpoint in players-cache.ts is deliberately NOT touched). Freshest row
 * per id wins (orderBy fetchedAt desc) so the projector's first-write-wins keeps the latest.
 */
export async function loadPlayerMetadataRows(
  sport: string,
  ids: string[],
): Promise<RawPlayerMetadataRow[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport, OR: [{ externalId: { in: clean } }, { sleeperId: { in: clean } }] },
    orderBy: { fetchedAt: 'desc' },
    select: {
      externalId: true,
      sleeperId: true,
      name: true,
      position: true,
      team: true,
      status: true,
      source: true,
    },
  })
  return rows.map(
    (row: {
      externalId: string
      sleeperId: string | null
      name: string | null
      position: string | null
      team: string | null
      status: string | null
      source: string | null
    }) => ({
      externalId: row.externalId,
      sleeperId: row.sleeperId ?? null,
      name: row.name ?? null,
      position: row.position ?? null,
      team: row.team ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
    }),
  )
}

function cleanScheduleSeason(input: string | number): string {
  const raw = String(input ?? '').trim()
  return raw.includes('-') ? raw.split('-')[0]! : raw
}

function cleanScheduleTeam(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  return trimmed ? trimmed : null
}

function scheduleGameKey(row: Pick<RawScheduleGameRow, 'week' | 'homeTeam' | 'awayTeam'>): string {
  return `${row.week}|${cleanScheduleTeam(row.homeTeam) ?? ''}|${cleanScheduleTeam(row.awayTeam) ?? ''}`
}

/**
 * READ-ONLY season-schedule read for the F2.2 schedule/bye enrichment seam.
 *
 * Reads ONLY already-persisted schedule rows. Preference order:
 *   1. `FantasyScheduleGame` (canonical fantasy cache: source + fetchedAt + expiresAt)
 *   2. `GameSchedule` (generic schedule cache fallback: updatedAt only)
 *
 * The first row per normalized matchup key wins, so fantasy-cache rows shadow generic schedule rows when
 * both exist. NO writes, NO refreshes, NO provider API calls.
 */
export async function loadScheduleGameRows(
  sport: string,
  season: number,
  teamKeys?: string[],
): Promise<RawScheduleGameRow[]> {
  const cleanSport = String(sport ?? '').trim().toUpperCase()
  if (!cleanSport) return []
  const cleanTeams = Array.from(
    new Set(
      (teamKeys ?? [])
        .map((value) => cleanScheduleTeam(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )

  const fantasyWhere =
    cleanTeams.length > 0
      ? {
          sport: cleanSport,
          season: cleanScheduleSeason(season),
          OR: [{ homeTeam: { in: cleanTeams } }, { awayTeam: { in: cleanTeams } }],
        }
      : { sport: cleanSport, season: cleanScheduleSeason(season) }

  const gameWhere =
    cleanTeams.length > 0
      ? {
          sportType: cleanSport,
          season,
          OR: [{ homeTeam: { in: cleanTeams } }, { awayTeam: { in: cleanTeams } }],
        }
      : { sportType: cleanSport, season }

  const [fantasyRows, gameRows] = await Promise.all([
    prisma.fantasyScheduleGame.findMany({
      where: fantasyWhere,
      orderBy: [{ week: 'asc' }, { fetchedAt: 'desc' }],
      select: {
        sport: true,
        season: true,
        week: true,
        homeTeam: true,
        awayTeam: true,
        kickoffTime: true,
        status: true,
        source: true,
        fetchedAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    }),
    prisma.gameSchedule.findMany({
      where: gameWhere,
      orderBy: [{ weekOrRound: 'asc' }, { updatedAt: 'desc' }],
      select: {
        sportType: true,
        season: true,
        weekOrRound: true,
        homeTeam: true,
        awayTeam: true,
        startTime: true,
        status: true,
        updatedAt: true,
      },
    }),
  ])

  const combined: RawScheduleGameRow[] = [
    ...fantasyRows.map((row: {
      sport: string
      season: string
      week: number
      homeTeam: string
      awayTeam: string
      kickoffTime: Date | null
      status: string | null
      source: string
      fetchedAt: Date
      expiresAt: Date
      updatedAt: Date
    }) => ({
      sport: cleanSport,
      season: Number.parseInt(cleanScheduleSeason(row.season), 10) || season,
      week: row.week,
      homeTeam: cleanScheduleTeam(row.homeTeam),
      awayTeam: cleanScheduleTeam(row.awayTeam),
      kickoffTime: row.kickoffTime ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
      fetchedAt: row.fetchedAt ?? null,
      expiresAt: row.expiresAt ?? null,
      updatedAt: row.updatedAt ?? null,
      sourceModel: 'FantasyScheduleGame' as const,
    })),
    ...gameRows.map((row: {
      sportType: string
      season: number
      weekOrRound: number
      homeTeam: string | null
      awayTeam: string | null
      startTime: Date | null
      status: string
      updatedAt: Date
    }) => ({
      sport: cleanSport,
      season: row.season,
      week: row.weekOrRound,
      homeTeam: cleanScheduleTeam(row.homeTeam),
      awayTeam: cleanScheduleTeam(row.awayTeam),
      kickoffTime: row.startTime ?? null,
      status: row.status ?? null,
      source: null,
      fetchedAt: null,
      expiresAt: null,
      updatedAt: row.updatedAt ?? null,
      sourceModel: 'GameSchedule' as const,
    })),
  ]

  const deduped = new Map<string, RawScheduleGameRow>()
  for (const row of combined) {
    if (row.week <= 0) continue
    const key = scheduleGameKey(row)
    if (!deduped.has(key)) deduped.set(key, row)
  }
  return [...deduped.values()].sort((a, b) => a.week - b.week)
}

/**
 * READ-ONLY injury-context read for the F2.3 injury/availability enrichment seam.
 *
 * Reads the SAME SportsPlayer cache as F2.1 player metadata but selects freshness fields
 * (fetchedAt / expiresAt / updatedAt) that the F2.1 read does not include. One `findMany` only —
 * no writes, no cache warming, no live API calls. Freshest row per id wins (orderBy fetchedAt desc).
 */
export async function loadInjuryContextRows(
  sport: string,
  ids: string[],
): Promise<RawInjuryContextRow[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport, OR: [{ externalId: { in: clean } }, { sleeperId: { in: clean } }] },
    orderBy: { fetchedAt: 'desc' },
    select: {
      externalId: true,
      sleeperId: true,
      status: true,
      source: true,
      fetchedAt: true,
      expiresAt: true,
      updatedAt: true,
    },
  })
  return rows.map(
    (row: {
      externalId: string
      sleeperId: string | null
      status: string | null
      source: string | null
      fetchedAt: Date
      expiresAt: Date
      updatedAt: Date
    }) => ({
      externalId: row.externalId,
      sleeperId: row.sleeperId ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
      fetchedAt: row.fetchedAt ?? null,
      expiresAt: row.expiresAt ?? null,
      updatedAt: row.updatedAt ?? null,
    }),
  )
}

/**
 * READ-ONLY ADP read for the F2.4 ADP/market-value enrichment seam.
 *
 * Reads `AdpDataRecord` — the SAME table Phase E trade enrichment reads via
 * `lib/decision-os/trade/loader.ts`, but selects richer fields (format, scoring, adpChange,
 * adpSpread, confidenceScore, providerCount, week, season, createdAt) for the world layer. Returns
 * ALL matching rows (all format/scoring variants) ordered by `createdAt desc` — format selection
 * happens in the projector (`selectBestAdpRow`), not here, so port stays format-agnostic.
 *
 * Slice limit: 200 unique ids max (same as other enrichment ports).
 * NO writes, NO live provider calls, NO cache warming.
 */
export async function loadAdpRows(
  sport: string,
  ids: string[],
): Promise<RawAdpRow[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.adpDataRecord.findMany({
    where: { playerId: { in: clean }, sport },
    orderBy: { createdAt: 'desc' },
    select: {
      playerId: true,
      adp: true,
      adpChange: true,
      adpSpread: true,
      confidenceScore: true,
      providerCount: true,
      format: true,
      scoring: true,
      season: true,
      week: true,
      source: true,
      createdAt: true,
    },
  })
  return rows.map((row: {
    playerId: string
    adp: number
    adpChange: number | null
    adpSpread: number | null
    confidenceScore: number | null
    providerCount: number | null
    format: string
    scoring: string
    season: number
    week: number
    source: string
    createdAt: Date
  }) => ({
    playerId: row.playerId,
    adp: row.adp,
    adpChange: row.adpChange ?? null,
    adpSpread: row.adpSpread ?? null,
    confidenceScore: row.confidenceScore ?? null,
    providerCount: row.providerCount ?? null,
    format: row.format,
    scoring: row.scoring,
    season: row.season,
    week: row.week,
    source: row.source,
    createdAt: row.createdAt,
  }))
}

/**
 * READ-ONLY market-value read for the F2.4 ADP/market-value enrichment seam.
 *
 * Reads `AllFantasyMarketPlayerValue` filtered by `sport + published:true`. Returns one row per
 * player (freshest by `generatedAt desc`). Currently `leagueConcept` is always 'redraft' in the
 * database (see ADR_F2_4 §2.2) — no concept filter applied so new concepts land automatically.
 *
 * NO writes, NO live API calls. If the ID space doesn't match canonical roster IDs, the miss
 * is surfaced as `market_value_unavailable` (P2 honest degrade — never fabricated).
 */
export async function loadMarketValueRows(
  sport: string,
  ids: string[],
): Promise<RawMarketValueRow[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.allFantasyMarketPlayerValue.findMany({
    where: { playerId: { in: clean }, sport, published: true },
    orderBy: { generatedAt: 'desc' },
    select: {
      playerId: true,
      marketValue: true,
      baseValue: true,
      adjustmentPercent: true,
      confidence: true,
      sampleSize: true,
      direction: true,
      leagueConcept: true,
      scoringFormat: true,
      generatedAt: true,
      updatedAt: true,
    },
  })
  return rows.map((row: {
    playerId: string
    marketValue: number
    baseValue: number
    adjustmentPercent: number
    confidence: number
    sampleSize: number
    direction: string
    leagueConcept: string
    scoringFormat: string | null
    generatedAt: Date
    updatedAt: Date
  }) => ({
    playerId: row.playerId,
    marketValue: row.marketValue,
    baseValue: row.baseValue,
    adjustmentPercent: row.adjustmentPercent,
    confidence: row.confidence,
    sampleSize: row.sampleSize,
    direction: row.direction,
    leagueConcept: row.leagueConcept,
    scoringFormat: row.scoringFormat ?? null,
    generatedAt: row.generatedAt,
    updatedAt: row.updatedAt,
  }))
}

/**
 * READ-ONLY weekly projection read for the F2.5 projection enrichment seam.
 *
 * Reads `FantasyProjection` — the canonical fantasy projection cache (importers write provider-backed
 * values only; no AI-generated or heuristic values). Returns ALL scoring-preset variants for the given
 * player IDs + sport + season + week; format selection happens in the projector (`selectBestProjectionRow`),
 * not here, so this port remains format-agnostic.
 *
 * `season` must be passed as a string (matches the DB column type). `week` must be a known current week
 * (callers must resolve `LeagueFacts.currentWeek` before invoking — if week is null, skip this call).
 *
 * Ordered by `expiresAt desc` so freshest rows come first within each scoring preset.
 * Slice limit: 200 unique ids max (consistent with other enrichment ports).
 * NO writes, NO live provider calls, NO cache warming.
 */
export async function loadProjectionRows(
  sport: string,
  ids: string[],
  season: string,
  week: number,
): Promise<RawProjectionRow[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.fantasyProjection.findMany({
    where: { playerId: { in: clean }, sport, season, week },
    orderBy: { expiresAt: 'desc' },
    select: {
      playerId: true,
      sport: true,
      season: true,
      week: true,
      scoringPresetId: true,
      projectedPoints: true,
      stats: true,
      source: true,
      fetchedAt: true,
      expiresAt: true,
    },
  })
  return rows.map((row: {
    playerId: string
    sport: string
    season: string
    week: number
    scoringPresetId: string
    projectedPoints: number
    stats: unknown
    source: string
    fetchedAt: Date
    expiresAt: Date
  }) => ({
    playerId: row.playerId,
    sport: row.sport,
    season: row.season,
    week: row.week,
    scoringPresetId: row.scoringPresetId,
    projectedPoints: row.projectedPoints,
    stats: row.stats,
    source: row.source,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  }))
}

/**
 * READ-ONLY warehouse per-game fact read for the F2.9 performance enrichment seam (ADR F2.9).
 *
 * One bounded batched query for the whole roster id set — this IS the batch-loading
 * optimization; callers must never loop per player. `season` is optional: when omitted the
 * newest season present in the warehouse for these players is served (offseason honesty —
 * the view reports which season the facts came from).
 */
export async function loadPlayerGameFactRows(
  sport: string,
  ids: string[],
  season?: number,
): Promise<RawPlayerGameFactRow[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.playerGameFact.findMany({
    where: {
      playerId: { in: clean },
      sport: sport.toUpperCase(),
      ...(season != null ? { season } : {}),
    },
    orderBy: [{ season: 'desc' }, { weekOrRound: 'asc' }],
    select: {
      playerId: true,
      sport: true,
      season: true,
      weekOrRound: true,
      fantasyPoints: true,
      normalizedStats: true,
      createdAt: true,
    },
  })
  return rows.map((row) => ({
    playerId: row.playerId,
    sport: row.sport,
    season: row.season,
    weekOrRound: row.weekOrRound,
    fantasyPoints: row.fantasyPoints,
    normalizedStats: row.normalizedStats,
    createdAt: row.createdAt,
  }))
}

/**
 * READ-ONLY weather read for the F2.6 weather enrichment seam.
 *
 * Reads `WeatherCache` by team-window cache-key prefix for each supplied team abbreviation.
 * Cache keys follow the pattern `weather:team-window:{TEAM}:{YYYY-MM-DD}` (see ADR_F2_6_WEATHER.md
 * §2.2). The query uses Prisma `startsWith` on `cacheKey` per team (OR-combined) so it picks up the
 * most recent entry for each team regardless of the exact game date — this keeps F2.6 independent of
 * F2.2 schedule context. Port returns ALL matching rows; the projector takes the freshest per team.
 *
 * `teamAbbrevs` must already be normalized to UPPERCASE (matching the cache key format).
 * Slice limit: 50 unique team abbreviations (one NFL roster has at most 32 teams).
 * NO writes, NO live API calls, NO cache warming.
 */
export async function loadWeatherRows(
  teamAbbrevs: string[],
): Promise<RawWeatherRow[]> {
  const clean = Array.from(new Set(teamAbbrevs.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 50)
  if (clean.length === 0) return []

  // WeatherCache is accessed via the escape hatch (prisma as any) because the model may not be
  // present in all schema variants; the weather service already does the same thing.
  const wc = (prisma as unknown as Record<string, unknown>)['weatherCache'] as {
    findMany(args: unknown): Promise<unknown[]>
  }
  if (!wc) return []

  const rows = await wc.findMany({
    where: {
      OR: clean.map((t) => ({ cacheKey: { startsWith: `weather:team-window:${t}:` } })),
    },
    orderBy: { expiresAt: 'desc' },
    take: clean.length * 4, // up to 4 entries per team (multiple game dates in cache)
    select: {
      cacheKey: true,
      sport: true,
      eventId: true,
      temperatureF: true,
      feelsLikeF: true,
      windSpeedMph: true,
      windGustsMph: true,
      windDirectionDeg: true,
      precipChancePct: true,
      rainInches: true,
      snowInches: true,
      conditionCode: true,
      conditionLabel: true,
      isIndoor: true,
      isDome: true,
      roofClosed: true,
      fetchedAt: true,
      expiresAt: true,
      dataSource: true,
    },
  })

  return (rows as Array<{
    cacheKey: string
    sport: string | null
    eventId: string | null
    temperatureF: number | null
    feelsLikeF: number | null
    windSpeedMph: number | null
    windGustsMph: number | null
    windDirectionDeg: number | null
    precipChancePct: number | null
    rainInches: number | null
    snowInches: number | null
    conditionCode: string | null
    conditionLabel: string | null
    isIndoor: boolean
    isDome: boolean
    roofClosed: boolean
    fetchedAt: Date
    expiresAt: Date
    dataSource: string
  }>).map((row) => ({
    cacheKey: row.cacheKey,
    sport: row.sport ?? null,
    eventId: row.eventId ?? null,
    temperatureF: row.temperatureF ?? null,
    feelsLikeF: row.feelsLikeF ?? null,
    windSpeedMph: row.windSpeedMph ?? null,
    windGustsMph: row.windGustsMph ?? null,
    windDirectionDeg: row.windDirectionDeg ?? null,
    precipChancePct: row.precipChancePct ?? null,
    rainInches: row.rainInches ?? null,
    snowInches: row.snowInches ?? null,
    conditionCode: row.conditionCode ?? null,
    conditionLabel: row.conditionLabel ?? null,
    isIndoor: row.isIndoor ?? false,
    isDome: row.isDome ?? false,
    roofClosed: row.roofClosed ?? false,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    dataSource: row.dataSource,
  }))
}

/**
 * READ-ONLY news read for the F2.7 news-signal enrichment seam.
 *
 * Queries `PlayerNewsRecord` by sport + playerName IN list within a configurable lookback
 * window. Rows where playerName = 'General Update' or is blank are excluded at the DB level
 * (they represent general sports news without player attribution).
 *
 * `playerNames` should be passed as-is from F2.1 EnrichedPlayer.name values — Prisma uses
 * `mode: 'insensitive'` for the case-insensitive match.
 *
 * NO writes, NO live API calls, NO cache warming.
 */
export async function loadNewsRows(
  sport: string,
  playerNames: string[],
  since: Date,
): Promise<RawNewsRow[]> {
  const clean = Array.from(new Set(playerNames.filter((n) => typeof n === 'string' && n.trim().length > 0))).slice(0, 200)
  if (clean.length === 0) return []

  const rows = await prisma.playerNewsRecord.findMany({
    where: {
      sport,
      publishedAt: { gte: since },
      playerName: { in: clean, mode: 'insensitive' },
      // Exclude general news rows with no player attribution
      NOT: { playerName: { in: ['General Update', ''], mode: 'insensitive' } },
    },
    orderBy: { publishedAt: 'desc' },
    take: clean.length * 5, // up to 5 news items per player name
    select: {
      id: true,
      sport: true,
      playerName: true,
      team: true,
      headline: true,
      body: true,
      impact: true,
      fantasyRelevant: true,
      source: true,
      publishedAt: true,
      createdAt: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    sport: row.sport,
    playerName: row.playerName,
    team: row.team ?? null,
    headline: row.headline,
    body: row.body,
    impact: row.impact,
    fantasyRelevant: row.fantasyRelevant,
    source: row.source,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  }))
}

/**
 * F2.8 — Load league activity counts (waiver claims, trades, roster moves) for a lookback window.
 * Issues three `_count` queries — no row data fetched. Read-only.
 */
export async function loadLeagueActivityCounts(
  leagueId: string,
  since: Date,
  lookbackDays: number,
): Promise<RawLeagueActivityCounts> {
  const [waiverClaimCount, tradeCount, rosterMoveCount] = await Promise.all([
    prisma.waiverClaim.count({ where: { leagueId, createdAt: { gte: since } } }),
    prisma.afLeagueTrade.count({ where: { leagueId, createdAt: { gte: since } } }),
    prisma.afRosterMoveHistory.count({ where: { leagueId, createdAt: { gte: since } } }),
  ])
  return { waiverClaimCount, tradeCount, rosterMoveCount, lookbackDays, loadedAt: new Date() }
}

/**
 * F2.8 — Load the precomputed LeagueReputation row for a league (read-only carry).
 * Returns null when no row exists. Prisma Decimal fields are cast to number | null.
 */
export async function loadLeagueReputation(leagueId: string): Promise<RawLeagueReputationRow | null> {
  const row = await prisma.leagueReputation.findUnique({ where: { leagueId } })
  if (!row) return null
  return {
    leagueId: row.leagueId,
    overallScore: row.overallScore !== null ? Number(row.overallScore) : null,
    tier: row.tier ?? null,
    completionRate: row.completionRate !== null ? Number(row.completionRate) : null,
    retentionRate: row.retentionRate !== null ? Number(row.retentionRate) : null,
    stabilityScore: row.stabilityScore !== null ? Number(row.stabilityScore) : null,
    longevityScore: row.longevityScore !== null ? Number(row.longevityScore) : null,
    competitivenessScore: row.competitivenessScore !== null ? Number(row.competitivenessScore) : null,
    totalSeasons: row.totalSeasons,
    lastComputedAt: row.lastComputedAt,
  }
}
