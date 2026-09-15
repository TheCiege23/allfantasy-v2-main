import { prisma } from '@/lib/prisma'
import { getRecentEvents } from '@/lib/guillotine/GuillotineEventLog'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'

/**
 * Guillotine escapes as shareable moments (retention item 9, user decisions 2026-09-14):
 * "Survived week 5's chop by 3.2 pts".
 *
 * ⚠ ONLY A CHOP THAT HAPPENED. An escape is read from the chop log (`guillotine_event_logs`,
 * eventType 'chop') and the period scores of that week — never from the live danger tiers, which
 * rank PROJECTED points and would call a team "escaped" from a chop that has not run.
 *
 * The margin is your points that week minus the HIGHEST-scoring team chopped that week: the line
 * you had to clear. It counts as an escape only within the league's own danger margin
 * (`dangerMarginPoints`, default 10) — beating the chop by 60 is not an escape.
 *
 * Refused, rather than guessed:
 *   - a chop the commissioner overrode (a chopped team may have outscored survivors, so there is
 *     no honest line to have cleared);
 *   - a week where you were chopped, or have no score on file;
 *   - a week with no score on file for any chopped team;
 *   - a negative margin (the log and the scores disagree).
 * A margin of exactly 0 is a real escape — on the tiebreaker.
 */

export type GuillotineEscape = {
  weekOrPeriod: number
  myPoints: number
  /** The highest-scoring team chopped that week. */
  chopLine: number
  margin: number
  choppedCount: number
}

type Chop = { weekOrPeriod: number; choppedRosterIds: string[]; commissionerOverride: boolean }

const round1 = (n: number) => Math.round(n * 10) / 10

/** The chop log's metadata, parsed; malformed rows are dropped. Chops logged twice for a week merge. */
export function chopsFromEvents(events: ReadonlyArray<{ metadata: unknown }>): Chop[] {
  const byWeek = new Map<number, Chop>()
  for (const e of events) {
    const m = (e.metadata ?? {}) as { weekOrPeriod?: unknown; choppedRosterIds?: unknown; commissionerOverride?: unknown }
    if (typeof m.weekOrPeriod !== 'number' || !Array.isArray(m.choppedRosterIds)) continue
    const ids = m.choppedRosterIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) continue
    const held = byWeek.get(m.weekOrPeriod)
    byWeek.set(m.weekOrPeriod, {
      weekOrPeriod: m.weekOrPeriod,
      choppedRosterIds: [...new Set([...(held?.choppedRosterIds ?? []), ...ids])],
      commissionerOverride: Boolean(held?.commissionerOverride) || m.commissionerOverride === true,
    })
  }
  return [...byWeek.values()]
}

export function escapesFrom(input: {
  rosterId: string
  chops: readonly Chop[]
  scores: ReadonlyArray<{ rosterId: string; weekOrPeriod: number; periodPoints: number }>
  dangerMarginPoints: number
}): GuillotineEscape[] {
  const out: GuillotineEscape[] = []
  for (const chop of input.chops) {
    if (chop.commissionerOverride || chop.choppedRosterIds.includes(input.rosterId)) continue
    const week = input.scores.filter((s) => s.weekOrPeriod === chop.weekOrPeriod)
    const mine = week.find((s) => s.rosterId === input.rosterId)
    const chopped = week.filter((s) => chop.choppedRosterIds.includes(s.rosterId))
    if (!mine || chopped.length === 0) continue
    const chopLine = Math.max(...chopped.map((s) => s.periodPoints))
    const margin = round1(mine.periodPoints - chopLine)
    if (margin < 0 || margin > input.dangerMarginPoints) continue
    out.push({
      weekOrPeriod: chop.weekOrPeriod,
      myPoints: round1(mine.periodPoints),
      chopLine: round1(chopLine),
      margin,
      choppedCount: chop.choppedRosterIds.length,
    })
  }
  return out.sort((a, b) => b.weekOrPeriod - a.weekOrPeriod)
}

/** Your escapes in this guillotine league, newest first. Empty when you have no roster here. */
export async function getGuillotineEscapesForUser(leagueId: string, userId: string): Promise<GuillotineEscape[]> {
  if (!leagueId || !userId) return []
  const [roster, config, events] = await Promise.all([
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
    getGuillotineConfig(leagueId),
    getRecentEvents(leagueId, { limit: 20, eventTypes: ['chop'] }),
  ])
  if (!roster || !config) return []
  const chops = chopsFromEvents(events)
  if (chops.length === 0) return []
  const scores = await prisma.guillotinePeriodScore.findMany({
    where: { leagueId, weekOrPeriod: { in: chops.map((c) => c.weekOrPeriod) } },
    select: { rosterId: true, weekOrPeriod: true, periodPoints: true },
  })
  return escapesFrom({ rosterId: roster.id, chops, scores, dangerMarginPoints: config.dangerMarginPoints ?? 10 })
}
