import 'server-only'

import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { ADVANCED_KEY, isDefault, normalizeAdvanced, readAdvanced, type GuillotineAdvanced, type NormalizeError } from './chopSchedule'
import { calendarFitMessage, guillotineCalendarFit } from './calendarFit'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import { resolveGuillotineEndgame } from './endgameRules'

/**
 * Save the guillotine chop schedule and immunity (rules in ./chopSchedule). AF Commissioner
 * (`commissioner_automation`) to change them — spec §4.5 lists them in the Commissioner column.
 * Resetting to the plain one-chop-a-week season is always allowed, so a lapsed plan never traps a
 * league on rules it can no longer edit. Written under the league row lock: League.settings is shared
 * by every settings writer.
 */

export type SaveAdvancedError = NormalizeError | 'not_entitled' | 'not_found' | 'calendar_too_short'

export async function readGuillotineAdvanced(leagueId: string): Promise<GuillotineAdvanced> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return readAdvanced(row?.settings)
}

export async function saveGuillotineAdvanced(
  leagueId: string,
  userId: string,
  raw: unknown,
): Promise<{ ok: true; value: GuillotineAdvanced } | { ok: false; error: SaveAdvancedError; message?: string }> {
  const n = normalizeAdvanced(raw)
  if (!n.ok) return n
  // A schedule that cannot reach a champion is refused here, with the reason (calendarFit.ts).
  const calendar = await loadCalendarForSchedule(leagueId, n.value).catch(() => null)
  if (calendar) {
    const fit = guillotineCalendarFit(calendar)
    if (!fit.fits) return { ok: false, error: 'calendar_too_short', message: calendarFitMessage(calendar, fit) }
  }
  if (!isDefault(n.value)) {
    const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
    if (!access?.allowed) return { ok: false, error: 'not_entitled' }
  }
  const written = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return false
    const next = { ...((row.settings as Record<string, unknown> | null) ?? {}) }
    if (isDefault(n.value)) delete next[ADVANCED_KEY]
    else next[ADVANCED_KEY] = n.value
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
    return true
  })
  return written ? { ok: true, value: n.value } : { ok: false, error: 'not_found' }
}

/** The league's calendar with a proposed chop schedule, or null when it cannot be read (then no check). */
async function loadCalendarForSchedule(leagueId: string, advanced: GuillotineAdvanced) {
  const [config, league, teamCount] = await Promise.all([
    getGuillotineConfig(leagueId),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } }),
    prisma.roster.count({ where: { leagueId } }),
  ])
  if (!config || !league || teamCount <= 0 || config.eliminationEndWeek == null) return null
  const endgame = resolveGuillotineEndgame(league)
  return {
    teamCount,
    startWeek: config.eliminationStartWeek,
    endWeek: config.eliminationEndWeek,
    baseChops: config.teamsPerChop,
    advanced,
    threshold: endgame.threshold,
    finalPeriods: endgame.cumulativePeriods,
  }
}
