import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import {
  MANUAL_FINALS_KEY,
  MANUAL_FINAL_REASON_MAX,
  MANUAL_FINAL_REASON_MIN,
  isManuallyFinal,
  parseManualFinalReason,
  readManualFinals,
  type ManualFinal,
} from './manualFinal'

/**
 * Mark one regular-season game final by hand, or reopen one (./manualFinal). Free on every tier, like
 * score adjustments.
 *
 * The list and the matchup's status change in ONE transaction under the league row lock, so a rescore
 * running at the same moment either sees the game listed and leaves it, or finishes first and is then
 * overwritten by the `final` written here. Standings are recomputed afterwards so the record moves
 * with the result. Every change writes the audit log with its reason and the score it closed at.
 */
export type ManualFinalError =
  | 'bad_reason'
  | 'not_found'
  | 'not_native'
  | 'not_regular_season'
  | 'bye'
  | 'roto'
  | 'future_week'
  | 'already_final'
  | 'not_manual'
  | 'week_closed'

export const MANUAL_FINAL_ERROR_TEXT: Record<ManualFinalError, string> = {
  bad_reason: `Give a reason (${MANUAL_FINAL_REASON_MIN}–${MANUAL_FINAL_REASON_MAX} characters). It shows in the audit log.`,
  not_found: 'That game is not in this league.',
  not_native: 'This league is scored by the platform it was imported from, so a game cannot be closed here.',
  not_regular_season: 'Only a regular-season game can be marked final here. Playoff games are decided on the playoff bracket.',
  bye: 'A bye has no game to close.',
  roto: 'A rotisserie league has no head-to-head games to close.',
  future_week: 'This game is in a week that has not started yet.',
  already_final: 'This game is already final.',
  not_manual: 'This game was not closed by hand, so there is nothing to reopen.',
  week_closed: 'This week is already over, so the game cannot be reopened. Use a score adjustment to change the score.',
}

type Result = { ok: true; matchupId: string; week: number; homeScore: number; awayScore: number } | { ok: false; error: ManualFinalError }

async function lockedSettings(tx: Prisma.TransactionClient, leagueId: string) {
  await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
  const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true, platform: true } })
  if (!row) return null
  const settings = (row.settings as Record<string, unknown> | null) ?? {}
  const scoringMode = String(settings.scoring_mode ?? (settings.scoringSettings as Record<string, unknown> | undefined)?.scoringMode ?? 'points')
  return { settings, scoringMode, platform: row.platform, list: readManualFinals(settings) }
}

async function writeList(tx: Prisma.TransactionClient, leagueId: string, settings: Record<string, unknown>, list: ManualFinal[]) {
  const next = { ...settings }
  if (list.length) next[MANUAL_FINALS_KEY] = list
  else delete next[MANUAL_FINALS_KEY]
  await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
}

async function loadMatchup(leagueId: string, matchupId: unknown) {
  if (typeof matchupId !== 'string' || !matchupId) return null
  return prisma.redraftMatchup.findFirst({
    where: { id: matchupId, leagueId },
    select: {
      id: true, seasonId: true, week: true, type: true, status: true, awayRosterId: true, homeScore: true, awayScore: true,
      season: { select: { currentWeek: true } },
    },
  })
}

async function afterChange(leagueId: string, userId: string, actionType: string, entry: ManualFinal, seasonId: string) {
  try {
    await updateStandings(seasonId, entry.week)
  } catch (e) {
    console.warn('[manual-final] standings refresh failed; the next standings run picks it up', e instanceof Error ? e.message : e)
  }
  try {
    await prisma.leagueAuditLog.create({
      data: {
        leagueId,
        userId,
        actionType,
        entityType: 'redraft_matchup',
        entityId: entry.matchupId,
        afterState: entry as unknown as Prisma.InputJsonValue,
        metadata: { week: entry.week, homeScore: entry.homeScore, awayScore: entry.awayScore, reason: entry.reason },
      },
    })
  } catch (e) {
    // The ruling stands; a missing audit row is logged, never a reason to undo it.
    console.warn('[manual-final] audit write failed', e instanceof Error ? e.message : e)
  }
}

/** Close one regular-season game at the score it shows now. */
export async function finalizeMatchupManually(leagueId: string, userId: string, body: unknown): Promise<Result> {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const reason = parseManualFinalReason(b.reason)
  if (!reason) return { ok: false, error: 'bad_reason' }
  const matchup = await loadMatchup(leagueId, b.matchupId)
  if (!matchup) return { ok: false, error: 'not_found' }
  if (!matchup.awayRosterId) return { ok: false, error: 'bye' }
  if (matchup.type !== 'regular') return { ok: false, error: 'not_regular_season' }
  if (matchup.week > Math.max(1, matchup.season.currentWeek ?? 1)) return { ok: false, error: 'future_week' }

  const result = await prisma.$transaction(async (tx) => {
    const league = await lockedSettings(tx, leagueId)
    if (!league) return { ok: false as const, error: 'not_found' as const }
    if (!isNativePlatform(league.platform)) return { ok: false as const, error: 'not_native' as const }
    if (league.scoringMode === 'roto') return { ok: false as const, error: 'roto' as const }
    // Read again under the lock: the score a rescore just wrote is the score the game closes at.
    const live = await tx.redraftMatchup.findUnique({ where: { id: matchup.id }, select: { status: true, homeScore: true, awayScore: true } })
    if (!live) return { ok: false as const, error: 'not_found' as const }
    if (live.status === 'final' || isManuallyFinal(league.list, matchup.id)) return { ok: false as const, error: 'already_final' as const }
    const entry: ManualFinal = {
      matchupId: matchup.id, week: matchup.week, homeScore: live.homeScore, awayScore: live.awayScore,
      reason, byUserId: userId, at: new Date().toISOString(),
    }
    await writeList(tx, leagueId, league.settings, [...league.list, entry])
    await tx.redraftMatchup.update({ where: { id: matchup.id }, data: { status: 'final' } })
    return { ok: true as const, entry }
  })
  if (!result.ok) return result
  await afterChange(leagueId, userId, 'matchup_finalized_manually', result.entry, matchup.seasonId)
  return { ok: true, matchupId: matchup.id, week: matchup.week, homeScore: result.entry.homeScore, awayScore: result.entry.awayScore }
}

/**
 * Reopen a game the commissioner closed by hand, so the next score sync scores it again. Only while its
 * week is still the season's current one: a finished week's results already fed the standings, the
 * waiver order and the week after it.
 */
export async function reopenMatchupManually(leagueId: string, userId: string, body: unknown): Promise<Result> {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const matchup = await loadMatchup(leagueId, b.matchupId)
  if (!matchup) return { ok: false, error: 'not_found' }
  if (matchup.week < Math.max(1, matchup.season.currentWeek ?? 1)) return { ok: false, error: 'week_closed' }

  const result = await prisma.$transaction(async (tx) => {
    const league = await lockedSettings(tx, leagueId)
    if (!league) return { ok: false as const, error: 'not_found' as const }
    const entry = league.list.find((f) => f.matchupId === matchup.id)
    if (!entry) return { ok: false as const, error: 'not_manual' as const }
    await writeList(tx, leagueId, league.settings, league.list.filter((f) => f.matchupId !== matchup.id))
    await tx.redraftMatchup.update({ where: { id: matchup.id }, data: { status: 'active' } })
    return { ok: true as const, entry }
  })
  if (!result.ok) return result
  await afterChange(leagueId, userId, 'matchup_reopened_manually', result.entry, matchup.seasonId)
  return { ok: true, matchupId: matchup.id, week: matchup.week, homeScore: matchup.homeScore, awayScore: matchup.awayScore }
}
