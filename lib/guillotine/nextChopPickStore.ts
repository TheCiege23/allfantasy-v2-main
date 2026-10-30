import 'server-only'

/**
 * Reads and writes for "Who's next?" (./nextChopPick.ts): the viewer's pick state for the summary, and
 * a pick saved as a league event. The rules live in ./nextChopPick.ts; this only gathers their inputs.
 */
import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import { guillotineFantasyWeekAt } from './lateStartSeats'
import { resolveRosterDisplayNames } from './rosterDisplayNames'
import { appendEvent } from './GuillotineEventLog'
import { latestPicks, nextChopLeaderboard, openPickWeek, type NextChopPick } from './nextChopPick'

export const NEXT_CHOP_PICK_EVENT = 'next_chop_pick' as const

export type NextChopPickState = {
  /** The week a pick is open for; null once the chops are over (or the calendar cannot tell). */
  week: number | null
  /** The viewer's team has been chopped, so they play. */
  canPick: boolean
  /** The viewer's pick for the open week. */
  myPick: string | null
  /** The teams still alive, the ones a pick can name. */
  candidates: Array<{ rosterId: string; name: string }>
  leaderboard: Array<{ rosterId: string; name: string; correct: number; settled: number; isMe: boolean }>
  /** The viewer's last settled pick, so the page can say whether it landed. */
  lastResult: { week: number; pickedName: string; correct: boolean } | null
}

type Deps = { now?: () => Date; calendarWeek?: (sport: string, season: number, at: Date) => Promise<number | null> }

async function leagueBasics(leagueId: string) {
  const [league, config, states, rosters] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } }),
    getGuillotineConfig(leagueId),
    prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true, choppedInPeriod: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
  ])
  const choppedWeek = new Map(states.filter((s) => s.choppedInPeriod != null).map((s) => [s.rosterId, s.choppedInPeriod as number]))
  const chopped = new Set(states.map((s) => s.rosterId))
  const alive = rosters.map((r) => r.id).filter((id) => !chopped.has(id))
  return { league, config, choppedWeek, chopped, alive }
}

async function pickWeekFor(basics: Awaited<ReturnType<typeof leagueBasics>>, deps: Deps): Promise<number | null> {
  const { league, config } = basics
  if (!league || !config || typeof league.season !== 'number') return null
  const calendar = await (deps.calendarWeek ?? guillotineFantasyWeekAt)(String(league.sport), league.season, (deps.now ?? (() => new Date()))())
  if (calendar == null) return null
  return openPickWeek({ calendarWeek: calendar, eliminationStartWeek: config.eliminationStartWeek, eliminationEndWeek: config.eliminationEndWeek ?? null })
}

async function readPicks(leagueId: string, season: number | null): Promise<NextChopPick[]> {
  const rows = await prisma.guillotineEventLog.findMany({
    where: { leagueId, eventType: NEXT_CHOP_PICK_EVENT, ...(season != null ? { metadata: { path: ['season'], equals: season } } : {}) },
    select: { metadata: true, createdAt: true },
  })
  return rows.flatMap((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>
    return typeof m.pickerRosterId === 'string' && typeof m.pickedRosterId === 'string' && typeof m.week === 'number'
      ? [{ pickerRosterId: m.pickerRosterId, pickedRosterId: m.pickedRosterId, week: m.week, at: r.createdAt.toISOString() }]
      : []
  })
}

/** The viewer's "Who's next?" state. Never throws; null when the league has no Guilly config. */
export async function loadNextChopPickState(leagueId: string, viewerRosterId: string | null, deps: Deps = {}): Promise<NextChopPickState | null> {
  try {
    const basics = await leagueBasics(leagueId)
    if (!basics.config) return null
    const season = typeof basics.league?.season === 'number' ? basics.league.season : null
    const [week, picks] = await Promise.all([pickWeekFor(basics, deps), readPicks(leagueId, season)])
    const board = nextChopLeaderboard(picks, basics.choppedWeek)
    const names = await resolveRosterDisplayNames(leagueId, [...new Set([...basics.alive, ...board.map((r) => r.rosterId), ...picks.map((p) => p.pickedRosterId)])])
    const nameOf = (id: string) => names.get(id) ?? 'A team'
    const mine = latestPicks(picks).filter((p) => p.pickerRosterId === viewerRosterId)
    const choppedWeeks = new Set(basics.choppedWeek.values())
    const settled = mine.filter((p) => choppedWeeks.has(p.week)).sort((a, b) => b.week - a.week)[0]
    return {
      week,
      canPick: !!viewerRosterId && basics.chopped.has(viewerRosterId),
      myPick: week == null ? null : mine.find((p) => p.week === week)?.pickedRosterId ?? null,
      candidates: basics.alive.map((rosterId) => ({ rosterId, name: nameOf(rosterId) })).sort((a, b) => a.name.localeCompare(b.name)),
      leaderboard: board.map((r) => ({ ...r, name: nameOf(r.rosterId), isMe: r.rosterId === viewerRosterId })),
      lastResult: settled ? { week: settled.week, pickedName: nameOf(settled.pickedRosterId), correct: basics.choppedWeek.get(settled.pickedRosterId) === settled.week } : null,
    }
  } catch {
    return null
  }
}

export type SavePickResult = { ok: true; week: number } | { ok: false; reason: 'not_chopped' | 'closed' | 'not_alive' }

/** Save the viewer's pick for the open week. The latest pick before the week starts is the one that counts. */
export async function saveNextChopPick(
  input: { leagueId: string; viewerRosterId: string | null; userId: string; week: number; pickedRosterId: string },
  deps: Deps = {},
): Promise<SavePickResult> {
  const basics = await leagueBasics(input.leagueId)
  if (!input.viewerRosterId || !basics.chopped.has(input.viewerRosterId)) return { ok: false, reason: 'not_chopped' }
  const week = await pickWeekFor(basics, deps)
  // The week the page offered must still be the open one: a pick made after it started does not count.
  if (week == null || week !== input.week) return { ok: false, reason: 'closed' }
  if (!basics.alive.includes(input.pickedRosterId)) return { ok: false, reason: 'not_alive' }
  await appendEvent(input.leagueId, NEXT_CHOP_PICK_EVENT, {
    season: typeof basics.league?.season === 'number' ? basics.league.season : null,
    week,
    pickerRosterId: input.viewerRosterId,
    pickedRosterId: input.pickedRosterId,
    userId: input.userId,
  })
  return { ok: true, week }
}
