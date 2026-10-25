import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { leagueUsesC2CEngine } from '@/lib/c2c/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import {
  MAX_ADJUSTMENT_POINTS,
  MAX_ADJUSTMENTS_PER_LEAGUE,
  REASON_MAX,
  SCORE_ADJUSTMENTS_KEY,
  adjustmentFor,
  parseAdjustmentInput,
  readScoreAdjustments,
  statCorrectionApplied,
  type AdjustmentInputError,
  type ScoreAdjustment,
} from './scoreAdjustments'

/**
 * Add or remove a commissioner score adjustment (./scoreAdjustments). Free on every tier (spec §2.1).
 *
 * The list and the stored matchup score change in ONE transaction under the league row lock, so the
 * score a reader sees always equals computed + the saved adjustments — including on a sealed week,
 * which the score sync never rescores. A later rescore of an open week recomputes the same total from
 * stats plus the list, so the two paths agree. Standings are recomputed afterwards so the record and
 * points-for move with the score. Every change writes the audit log with its reason.
 */

export type AdjustmentError = AdjustmentInputError | 'not_found' | 'not_points' | 'c2c' | 'median_only' | 'too_many'

export const ADJUSTMENT_SERVICE_ERROR_TEXT: Record<Exclude<AdjustmentError, AdjustmentInputError>, string> = {
  not_found: 'That matchup or adjustment is not in this league.',
  not_points: 'Score adjustments are for points leagues. In a category league the score is categories won.',
  c2c: 'Campus to Canton matchups are scored by their own engine and cannot be adjusted here yet.',
  median_only: 'This row is the league median game; adjust the team’s head-to-head matchup instead.',
  too_many: `This league has reached ${MAX_ADJUSTMENTS_PER_LEAGUE} adjustments.`,
}

type Side = 'home' | 'away'

async function lockedLeague(tx: Prisma.TransactionClient, leagueId: string) {
  await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
  const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!row) return null
  const settings = (row.settings as Record<string, unknown> | null) ?? {}
  const scoringMode = (settings.scoring_mode ?? (settings.scoringSettings as Record<string, unknown> | undefined)?.scoringMode ?? 'points') as string
  return { settings, scoringMode, list: readScoreAdjustments(settings) }
}

async function writeList(tx: Prisma.TransactionClient, leagueId: string, settings: Record<string, unknown>, list: ScoreAdjustment[]) {
  const next = { ...settings }
  if (list.length) next[SCORE_ADJUSTMENTS_KEY] = list
  else delete next[SCORE_ADJUSTMENTS_KEY]
  await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
}

async function shiftScore(tx: Prisma.TransactionClient, matchupId: string, side: Side, delta: number) {
  await tx.redraftMatchup.update({
    where: { id: matchupId },
    data: side === 'home' ? { homeScore: { increment: delta } } : { awayScore: { increment: delta } },
  })
}

async function audit(leagueId: string, userId: string, actionType: string, adjustment: ScoreAdjustment, net: number) {
  try {
    await prisma.leagueAuditLog.create({
      data: {
        leagueId,
        userId,
        actionType,
        entityType: 'score_adjustment',
        entityId: adjustment.id,
        afterState: adjustment as unknown as Prisma.InputJsonValue,
        metadata: { matchupId: adjustment.matchupId, rosterId: adjustment.rosterId, week: adjustment.week, netAdjustment: net },
      },
    })
  } catch (e) {
    // The adjustment stands; a missing audit row is logged, never a reason to undo a ruling.
    console.warn('[score-adjustments] audit write failed', e instanceof Error ? e.message : e)
  }
}

async function refreshStandings(seasonId: string, week: number) {
  try {
    await updateStandings(seasonId, week)
  } catch (e) {
    console.warn('[score-adjustments] standings refresh failed; the next standings run picks it up', e instanceof Error ? e.message : e)
  }
}

export async function addScoreAdjustment(
  leagueId: string,
  userId: string,
  body: unknown,
): Promise<{ ok: true; adjustment: ScoreAdjustment; net: number } | { ok: false; error: AdjustmentError }> {
  const parsed = parseAdjustmentInput(body)
  if (!parsed.ok) return parsed
  const input = parsed.value
  const matchup = await prisma.redraftMatchup.findFirst({
    where: { id: input.matchupId, leagueId },
    select: { id: true, seasonId: true, week: true, homeRosterId: true, awayRosterId: true },
  })
  if (!matchup) return { ok: false, error: 'not_found' }
  if (!matchup.awayRosterId) return { ok: false, error: 'median_only' }
  const side: Side | null = input.rosterId === matchup.homeRosterId ? 'home' : input.rosterId === matchup.awayRosterId ? 'away' : null
  if (!side) return { ok: false, error: 'bad_target' }
  if (await leagueUsesC2CEngine(leagueId)) return { ok: false, error: 'c2c' }

  const adjustment: ScoreAdjustment = {
    id: randomUUID(), matchupId: matchup.id, rosterId: input.rosterId, week: matchup.week,
    points: input.points, reason: input.reason, byUserId: userId, at: new Date().toISOString(),
  }
  const result = await prisma.$transaction(async (tx) => {
    const league = await lockedLeague(tx, leagueId)
    if (!league) return { ok: false as const, error: 'not_found' as const }
    if (league.scoringMode !== 'points') return { ok: false as const, error: 'not_points' as const }
    if (league.list.length >= MAX_ADJUSTMENTS_PER_LEAGUE) return { ok: false as const, error: 'too_many' as const }
    const list = [...league.list, adjustment]
    await writeList(tx, leagueId, league.settings, list)
    await shiftScore(tx, matchup.id, side, adjustment.points)
    return { ok: true as const, net: adjustmentFor(list, matchup.id, input.rosterId) }
  })
  if (!result.ok) return result
  await refreshStandings(matchup.seasonId, matchup.week)
  await audit(leagueId, userId, 'score_adjustment_added', adjustment, result.net)
  return { ok: true, adjustment, net: result.net }
}

/**
 * Bring one team's STAT-CORRECTION adjustment in one matchup to `targetNet` — the corrected points the
 * league office's new stats are worth (lib/stat-corrections). Adds only the difference from what is
 * already applied, and works that out under the league lock, so a double tap or two commissioners at
 * once apply a correction once. Nothing to add is success with no adjustment. The commissioner's own
 * adjustments are not counted: a penalty and a stat correction on the same team stay separate.
 */
export async function applyStatCorrectionAdjustment(
  leagueId: string,
  userId: string,
  input: { matchupId: string; rosterId: string; targetNet: number; reason: string },
): Promise<{ ok: true; adjustment: ScoreAdjustment | null; net: number } | { ok: false; error: AdjustmentError }> {
  if (!Number.isFinite(input.targetNet)) return { ok: false, error: 'bad_points' }
  const matchup = await prisma.redraftMatchup.findFirst({
    where: { id: input.matchupId, leagueId },
    select: { id: true, seasonId: true, week: true, homeRosterId: true, awayRosterId: true },
  })
  if (!matchup) return { ok: false, error: 'not_found' }
  if (!matchup.awayRosterId) return { ok: false, error: 'median_only' }
  const side: Side | null = input.rosterId === matchup.homeRosterId ? 'home' : input.rosterId === matchup.awayRosterId ? 'away' : null
  if (!side) return { ok: false, error: 'bad_target' }
  if (await leagueUsesC2CEngine(leagueId)) return { ok: false, error: 'c2c' }

  const result = await prisma.$transaction(async (tx) => {
    const league = await lockedLeague(tx, leagueId)
    if (!league) return { ok: false as const, error: 'not_found' as const }
    if (league.scoringMode !== 'points') return { ok: false as const, error: 'not_points' as const }
    const points = Math.round((input.targetNet - statCorrectionApplied(league.list, matchup.id, input.rosterId)) * 100) / 100
    if (points === 0) return { ok: true as const, adjustment: null, net: adjustmentFor(league.list, matchup.id, input.rosterId) }
    if (Math.abs(points) > MAX_ADJUSTMENT_POINTS) return { ok: false as const, error: 'bad_points' as const }
    if (league.list.length >= MAX_ADJUSTMENTS_PER_LEAGUE) return { ok: false as const, error: 'too_many' as const }
    const adjustment: ScoreAdjustment = {
      id: randomUUID(), matchupId: matchup.id, rosterId: input.rosterId, week: matchup.week,
      points, reason: input.reason.trim().slice(0, REASON_MAX), byUserId: userId, at: new Date().toISOString(),
      source: 'stat_correction',
    }
    const list = [...league.list, adjustment]
    await writeList(tx, leagueId, league.settings, list)
    await shiftScore(tx, matchup.id, side, points)
    return { ok: true as const, adjustment, net: adjustmentFor(list, matchup.id, input.rosterId) }
  })
  if (!result.ok || !result.adjustment) return result
  await refreshStandings(matchup.seasonId, matchup.week)
  await audit(leagueId, userId, 'score_adjustment_added', result.adjustment, result.net)
  return result
}

export async function removeScoreAdjustment(
  leagueId: string,
  userId: string,
  adjustmentId: unknown,
): Promise<{ ok: true; adjustment: ScoreAdjustment; net: number } | { ok: false; error: AdjustmentError }> {
  if (typeof adjustmentId !== 'string' || !adjustmentId) return { ok: false, error: 'not_found' }
  const result = await prisma.$transaction(async (tx) => {
    const league = await lockedLeague(tx, leagueId)
    if (!league) return { ok: false as const, error: 'not_found' as const }
    const target = league.list.find((a) => a.id === adjustmentId)
    if (!target) return { ok: false as const, error: 'not_found' as const }
    const matchup = await tx.redraftMatchup.findFirst({
      where: { id: target.matchupId, leagueId },
      select: { id: true, seasonId: true, week: true, homeRosterId: true, awayRosterId: true },
    })
    const list = league.list.filter((a) => a.id !== adjustmentId)
    await writeList(tx, leagueId, league.settings, list)
    // A matchup deleted since (a schedule rebuild) has no score left to take the points back from.
    const side: Side | null = matchup ? (target.rosterId === matchup.homeRosterId ? 'home' : target.rosterId === matchup.awayRosterId ? 'away' : null) : null
    if (matchup && side) await shiftScore(tx, matchup.id, side, -target.points)
    return { ok: true as const, target, matchup, net: adjustmentFor(list, target.matchupId, target.rosterId) }
  })
  if (!result.ok) return result
  if (result.matchup) await refreshStandings(result.matchup.seasonId, result.matchup.week)
  await audit(leagueId, userId, 'score_adjustment_removed', result.target, result.net)
  return { ok: true, adjustment: result.target, net: result.net }
}

export type AdjustmentWeekView = {
  week: number
  weeks: number[]
  scoringMode: string
  matchups: Array<{
    matchupId: string
    status: string
    teams: Array<{ rosterId: string; name: string; score: number; adjustment: number }>
  }>
  adjustments: ScoreAdjustment[]
}

/** One week of the league's current season: each head-to-head matchup, its scores and adjustments. */
export async function readAdjustmentWeek(leagueId: string, weekParam: unknown): Promise<AdjustmentWeekView | null> {
  const [league, season] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true } }),
  ])
  if (!league || !season) return null
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  const scoringMode = String(settings.scoring_mode ?? (settings.scoringSettings as Record<string, unknown> | undefined)?.scoringMode ?? 'points')
  const weekRows = await prisma.redraftMatchup.findMany({ where: { seasonId: season.id }, select: { week: true }, distinct: ['week'], orderBy: { week: 'asc' } })
  const weeks = weekRows.map((w) => w.week)
  if (!weeks.length) return { week: 1, weeks, scoringMode, matchups: [], adjustments: [] }
  const asked = Number(weekParam)
  const latestPlayed = await prisma.redraftMatchup.findFirst({
    where: { seasonId: season.id, status: { in: ['active', 'final'] } }, orderBy: { week: 'desc' }, select: { week: true },
  })
  const week = Number.isInteger(asked) && weeks.includes(asked) ? asked : latestPlayed?.week ?? weeks[0]
  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week, NOT: { awayRosterId: null } },
    select: {
      id: true, status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true,
      homeRoster: { select: { teamName: true, ownerName: true } }, awayRoster: { select: { teamName: true, ownerName: true } },
    },
    orderBy: { id: 'asc' },
  })
  const all = readScoreAdjustments(settings)
  const ids = new Set(rows.map((r) => r.id))
  const name = (r: { teamName: string | null; ownerName: string } | null) => r?.teamName?.trim() || r?.ownerName || 'Team'
  return {
    week,
    weeks,
    scoringMode,
    matchups: rows.map((r) => ({
      matchupId: r.id,
      status: r.status,
      teams: [
        { rosterId: r.homeRosterId, name: name(r.homeRoster), score: r.homeScore, adjustment: adjustmentFor(all, r.id, r.homeRosterId) },
        { rosterId: r.awayRosterId!, name: name(r.awayRoster), score: r.awayScore, adjustment: adjustmentFor(all, r.id, r.awayRosterId!) },
      ],
    })),
    adjustments: all.filter((a) => ids.has(a.matchupId)),
  }
}
