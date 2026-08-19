/**
 * Resolves player pool by sport so leagues only load players for their sport.
 * Uses SportsPlayer and PlayerIdentityMap; draft room and waiver wire filter by league sport.
 *
 * Soccer: sport_type = SOCCER only. Positions: GKP/GK, DEF, MID, FWD (use options.position to filter). Soccer leagues load only soccer teams and players.
 * NFL IDP: same pool as NFL (sport_type = NFL). Include defensive players (DE, DT, LB, CB, S) in ingestion so they appear; use options.position (e.g. DE, DT, LB, CB, S) for position filter. Eligibility by slot uses PositionEligibilityResolver with formatType IDP.
 */
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SportType, PoolPlayerRecord } from './types'
import { leagueSportToSportType } from '@/lib/multi-sport/SportConfigResolver'
import { getTeamIdByAbbreviationMap } from './SportTeamMetadataRegistry'
import { formatNflTeamDefenseName } from '@/lib/redraft/teamDefenseIdentity'

const SPORT_STR: Record<LeagueSport, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'NCAAF',
  NCAAB: 'NCAAB',
  SOCCER: 'SOCCER',
}

const NFL_IDP_GROUP_MAP: Record<string, string[]> = {
  OFFENSE: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
  DL: ['DE', 'DT'],
  DB: ['CB', 'S'],
  IDP_FLEX: ['DE', 'DT', 'LB', 'CB', 'S'],
}

const NFL_IDP_POSITION_ALIASES: Record<string, string> = {
  EDGE: 'DE',
  OLB: 'LB',
  ILB: 'LB',
  MLB: 'LB',
  SS: 'S',
  FS: 'S',
  NT: 'DT',
}

const NFL_IDP_QUERY_EXPANSION: Record<string, string[]> = {
  DE: ['DE', 'EDGE'],
  DT: ['DT', 'NT'],
  LB: ['LB', 'OLB', 'ILB', 'MLB'],
  S: ['S', 'SS', 'FS'],
  CB: ['CB'],
}

function normalizeNflIdpPosition(position: string): string {
  return NFL_IDP_POSITION_ALIASES[position] ?? position
}

function normalizeNflGroupFilter(position: string): string {
  const compact = position.replace(/[\s-]+/g, '_').toUpperCase()
  if (compact === 'IDPFLEX') return 'IDP_FLEX'
  return compact
}

function expandNflIdpPositions(positions: string[]): string[] {
  const expanded = new Set<string>()
  for (const position of positions) {
    const canonical = normalizeNflIdpPosition(position)
    expanded.add(canonical)
    const aliases = NFL_IDP_QUERY_EXPANSION[canonical]
    if (aliases && aliases.length > 0) {
      for (const alias of aliases) expanded.add(alias)
    }
  }
  return [...expanded]
}

function normalizePoolPosition(sport: string, position: string | null): string {
  const raw = String(position ?? '').trim().toUpperCase()
  if (!raw) return ''
  if (sport === 'SOCCER' && raw === 'GK') return 'GKP'
  if (sport === 'NFL') return normalizeNflIdpPosition(raw)
  return raw
}

function isHttpImage(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(url ?? '').trim())
}

function sourceRank(source: string | null | undefined): number {
  const s = String(source ?? '').trim().toLowerCase()
  // CFBD is the authoritative current-season source for NCAAF rosters, so a
  // fresh CFBD row should win dedup over a stale rolling_insights duplicate.
  if (s === 'cfbd') return 7
  if (s === 'thesportsdb') return 6
  if (s === 'clearsports') return 5
  if (s === 'api_sports' || s === 'api-sports') return 4
  if (s === 'rolling_insights') return 3
  if (s === 'sleeper') return 2
  if (s === 'backfill') return 1
  return 0
}

function sportsPlayerQuality(row: {
  imageUrl?: string | null
  sleeperId?: string | null
  source?: string | null
}): number {
  let score = 0
  if (isHttpImage(row.imageUrl)) score += 100
  if (String(row.sleeperId ?? '').trim()) score += 50
  score += sourceRank(row.source) * 10
  return score
}

/**
 * Real, provider-agnostic fantasy-relevance signal for pool selection priority
 * (Phase 27, refined Phase 28). Returns a Map of `playerKey` (already
 * `name|position`, lowercased, matching this file's own key format) to that
 * player's BEST (lowest/most-relevant) real `averageOverallPick` across all
 * league/scoring contexts -- deliberately broad, not scoped to one specific
 * league's exact settings, since the goal here is only "how fantasy-relevant
 * is this player," not "what is their ADP in this exact format."
 * `averageOverallPick` is a non-nullable schema field (verified this phase),
 * so every real ADP row always carries a usable rank. A player with multiple
 * snapshot rows (one per tracked context) is deliberately represented by
 * their single best real rank, not an average-of-averages -- a simple,
 * deterministic, real-data-only choice. Never throws: a query failure
 * degrades to an empty map, which makes the caller's sort a no-op (pure
 * alphabetical, matching pre-Phase-27 behavior) rather than a hard error.
 */
async function loadAdpRankByPlayerKey(sport: string): Promise<Map<string, number>> {
  try {
    const rows = await prisma.allFantasyAdpSnapshot.findMany({
      where: { sport },
      select: { playerKey: true, averageOverallPick: true },
    })
    const bestRankByKey = new Map<string, number>()
    for (const row of rows) {
      const current = bestRankByKey.get(row.playerKey)
      if (current === undefined || row.averageOverallPick < current) {
        bestRankByKey.set(row.playerKey, row.averageOverallPick)
      }
    }
    return bestRankByKey
  } catch {
    return new Map()
  }
}

function normalizePositionFilter(sport: string, position?: string): string[] | null {
  const raw = position?.trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (sport === 'SOCCER' && (upper === 'GK' || upper === 'GKP')) return ['GK', 'GKP']
  if (sport === 'NFL') {
    const groupKey = normalizeNflGroupFilter(upper)
    if (NFL_IDP_GROUP_MAP[groupKey]) return NFL_IDP_GROUP_MAP[groupKey]
  }
  if (sport === 'NFL') return [normalizeNflIdpPosition(upper)]
  return [upper]
}

/**
 * Get player pool for a sport from SportsPlayer table (sport-scoped).
 */
export async function getPlayerPoolForSport(
  sportType: SportType | LeagueSport | string,
  options?: { limit?: number; teamId?: string; position?: string }
): Promise<PoolPlayerRecord[]> {
  const sport = normalizeSport(sportType)
  const teamIdByAbbrev = getTeamIdByAbbreviationMap(sport)
  const normalizedPositions = normalizePositionFilter(sport, options?.position)
  const dbPositionFilters =
    sport === 'NFL' && normalizedPositions
      ? expandNflIdpPositions(normalizedPositions)
      : normalizedPositions
  const where: {
    sport: string
    team?: string
    position?: string
    OR?: Array<{ position: string }>
  } = { sport }
  if (options?.teamId?.trim()) where.team = options.teamId.trim()
  if (dbPositionFilters && dbPositionFilters.length === 1) {
    where.position = dbPositionFilters[0]
  } else if (dbPositionFilters && dbPositionFilters.length > 1) {
    where.OR = dbPositionFilters.map((p) => ({ position: p }))
  }

  const requestedTake = options?.limit ?? 2000

  // Phase 26 fix: do NOT cap raw rows at requestedTake before dedup. SportsPlayer
  // has heavy cross-source duplication (measured in production: 17,257 raw NFL
  // rows for only 12,004 distinct names, across up to 7 known import sources --
  // see sourceRank() below). An alphabetically-ordered `take` applied BEFORE
  // dedup can be entirely consumed by duplicate rows for names sharing an early
  // alphabetical range, silently excluding the majority of the real roster
  // (measured: a take:800 query never advanced past "Anthony Jones"). Fetch all
  // matching rows instead, dedupe fully, then apply the requested limit to the
  // deduplicated, distinct-player result below. All real sport row counts are
  // bounded (largest measured: NCAAF at ~45,000 rows) -- a safe volume for a
  // single query.
  const rows = await prisma.sportsPlayer.findMany({
    where,
    orderBy: { name: 'asc' },
  })

  // De-dupe by (name, position, team), preferring rows that have real image URLs
  // and explicit sleeper IDs. Some imports write duplicate players across sources,
  // and a low-quality duplicate can otherwise shadow a better row.
  const bestByKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const key = `${String(row.name ?? '').trim().toLowerCase()}|${String(row.position ?? '').trim().toUpperCase()}|${String(row.team ?? '').trim().toUpperCase()}`
    const current = bestByKey.get(key)
    if (!current || sportsPlayerQuality(row) > sportsPlayerQuality(current)) {
      bestByKey.set(key, row)
    }
  }

  // Phase 27 fix: alphabetical order alone is not a fantasy-relevance signal.
  // Measured in production: with 12,004 distinct NFL names and a limit of 800,
  // the pool never reached past "Arjen Colquhoun" -- real, ADP-tracked stars
  // (Saquon Barkley, Justin Jefferson, etc.) never appeared, regardless of
  // dedup correctness (Phase 26 fixed dedup; this fixes selection). Prioritize
  // players with a real AllFantasy ADP entry (AllFantasy's own aggregated,
  // provider-agnostic signal -- not tied to Sleeper/ESPN/any single provider)
  // ahead of players without one.
  //
  // Phase 28 refinement: Phase 27's alphabetical tiebreak WITHIN the ADP tier
  // itself could still exclude a real top-ADP late-alphabet star at a
  // constrained limit (measured: Saquon Barkley excluded at limit:250, a real
  // Waiver-shaped call, while lower-relevance early-alphabet ADP players filled
  // the budget first). Now sorts the ADP tier by real ADP rank (best/lowest
  // averageOverallPick first) instead of alphabetically. Tier 2 (no ADP entry)
  // still falls back to alphabetical order -- both as the tiebreak within Tier 1
  // (ties on identical rank preserve insertion/alphabetical order, since sort
  // is stable) and as the complete fallback when a sport has no ADP data at all.
  const adpRankByKey = await loadAdpRankByPlayerKey(sport)
  const dedupedRows = [...bestByKey.values()]
    .sort((a, b) => {
      const aRank = adpRankByKey.get(`${String(a.name ?? '').trim().toLowerCase()}|${String(a.position ?? '').trim().toLowerCase()}`)
      const bRank = adpRankByKey.get(`${String(b.name ?? '').trim().toLowerCase()}|${String(b.position ?? '').trim().toLowerCase()}`)
      if (aRank === undefined && bRank === undefined) return 0
      if (aRank === undefined) return 1
      if (bRank === undefined) return -1
      return aRank - bRank
    })
    .slice(0, requestedTake)

  const primary = dedupedRows.map((r) => ({
    team_abbreviation: r.team ?? null,
    player_id: r.id,
    sport_type: sport as SportType,
    league_variant: null,
    team_id:
      r.teamId ??
      (r.team ? teamIdByAbbrev.get(r.team.toUpperCase()) ?? null : null),
    team: r.team ?? null,
    full_name: r.name,
    position: normalizePoolPosition(sport, r.position),
    status: r.status ?? null,
    injury_status: deriveInjuryStatus(r.status),
    external_source_id: r.sleeperId ?? r.externalId ?? null,
    age: r.age ?? null,
    experience: null,
    secondary_positions: [],
    metadata: {},
    image_url: (r as { imageUrl?: string | null }).imageUrl ?? null,
  }))

  const IDP_INDIVIDUAL_POSITIONS = new Set(['DE', 'DT', 'LB', 'CB', 'S'])
  const isIdpOnlyFilter =
    normalizedPositions !== null &&
    normalizedPositions.every((p) => IDP_INDIVIDUAL_POSITIONS.has(p) || p === 'IDP_FLEX')

  if (sport === 'NFL' && !isIdpOnlyFilter) {
    const existingDefTeams = new Set(
      primary
        .filter((p) => ['DEF', 'DST'].includes(String(p.position ?? '').trim().toUpperCase()))
        .map((p) => String(p.team_abbreviation ?? '').trim().toUpperCase())
        .filter(Boolean),
    )
    for (const [abbr, teamId] of teamIdByAbbrev.entries()) {
      if (existingDefTeams.has(abbr)) continue
      primary.push({
        team_abbreviation: abbr,
        player_id: `nfl:def:${abbr}`,
        sport_type: sport as SportType,
        league_variant: null,
        team_id: teamId ?? null,
        team: abbr,
        full_name: formatNflTeamDefenseName(abbr),
        position: 'DEF',
        status: null,
        injury_status: null,
        external_source_id: `nfl:def:${abbr}`,
        age: null,
        experience: null,
        secondary_positions: [],
        metadata: { source: 'synthetic_team_defense' },
        image_url: null,
      })
    }
  }

  const limit = requestedTake
  const canFallbackIdpFromIdentity =
    sport === 'NFL' &&
    (normalizedPositions == null ||
      normalizedPositions.some((p) => IDP_INDIVIDUAL_POSITIONS.has(p) || p === 'IDP_FLEX'))

  if (!canFallbackIdpFromIdentity || primary.length >= limit) {
    return primary
  }

  const remaining = Math.max(0, limit - primary.length)
  if (remaining === 0) return primary

  const identityWhere: {
    sport: string
    position?: { in: string[] }
    currentTeam?: string
  } = { sport }
  if (normalizedPositions && normalizedPositions.length > 0) {
    identityWhere.position = {
      in: sport === 'NFL' ? expandNflIdpPositions(normalizedPositions) : normalizedPositions,
    }
  } else {
    identityWhere.position = { in: expandNflIdpPositions(['DE', 'DT', 'LB', 'CB', 'S']) }
  }
  if (options?.teamId?.trim()) identityWhere.currentTeam = options.teamId.trim()

  const identityRows = await prisma.playerIdentityMap.findMany({
    where: identityWhere,
    take: remaining,
    orderBy: { canonicalName: 'asc' },
  })

  const existingExternalIds = new Set(primary.map((p) => String(p.external_source_id ?? '')))
  const existingKeys = new Set(primary.map((p) => `${p.full_name.toLowerCase()}::${p.position.toUpperCase()}`))
  for (const row of identityRows) {
    const externalId = row.sleeperId ?? row.apiSportsId ?? row.fantasyCalcId ?? row.id
    const position = normalizePoolPosition(sport, row.position ?? null)
    const fullName = row.canonicalName
    if (!fullName || !position) continue
    if (existingExternalIds.has(String(externalId))) continue
    const dedupeKey = `${fullName.toLowerCase()}::${position}`
    if (existingKeys.has(dedupeKey)) continue

    const abbr = row.currentTeam?.toUpperCase() ?? null
    primary.push({
      team_abbreviation: abbr,
      player_id: row.id,
      sport_type: sport as SportType,
      league_variant: null,
      team_id: abbr ? teamIdByAbbrev.get(abbr) ?? null : null,
      team: abbr,
      full_name: fullName,
      position,
      status: row.status ?? null,
      injury_status: deriveInjuryStatus(row.status ?? null),
      external_source_id: String(externalId),
      age: null,
      experience: null,
      secondary_positions: [],
      image_url: null,
      metadata: { source: 'identity_fallback' },
    })
    existingExternalIds.add(String(externalId))
    existingKeys.add(dedupeKey)
    if (primary.length >= limit) break
  }

  return primary
}

/**
 * Get player pool for a league (sport = league.sport). Use for draft room and waiver pool.
 * For NFL IDP leagues, pass same leagueSport (NFL); pool includes all NFL players when no position filter; use options.position to filter by DE, DT, LB, CB, S when needed.
 */
export async function getPlayerPoolForLeague(
  leagueId: string,
  leagueSport: LeagueSport,
  options?: { limit?: number; teamId?: string; position?: string }
): Promise<PoolPlayerRecord[]> {
  const sportType = leagueSportToSportType(leagueSport)
  const sportStr = SPORT_STR[leagueSport] ?? sportType
  return getPlayerPoolForSport(sportStr, options)
}

/**
 * Check if a player belongs to a given sport (by SportsPlayer or PlayerIdentityMap).
 */
export async function isPlayerInSportPool(
  playerIdOrExternalId: string,
  sportType: SportType | LeagueSport | string
): Promise<boolean> {
  const sport = normalizeSport(sportType)
  const bySports = await prisma.sportsPlayer.findFirst({
    where: {
      sport,
      OR: [{ id: playerIdOrExternalId }, { externalId: playerIdOrExternalId }, { sleeperId: playerIdOrExternalId }],
    },
  })
  if (bySports) return true
  const byIdentity = await prisma.playerIdentityMap.findFirst({
    where: {
      sport,
      OR: [
        { sleeperId: playerIdOrExternalId },
        { fantasyCalcId: playerIdOrExternalId },
        { apiSportsId: playerIdOrExternalId },
      ],
    },
  })
  return !!byIdentity
}

/** Injury-like status values; when status matches, use it as injury_status. */
const INJURY_STATUS_PATTERNS = ['OUT', 'IR', 'DOUBTFUL', 'QUESTIONABLE', 'PUP', 'SUSPENDED', 'DNR', 'DNP', 'INJURED']

function deriveInjuryStatus(status: string | null): string | null {
  if (status == null || !status.trim()) return null
  const upper = status.toUpperCase().trim()
  if (INJURY_STATUS_PATTERNS.some((p) => upper === p || upper.startsWith(p + ' ') || upper.includes(' ' + p))) return status
  return null
}

function normalizeSport(s: SportType | LeagueSport | string): string {
  if (typeof s !== 'string') return (s as string).toString()
  return s.toUpperCase()
}
