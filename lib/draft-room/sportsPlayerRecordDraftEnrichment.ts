/**
 * Merge SportsPlayerRecord (`sports_players`) rows into draft pool enrichment.
 *
 * Identity rules (avoid wrong player stats/images):
 * - Scoped strictly by **league sport** in the Prisma query (no cross-sport merges).
 * - Composite keys include **sport** via `buildStrictPlayerKey` / `buildLoosePlayerKey`.
 * - Prefer **record id** match when pool row carries the same `sports_players.id`.
 * - Then **strict** canonical name + normalized position + normalized team + sport.
 * - **Loose** name + position + sport only when exactly one DB row exists for that loose key in the batch,
 *   or skip ambiguous buckets (logged).
 * - **Loose lookup at runtime** only when pool team is FA / blank — never for rostered real abbreviations.
 */

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { inningsFromBaseballNotation } from '@/lib/scoring-runtime/mlbStatNormalization'
import {
  buildLoosePlayerKey,
  buildStrictPlayerKey,
  isFreeAgentTeam,
  resolvePlayerIdentityConfidence,
  type IdentityMatchType,
} from '@/lib/player-identity/playerIdentityResolution'
import type { PlayerMismatchCollector } from '@/lib/player-identity/playerMismatchLogger'

export type SportsPlayerRecordDraftAugment = {
  fantasyPointsPerGame: number | null
  nbaDraftStats: NbaDraftSeasonRates | null
  /** MLB / NHL season line for the pool's stat columns. */
  seasonStatLine: DraftSeasonStatLine | null
  adp: number | null
  headshotUrl: string | null
  /** When true, treat as rookie class for badge (conservative — stats/experience heuristics). */
  rookieHint: boolean | null
}

export type NbaDraftSeasonRates = {
  pointsPerGame: number | null
  reboundsPerGame: number | null
  minutesPerGame: number | null
}

/**
 * The cached season row can contain totals or explicit per-game rates. Never
 * label a total as a rate: divide only when games played is present.
 */
export function extractNbaDraftSeasonRates(blob: unknown): NbaDraftSeasonRates | null {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null
  const root = blob as Record<string, unknown>
  const nested = root.regular_season ?? root.currentSeason ?? root.season_stats ?? root.season
  const stats = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : root
  const number = (keys: string[]): number | null => {
    const normalized = new Map(Object.entries(stats).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]))
    for (const key of keys) {
      const raw = stats[key] ?? normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''))
      if (raw == null || raw === '') continue
      const value = Number(raw)
      if (Number.isFinite(value) && value >= 0) return value
    }
    return null
  }
  const games = number(['games_played', 'gamesPlayed', 'games', 'gp', 'Games Played'])
  const rate = (direct: string[], total: string[], max: number): number | null => {
    const explicit = number(direct)
    const candidate = explicit ?? (games != null && games > 0 ? (number(total) ?? NaN) / games : null)
    return candidate != null && Number.isFinite(candidate) && candidate <= max
      ? Math.round(candidate * 10) / 10
      : null
  }
  const result = {
    pointsPerGame: rate(['points_per_game', 'pointsPerGame', 'ppg'], ['points', 'pts'], 100),
    reboundsPerGame: rate(['rebounds_per_game', 'reboundsPerGame', 'rpg'], ['total_rebounds', 'rebounds', 'reb', 'Total Rebounds'], 40),
    minutesPerGame: rate(['minutes_per_game', 'minutesPerGame', 'mpg', 'average_minutes'], ['minutes', 'minutes_played', 'Minutes Played'], 60),
  }
  return Object.values(result).some((value) => value != null) ? result : null
}

/**
 * MLB / NHL season line for the pool's stat columns, keyed on the aliases in
 * `draftSportStatColumns.ts` (homeRuns, era, goals, savePercentage, …).
 *
 * The stored row is Rolling Insights `regular_season`, written flat by
 * `flattenRiSeasonStats`: NHL keys are bare (`goals`, `shots_on_goal`) and MLB keys are
 * GROUPED (`batting.HR`, `pitching.K`). The groups must stay apart — `H`, `R`, `HR`, `BB`
 * mean "recorded" under batting and "allowed" under pitching (see
 * `lib/af-projections/categoryScoring.ts`). A nested `{batting:{…}}` object is read the same way.
 *
 * Rates are derived only from the components they need (AVG = H/AB, WHIP = (BB+H)/IP,
 * SV% = saves/shots against); a missing component leaves the rate null rather than guessed.
 * OBP is explicit-only: the season row carries no sacrifice flies, so a derived OBP would be wrong.
 */
export type DraftSeasonStatLine = Partial<Record<
  | 'homeRuns' | 'rbi' | 'runs' | 'stolenBases' | 'battingAverage' | 'onBasePercentage'
  | 'wins' | 'strikeouts' | 'saves' | 'era' | 'whip'
  | 'goals' | 'assists' | 'shots_on_goal' | 'blocks' | 'shutouts'
  | 'goalsAgainstAverage' | 'savePercentage',
  number
>>

function seasonStatRoot(blob: unknown): Record<string, unknown> | null {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null
  const root = blob as Record<string, unknown>
  const nested = root.regular_season ?? root.currentSeason ?? root.season_stats ?? root.season
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : root
}

function finiteStat(raw: unknown): number | null {
  if (raw == null || raw === '' || typeof raw === 'boolean') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** `batting.HR` (flattened) or `batting: { HR }` (nested), never the bare key. */
function groupedStat(stats: Record<string, unknown>, group: 'batting' | 'pitching', key: string): number | null {
  const flat = finiteStat(stats[`${group}.${key}`])
  if (flat != null) return flat
  const nested = stats[group]
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? finiteStat((nested as Record<string, unknown>)[key])
    : null
}

/** "58:05" or a bare number of minutes. */
function minutesFromTimeOnIce(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.includes(':')) {
    const [m, s] = raw.split(':').map(Number)
    return Number.isFinite(m) && Number.isFinite(s) ? m! + s! / 60 : null
  }
  return finiteStat(raw)
}

const round = (value: number, places: number) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}

function compactLine(line: DraftSeasonStatLine): DraftSeasonStatLine | null {
  const out: DraftSeasonStatLine = {}
  for (const [key, value] of Object.entries(line) as Array<[keyof DraftSeasonStatLine, number | null | undefined]>) {
    if (value != null && Number.isFinite(value) && value >= 0) out[key] = value
  }
  return Object.keys(out).length ? out : null
}

export function extractMlbDraftSeasonStats(blob: unknown): DraftSeasonStatLine | null {
  const stats = seasonStatRoot(blob)
  if (!stats) return null
  const bat = (key: string) => groupedStat(stats, 'batting', key)
  const pit = (key: string) => groupedStat(stats, 'pitching', key)

  const ab = bat('AB')
  const hits = bat('H')
  const ipRaw = pit('IP')
  const ip = ipRaw != null ? inningsFromBaseballNotation(ipRaw) : null
  const er = pit('ER')
  const walksAllowed = pit('BB')
  const hitsAllowed = pit('H')
  const explicitAvg = bat('AVG')
  const explicitObp = bat('OBP')
  const explicitEra = pit('ERA')
  const explicitWhip = pit('WHIP')

  return compactLine({
    homeRuns: bat('HR') ?? undefined,
    rbi: bat('RBI') ?? undefined,
    runs: bat('R') ?? undefined,
    stolenBases: bat('SB') ?? undefined,
    battingAverage:
      explicitAvg != null && explicitAvg <= 1 ? explicitAvg
        : ab != null && ab > 0 && hits != null ? round(hits / ab, 3) : undefined,
    onBasePercentage: explicitObp != null && explicitObp <= 1 ? explicitObp : undefined,
    wins: pit('W') ?? undefined,
    strikeouts: pit('K') ?? undefined,
    saves: pit('S') ?? undefined,
    era: explicitEra ?? (ip != null && ip > 0 && er != null ? round((er * 9) / ip, 2) : undefined),
    whip:
      explicitWhip ??
      (ip != null && ip > 0 && walksAllowed != null && hitsAllowed != null
        ? round((walksAllowed + hitsAllowed) / ip, 2)
        : undefined),
  })
}

export function extractNhlDraftSeasonStats(blob: unknown): DraftSeasonStatLine | null {
  const stats = seasonStatRoot(blob)
  if (!stats) return null
  const n = (key: string) => finiteStat(stats[key])
  const saves = n('saves')
  const shotsAgainst = n('shots_against')
  const goalsAllowed = n('goals_allowed')
  const minutes = minutesFromTimeOnIce(stats.time_on_ice)
  // Only goalies carry these; a skater's time on ice must not produce a GAA.
  const isGoalieLine = saves != null || shotsAgainst != null || goalsAllowed != null

  return compactLine({
    goals: n('goals') ?? undefined,
    assists: n('assists') ?? undefined,
    shots_on_goal: n('shots_on_goal') ?? undefined,
    blocks: n('blocks') ?? undefined,
    saves: saves ?? undefined,
    wins: n('win') ?? n('wins') ?? undefined,
    shutouts: n('shutouts') ?? undefined,
    goalsAgainstAverage:
      n('goals_against_average') ??
      (isGoalieLine && goalsAllowed != null && minutes != null && minutes > 0
        ? round((goalsAllowed * 60) / minutes, 2)
        : undefined),
    savePercentage:
      n('save_percentage') ??
      (saves != null && shotsAgainst != null && shotsAgainst > 0 ? round(saves / shotsAgainst, 3) : undefined),
  })
}

function extractFppgFromJson(blob: unknown, allowGenericPointsPerGame = true): number | null {
  if (blob == null) return null
  if (typeof blob === 'number' && Number.isFinite(blob) && blob > 0) return blob
  if (typeof blob !== 'object') return null
  const o = blob as Record<string, unknown>
  const candidates: unknown[] = [
    o.fantasyPointsPerGame,
    o.fppg,
    ...(allowGenericPointsPerGame ? [o.pointsPerGame] : []),
    o.projectedPpg,
    (o.season as Record<string, unknown> | undefined)?.fantasyPointsPerGame,
    (o.season as Record<string, unknown> | undefined)?.fppg,
    (o.currentSeason as Record<string, unknown> | undefined)?.fantasyPointsPerGame,
  ]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0 && n < 500) return n
  }
  return null
}

/*
 * 🛑 A ZERO-GAMES ROW IS NOT A ROOKIE IN MLB, NBA OR NHL (docs/DYNASTY_PROSPECT_DATA_PLAN.md §2.5).
 * `stats` is the player's LATEST stored season row, so `gamesPlayed === 0` caught an injured veteran
 * and never a real first-year player, who has no row at all. It also read `gamesPlayed`/`games`/`g`
 * and never `games_played`, the key Rolling Insights season rows carry. Worse when it did fire: one
 * flagged row put the pool into "applied" mode (`rookieFilterState.ts`), which
 * narrowed a rookies-only board to the flagged veterans and refused every real rookie at pick time.
 * Those three sports now get a verdict from every stored prior season
 * (`seasonStatsRookieStatus.ts`) instead. Other non-NFL sports keep the old hint unchanged: making
 * it read `games_played` there would only flag more injured players.
 */
const NO_ZERO_GAMES_HINT_SPORTS: ReadonlySet<string> = new Set(['MLB', 'NBA', 'NHL'])

export function extractRookieHint(
  stats: unknown,
  projections: unknown,
  sport: LeagueSport,
): boolean | null {
  const sportKey = String(sport).toUpperCase()
  const isNfl = sportKey === 'NFL'
  if (stats && typeof stats === 'object') {
    const s = stats as Record<string, unknown>
    if (s.rookie === true) return true
    if (s.isRookie === true) return true
    if (!isNfl && !NO_ZERO_GAMES_HINT_SPORTS.has(sportKey)) {
      const gp = Number(s.gamesPlayed ?? s.games ?? s.g)
      if (Number.isFinite(gp) && gp === 0) return true
    }
    const exp = Number(s.experience ?? s.yearsExp ?? s.years_experience)
    if (Number.isFinite(exp) && exp === 0) return true
  }
  if (projections && typeof projections === 'object') {
    const p = projections as Record<string, unknown>
    if (p.rookie === true || p.isRookie === true) return true
  }
  return null
}

function augmentFromRecord(
  row: {
    stats: unknown
    projections: unknown
    adp: number | null
    headshotUrl: string | null
    headshotUrlLg: string | null
  },
  sport: LeagueSport,
): SportsPlayerRecordDraftAugment {
  const fppg =
    extractFppgFromJson(row.projections, String(sport).toUpperCase() !== 'NBA') ??
    extractFppgFromJson(row.stats, String(sport).toUpperCase() !== 'NBA') ??
    null
  const adp = row.adp != null && Number.isFinite(Number(row.adp)) ? Number(row.adp) : null
  const rawHs = row.headshotUrlLg ?? row.headshotUrl ?? null
  const headshotUrl =
    rawHs && classifyAvatarSource(rawHs) === 'headshot' ? rawHs : null
  const rookieHint = extractRookieHint(row.stats, row.projections, sport)
  return {
    fantasyPointsPerGame: fppg,
    nbaDraftStats: String(sport).toUpperCase() === 'NBA' ? extractNbaDraftSeasonRates(row.stats) : null,
    seasonStatLine:
      String(sport).toUpperCase() === 'MLB'
        ? extractMlbDraftSeasonStats(row.stats)
        : String(sport).toUpperCase() === 'NHL'
          ? extractNhlDraftSeasonStats(row.stats)
          : null,
    adp,
    headshotUrl,
    rookieHint,
  }
}

export type SportsPlayerRecordDraftMaps = {
  /** `sports_players.id` → augment (strongest match). */
  byRecordId: Map<string, SportsPlayerRecordDraftAugment>
  strict: Map<string, SportsPlayerRecordDraftAugment>
  loose: Map<string, SportsPlayerRecordDraftAugment>
}

export type SprLookupMeta = {
  matchType: IdentityMatchType
  confidence: number
  reason: string
  idLookupAttempted: boolean
  idLookupHit: boolean
  strictHitAfterIdMiss: boolean
}

export type SprLookupResult = {
  augment: SportsPlayerRecordDraftAugment | null
  meta: SprLookupMeta
}

/**
 * Batch-load `sports_players` projection cache rows for draft pool name list (single sport per call).
 */
export async function loadSportsPlayerRecordMapsForDraftPool(
  leagueId: string | undefined,
  sport: LeagueSport,
  rows: Array<{ name: string; position: string; team?: string | null }>,
  /** Optional: accumulates identity mismatches in memory. The caller owns flushing it. */
  mismatchCollector?: PlayerMismatchCollector,
): Promise<SportsPlayerRecordDraftMaps> {
  const byRecordId = new Map<string, SportsPlayerRecordDraftAugment>()
  const strict = new Map<string, SportsPlayerRecordDraftAugment>()
  const loose = new Map<string, SportsPlayerRecordDraftAugment>()
  const sportStr = String(sport).toUpperCase()
  const uniqueNames = [...new Set(rows.map((r) => String(r.name ?? '').trim()).filter(Boolean))]
  if (uniqueNames.length === 0) return { byRecordId, strict, loose }

  const nameTake = Math.min(uniqueNames.length, 2800)
  const namesIn = uniqueNames.slice(0, nameTake)

  let records: Array<{
    id: string
    name: string
    position: string
    team: string
    stats: unknown
    projections: unknown
    adp: number | null
    headshotUrl: string | null
    headshotUrlLg: string | null
  }> = []
  try {
    records = await prisma.sportsPlayerRecord.findMany({
      where: { sport: sportStr, name: { in: namesIn } },
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        stats: true,
        projections: true,
        adp: true,
        headshotUrl: true,
        headshotUrlLg: true,
      },
      take: 6000,
    })
  } catch {
    return { byRecordId, strict, loose }
  }

  const looseGroups = new Map<string, Map<string, SportsPlayerRecordDraftAugment>>()

  for (const rec of records) {
    const aug = augmentFromRecord(rec, sport)
    const rid = String(rec.id ?? '').trim()
    if (rid && !byRecordId.has(rid)) byRecordId.set(rid, aug)

    const strictKey = buildStrictPlayerKey({
      name: rec.name,
      position: rec.position,
      team: rec.team,
      sport: sportStr,
    })
    if (!strict.has(strictKey)) strict.set(strictKey, aug)

    const looseKey = buildLoosePlayerKey({
      name: rec.name,
      position: rec.position,
      sport: sportStr,
    })
    const bucket = looseGroups.get(looseKey) ?? new Map<string, SportsPlayerRecordDraftAugment>()
    bucket.set(strictKey, aug)
    looseGroups.set(looseKey, bucket)
  }

  for (const [looseKey, bucket] of looseGroups) {
    if (bucket.size !== 1) {
      if (bucket.size > 1) {
        mismatchCollector?.record({
          leagueId: leagueId ?? null,
          sport: sportStr,
          reason: 'AMBIGUOUS_LOOSE_MATCH_SKIPPED',
          playerName: null,
          position: null,
          team: null,
          attemptedMatchType: 'loose',
          confidence: null,
          details: {
            looseKey,
            distinctStrictKeys: [...bucket.keys()],
            count: bucket.size,
          },
        })
      }
      continue
    }
    const onlyAug = [...bucket.values()][0]!
    loose.set(looseKey, onlyAug)
  }

  return { byRecordId, strict, loose }
}

export function lookupSportsPlayerRecordAugmentDetailed(
  maps: SportsPlayerRecordDraftMaps,
  sport: LeagueSport,
  name: string,
  position: string,
  team: string | null | undefined,
  poolExternalOrRecordId?: string | null,
): SprLookupResult {
  const sportU = String(sport).toUpperCase()
  const pid = String(poolExternalOrRecordId ?? '').trim()
  const idLookupAttempted = Boolean(pid)
  let idLookupHit = false
  let strictHitAfterIdMiss = false

  if (pid && maps.byRecordId.has(pid)) {
    idLookupHit = true
    return {
      augment: maps.byRecordId.get(pid)!,
      meta: {
        matchType: 'id',
        confidence: resolvePlayerIdentityConfidence('id'),
        reason: 'sports_players.id matched pool external / record id',
        idLookupAttempted,
        idLookupHit,
        strictHitAfterIdMiss: false,
      },
    }
  }

  const strictKey = buildStrictPlayerKey({ name, position, team, sport: sportU })
  const strictHit = maps.strict.get(strictKey)
  if (strictHit) {
    strictHitAfterIdMiss = idLookupAttempted && !idLookupHit
    return {
      augment: strictHit,
      meta: {
        matchType: 'strict',
        confidence: resolvePlayerIdentityConfidence('strict'),
        reason: 'strict identity key matched (name + position + team + sport)',
        idLookupAttempted,
        idLookupHit,
        strictHitAfterIdMiss,
      },
    }
  }

  const poolTeamMissingOrFa = !team?.trim() || isFreeAgentTeam(team, sport)
  if (poolTeamMissingOrFa) {
    const looseKey = buildLoosePlayerKey({ name, position, sport: sportU })
    const looseHit = maps.loose.get(looseKey)
    if (looseHit) {
      return {
        augment: looseHit,
        meta: {
          matchType: 'loose',
          confidence: resolvePlayerIdentityConfidence('loose'),
          reason: 'unique loose key in batch; pool team FA or blank',
          idLookupAttempted,
          idLookupHit,
          strictHitAfterIdMiss: false,
        },
      }
    }
  }

  return {
    augment: null,
    meta: {
      matchType: 'none',
      confidence: 0,
      reason: 'no sports_players row matched identity rules',
      idLookupAttempted,
      idLookupHit,
      strictHitAfterIdMiss: false,
    },
  }
}

/**
 * @param poolExternalOrRecordId — `SportsPlayerRecord.id` / pool `player_id` when aligned with sports_players cache.
 */
export function lookupSportsPlayerRecordAugment(
  maps: SportsPlayerRecordDraftMaps,
  sport: LeagueSport,
  name: string,
  position: string,
  team: string | null | undefined,
  poolExternalOrRecordId?: string | null,
): SportsPlayerRecordDraftAugment | null {
  return lookupSportsPlayerRecordAugmentDetailed(
    maps,
    sport,
    name,
    position,
    team,
    poolExternalOrRecordId,
  ).augment
}
