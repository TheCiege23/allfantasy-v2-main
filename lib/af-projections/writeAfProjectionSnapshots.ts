/**
 * AF Projections — write computed projections into `AFProjectionSnapshot`.
 *
 * This is the only impure module in `lib/af-projections/`. All arithmetic and every honesty
 * rule lives in the pure core; this file resolves ids, loads inputs, and upserts.
 *
 * SCHEMA CONSTRAINT, read before extending. `AFProjectionSnapshot` has NO scoringPresetId and
 * its unique key is `playerId|season|week|eventId`, so it physically holds ONE scoring format
 * per player per week. Writing a second format would collide rather than coexist. So the row
 * stores a canonical PPR (+ balanced IDP) projection, and `adjustmentFactors` carries the
 * per-game component rates, basis, and IDP breakdown so a league can rescore from components
 * without re-running the engine. Adding true multi-format storage needs a migration, not a
 * second write.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { buildAfProjection, type WeeklyRawStats } from './buildAfProjection'
import { extractSeasonAggregate, perGameRates, toWeeklyObservation } from './core'
import type { ProjectionOutcome, ScoringFormat, WeeklyObservation } from './types'

export interface WriteSnapshotsResult {
  sport: string
  /** Season the projections apply TO. */
  targetSeason: number
  /** Season the production data came FROM. */
  sourceSeason: number
  scoringFormat: ScoringFormat
  idpPreset: string
  statLinesRead: number
  written: number
  refused: number
  refusalsByReason: Record<string, number>
  basisCounts: Record<string, number>
  confidenceCounts: Record<string, number>
  /** Projections carrying the measured (estimated) tackle split. */
  usedTackleSplitEstimate: number
  /** Projections whose baseline came from Sleeper's forward-looking week projection. */
  fromForwardProjection: number
  /** Players whose weekly logs were unreachable because no sleeperId is mapped. */
  withoutWeeklyData: number
  errors: string[]
}

export interface WriteSnapshotsOptions {
  sport?: string
  /** Season to read production from. Defaults to the newest season present. */
  sourceSeason?: number
  /** Season the projection applies to. Defaults to sourceSeason + 1. */
  targetSeason?: number
  scoringFormat?: ScoringFormat
  idpPreset?: string
  /** Week the projection applies to. Defaults to 1 (preseason baseline). */
  targetWeek?: number
  /** Compute and report without writing. */
  dryRun?: boolean
  now?: Date
}

/** Mirrors the schema's documented key: `${playerId}|${season}|${week ?? 'w'}|${eventId ?? 'none'}`. */
function snapshotKey(playerId: string, season: number, week: number | null, eventId: string | null): string {
  return `${playerId}|${season}|${week ?? 'w'}|${eventId ?? 'none'}`
}

export async function writeAfProjectionSnapshots(
  opts: WriteSnapshotsOptions = {},
): Promise<WriteSnapshotsResult> {
  const sport = (opts.sport ?? 'NFL').toUpperCase()
  const scoringFormat = opts.scoringFormat ?? 'ppr'
  const idpPreset = opts.idpPreset ?? 'balanced'
  const now = opts.now ?? new Date()
  const errors: string[] = []

  // --- resolve the source season ------------------------------------------------------
  const newest = await prisma.fantasyStatLine.findFirst({
    where: { sport },
    orderBy: { season: 'desc' },
    select: { season: true },
  })
  const sourceSeason = opts.sourceSeason ?? (newest ? Number(newest.season) : NaN)
  if (!Number.isFinite(sourceSeason)) {
    throw new Error(`no fantasy_stat_lines found for sport=${sport}; run import-stat-lines first`)
  }
  const targetSeason = opts.targetSeason ?? sourceSeason + 1

  const statLines = await prisma.fantasyStatLine.findMany({
    where: { sport, season: String(sourceSeason) },
  })

  // --- identity bridge ----------------------------------------------------------------
  // fantasyStatLine is keyed by canonical uuid; playerGameStat by Sleeper id. Only ~53% of
  // NFL players carry both, so weekly data is legitimately unavailable for the rest.
  const identity = await prisma.playerIdentityMap.findMany({
    where: { sport },
    select: { id: true, sleeperId: true },
  })
  const sleeperByCanonical = new Map(
    identity.filter((r) => r.sleeperId).map((r) => [r.id, r.sleeperId as string]),
  )

  const games = await prisma.playerGameStat.findMany({
    where: { sportType: sport, season: sourceSeason },
    select: { playerId: true, weekOrRound: true, normalizedStatMap: true },
  })
  const obsBySleeper = new Map<string, WeeklyObservation[]>()
  const rawBySleeper = new Map<string, WeeklyRawStats[]>()
  for (const g of games) {
    const obs = toWeeklyObservation(g.weekOrRound, g.normalizedStatMap)
    if (obs) obsBySleeper.set(g.playerId, [...(obsBySleeper.get(g.playerId) ?? []), obs])
    const statMap = g.normalizedStatMap as Record<string, unknown> | null
    if (statMap && typeof statMap === 'object') {
      rawBySleeper.set(g.playerId, [
        ...(rawBySleeper.get(g.playerId) ?? []),
        { week: g.weekOrRound, statMap },
      ])
    }
  }

  // --- depth-chart role, indexed by player name --------------------------------------
  // Depth charts are RI-keyed and carry names, not canonical ids; name is the only bridge
  // available here. A miss costs confidence, never correctness.
  const depthRows = await prisma.depthChart.findMany({ where: { sport } })
  const slotByName = new Map<string, string>()
  for (const row of depthRows) {
    const players = Array.isArray(row.players) ? row.players : []
    for (const entry of players as Array<Record<string, unknown>>) {
      const name = typeof entry?.player === 'string' ? entry.player.trim().toLowerCase() : null
      if (name && !slotByName.has(name)) slotByName.set(name, String(row.position))
    }
  }

  // --- injury designations ------------------------------------------------------------
  const injuries = await prisma.sportsInjury.findMany({
    where: { sport },
    select: { playerName: true, status: true },
  })
  const injuryByName = new Map<string, string>()
  for (const inj of injuries) {
    const name = inj.playerName?.trim().toLowerCase()
    if (name && inj.status && !injuryByName.has(name)) injuryByName.set(name, inj.status)
  }

  const { getIdpPresetScoring } = await import('@/lib/idp/IDPScoringPresets')
  const idpRules = getIdpPresetScoring(idpPreset, sport)

  // --- Sleeper forward-looking projections for the target week ------------------------
  // Keyed by Sleeper player id, which the identity sync now supplies for 97.5% of NFL
  // players. Reuses the cached getWeekBoard (6h TTL) rather than re-fetching. A projection
  // FOR the week being played outranks anything inferred from completed games, so this is
  // the strongest input the engine has; failure is non-fatal and falls back to history.
  const targetWeek = opts.targetWeek ?? 1
  let weekBoard: Record<string, { stats: Record<string, number>; position: string | null }> | null = null
  try {
    const { getWeekBoard } = await import('@/lib/sports-data/sleeperMarketService')
    const board = await getWeekBoard(String(targetSeason), targetWeek)
    weekBoard = board?.players ?? null
    if (!board) errors.push(`Sleeper week board ${targetSeason}/${targetWeek} returned nothing.`)
  } catch (err) {
    errors.push(`Sleeper week board fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const result: WriteSnapshotsResult = {
    sport,
    targetSeason,
    sourceSeason,
    scoringFormat,
    idpPreset,
    statLinesRead: statLines.length,
    written: 0,
    refused: 0,
    refusalsByReason: {},
    basisCounts: {},
    confidenceCounts: {},
    usedTackleSplitEstimate: 0,
    fromForwardProjection: 0,
    withoutWeeklyData: 0,
    errors,
  }

  for (const line of statLines) {
    const stats = line.stats as Record<string, unknown> | null
    if (!stats) {
      bumpRefusal(result, 'no_stats_payload')
      continue
    }

    const aggregate = extractSeasonAggregate(stats)
    const playerName = aggregate?.playerName ?? null
    const sleeperIdForPos = sleeperByCanonical.get(line.playerId)
    // Prefer SLEEPER's position over RI's. RI's is demonstrably unreliable — it lists
    // Brian Thomas Jr. (a Jaguars WR) as DE and Corbin Bryant (a DT) as CB. A wrong
    // position pollutes every position-filtered surface and, before the IDP gate, decided
    // whether a player was scored on defensive components at all.
    const sleeperPosition = sleeperIdForPos ? weekBoard?.[sleeperIdForPos]?.position ?? null : null
    const position = sleeperPosition ?? aggregate?.position ?? null
    const nameKey = playerName?.toLowerCase() ?? ''

    const sleeperId = sleeperByCanonical.get(line.playerId)
    if (!sleeperId) result.withoutWeeklyData++

    const outcome: ProjectionOutcome = buildAfProjection({
      aggregate,
      weekly: sleeperId ? obsBySleeper.get(sleeperId) ?? [] : [],
      weeklyRaw: sleeperId ? rawBySleeper.get(sleeperId) ?? [] : [],
      sleeperProjection: sleeperId ? weekBoard?.[sleeperId]?.stats ?? null : null,
      position,
      depthSlot: slotByName.get(nameKey) ?? null,
      injuryStatus: injuryByName.get(nameKey) ?? null,
      scoringFormat,
      basisIsPriorSeason: sourceSeason < targetSeason,
      idpRules,
    })

    if (!outcome.ok) {
      bumpRefusal(result, outcome.reason)
      continue
    }

    // `position` is NOT NULL in the schema. Refusing here rather than substituting 'UNK'
    // keeps an unidentifiable player out of position-filtered surfaces entirely.
    if (!position || !playerName) {
      bumpRefusal(result, 'missing_identity_fields')
      continue
    }

    result.basisCounts[outcome.basis] = (result.basisCounts[outcome.basis] ?? 0) + 1
    result.confidenceCounts[outcome.confidence.level] =
      (result.confidenceCounts[outcome.confidence.level] ?? 0) + 1
    if (outcome.idp?.usedMeasuredTackleSplit) result.usedTackleSplitEstimate++
    if (outcome.basis.startsWith('sleeper_weekly')) result.fromForwardProjection++

    // Week is null on purpose: this is a season-level baseline computed from a completed
    // prior season, not a week-specific forecast. Claiming a week would be a false precision.
    const week: number | null = null
    const lookupKey = snapshotKey(line.playerId, targetSeason, week, null)

    const adjustmentFactors = {
      engine: 'af-projections/v1',
      basis: outcome.basis,
      scoringFormat,
      sourceSeason,
      idpPreset: outcome.idp ? idpPreset : null,
      weeklyWeeksUsed: outcome.weeklyWeeksUsed,
      confidenceScore: outcome.confidence.score,
      confidenceReasons: outcome.confidence.reasons,
      // Component rates let a league rescore without re-running the engine — the Phase 4
      // lever, and the reason a single-format row is not a dead end.
      perGameRates: aggregate ? perGameRates(aggregate) : null,
      idp: outcome.idp ?? null,
    }
    // Round-trip through JSON so Prisma's InputJsonValue is satisfied (a bare `null` inside
    // an object literal is not assignable) and so anything non-serializable fails here,
    // loudly, rather than being silently dropped on write.
    const adjustmentFactorsJson = JSON.parse(JSON.stringify(adjustmentFactors)) as Prisma.InputJsonValue

    if (opts.dryRun) {
      result.written++
      continue
    }

    try {
      const data = {
        playerId: line.playerId,
        playerName,
        sport,
        position,
        week,
        season: targetSeason,
        baselineProjection: outcome.baselineProjection,
        // No weather layer yet. 0 here is the schema default meaning "no adjustment applied",
        // consistent with adjustmentReason staying null — not a stand-in for unknown weather.
        weatherAdjustment: 0,
        afProjection: outcome.afProjection,
        adjustmentFactors: adjustmentFactorsJson,
        adjustmentReason: outcome.adjustmentReason,
        confidenceLevel: outcome.confidence.level,
        computedAt: now,
        snapshotLookupKey: lookupKey,
      }
      await prisma.aFProjectionSnapshot.upsert({
        where: { snapshotLookupKey: lookupKey },
        create: data,
        update: data,
      })
      result.written++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (errors.length < 20) errors.push(`${playerName}: ${message.slice(0, 160)}`)
    }
  }

  return result
}

function bumpRefusal(result: WriteSnapshotsResult, reason: string): void {
  result.refused++
  result.refusalsByReason[reason] = (result.refusalsByReason[reason] ?? 0) + 1
}
