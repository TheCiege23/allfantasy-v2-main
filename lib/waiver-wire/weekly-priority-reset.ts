import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import { PRIORITY_RESET_WAIVER_TYPES, readWaiverOrderResetPolicy } from './hub-waiver-options'

/**
 * Weekly waiver priority reset (`LeagueWaiverSettings.waiverOrderResetPolicy = 'weekly'`): when a
 * scoring week opens, a rolling or standard league's priority order resets to reverse standings —
 * worst record picks first — the Yahoo/ESPN behaviour. `rolling` (the default) never resets.
 *
 * Called from the one week-advance writer, `advanceNflRedraftScheduleWeek`
 * (lib/schedule-runtime/resolveNflRedraftScheduleRuntime.ts), which both the hourly
 * `/api/cron/season-week-roll` and the commissioner's schedule route go through, right after it has
 * recomputed standings.
 *
 * Both priority columns are rewritten, in the same order: `Roster.waiverPriority` (the waiver-wire
 * engine, lib/waiver-wire/process-engine.ts) and `RedraftRoster.waiverPriority` (the redraft engine,
 * lib/redraft/waiverEngine.ts), so the two engines never disagree about who picks first.
 *
 * IDEMPOTENT: the week a reset was applied is recorded in `League.settings` under
 * WEEKLY_PRIORITY_RESET_SETTINGS_KEY, and a week at or before the recorded one (same season) is a
 * no-op — so a rerun of the roller, or a commissioner re-advancing, never resets twice and never
 * undoes the week's claims. Two truly concurrent runs would both compute the same order from the
 * same standings, so the race cannot produce a wrong order.
 */
export const WEEKLY_PRIORITY_RESET_SETTINGS_KEY = 'waiver_priority_weekly_reset'

export type WeeklyResetMarker = { seasonId: string; week: number; at: string }

export type StandingRow = {
  id: string
  ownerId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  waiverPriority?: number | null
}

export type LeagueRosterRow = {
  id: string
  platformUserId: string
  redraftRosterId: string | null
  waiverPriority: number | null
}

function winPct(r: StandingRow): number {
  const games = r.wins + r.losses + r.ties
  return games > 0 ? (r.wins + r.ties / 2) / games : 0
}

/** Redraft roster ids, worst standing first: win % ascending, then points for ascending. */
export function reverseStandingsOrder(rows: readonly StandingRow[]): string[] {
  return [...rows]
    .sort((a, b) => winPct(a) - winPct(b) || a.pointsFor - b.pointsFor || (a.waiverPriority ?? 999) - (b.waiverPriority ?? 999) || a.id.localeCompare(b.id))
    .map((r) => r.id)
}

/**
 * The new priority for every row in both tables. A league roster is matched to its redraft roster by
 * `redraftRosterId`, else by `platformUserId === ownerId`; one with no match keeps its relative
 * place behind every matched team rather than jumping the queue.
 */
export function planWeeklyPriorityReset(input: {
  standings: readonly StandingRow[]
  leagueRosters: readonly LeagueRosterRow[]
}): { redraft: Array<{ id: string; waiverPriority: number }>; league: Array<{ id: string; waiverPriority: number }> } {
  const order = reverseStandingsOrder(input.standings)
  const rank = new Map(order.map((id, i) => [id, i + 1]))
  const ownerToRedraft = new Map(input.standings.map((r) => [r.ownerId, r.id]))

  const matched: Array<{ id: string; at: number }> = []
  const unmatched: LeagueRosterRow[] = []
  for (const r of input.leagueRosters) {
    const redraftId = (r.redraftRosterId && rank.has(r.redraftRosterId) ? r.redraftRosterId : null) ?? ownerToRedraft.get(r.platformUserId) ?? null
    if (redraftId) matched.push({ id: r.id, at: rank.get(redraftId)! })
    else unmatched.push(r)
  }
  matched.sort((a, b) => a.at - b.at)
  unmatched.sort((a, b) => (a.waiverPriority ?? 999) - (b.waiverPriority ?? 999) || a.id.localeCompare(b.id))

  return {
    redraft: order.map((id, i) => ({ id, waiverPriority: i + 1 })),
    league: [...matched.map((m) => m.id), ...unmatched.map((u) => u.id)].map((id, i) => ({ id, waiverPriority: i + 1 })),
  }
}

export function readWeeklyResetMarker(settings: unknown): WeeklyResetMarker | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[WEEKLY_PRIORITY_RESET_SETTINGS_KEY] : null
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (typeof m.seasonId !== 'string' || typeof m.week !== 'number') return null
  return { seasonId: m.seasonId, week: m.week, at: typeof m.at === 'string' ? m.at : '' }
}

/** True when this season's reset already covers `week` (a rerun, or a week re-advanced). */
export function weeklyResetAlreadyApplied(marker: WeeklyResetMarker | null, seasonId: string, week: number): boolean {
  return Boolean(marker && marker.seasonId === seasonId && marker.week >= week)
}

type Db = typeof prisma
type ResetDeps = {
  db?: Db
  loadSettings?: (leagueId: string) => Promise<{ waiverOrderResetPolicy: string | null; normalizedWaiverType: string }>
  now?: Date
}

export type WeeklyResetOutcome =
  | { applied: true; week: number; rostersReset: number }
  | { applied: false; reason: 'policy_rolling' | 'waiver_type_not_priority' | 'already_applied' | 'no_standings' | 'league_not_found' }

export async function applyWeeklyWaiverPriorityReset(
  input: { leagueId: string; seasonId: string; week: number },
  deps: ResetDeps = {},
): Promise<WeeklyResetOutcome> {
  const db = deps.db ?? prisma
  const settings = await (deps.loadSettings ?? getEffectiveLeagueWaiverSettings)(input.leagueId)
  if (readWaiverOrderResetPolicy(settings.waiverOrderResetPolicy) !== 'weekly') return { applied: false, reason: 'policy_rolling' }
  if (!(PRIORITY_RESET_WAIVER_TYPES as readonly string[]).includes(settings.normalizedWaiverType)) {
    return { applied: false, reason: 'waiver_type_not_priority' }
  }

  return db.$transaction(async (tx) => {
    const league = await tx.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
    if (!league) return { applied: false, reason: 'league_not_found' } as const
    if (weeklyResetAlreadyApplied(readWeeklyResetMarker(league.settings), input.seasonId, input.week)) {
      return { applied: false, reason: 'already_applied' } as const
    }

    const [standings, leagueRosters] = await Promise.all([
      tx.redraftRoster.findMany({
        where: { seasonId: input.seasonId },
        select: { id: true, ownerId: true, wins: true, losses: true, ties: true, pointsFor: true, waiverPriority: true },
      }),
      tx.roster.findMany({
        where: { leagueId: input.leagueId },
        select: { id: true, platformUserId: true, redraftRosterId: true, waiverPriority: true },
      }),
    ])
    if (standings.length === 0) return { applied: false, reason: 'no_standings' } as const

    const plan = planWeeklyPriorityReset({ standings, leagueRosters })
    for (const r of plan.redraft) await tx.redraftRoster.update({ where: { id: r.id }, data: { waiverPriority: r.waiverPriority } })
    for (const r of plan.league) await tx.roster.update({ where: { id: r.id }, data: { waiverPriority: r.waiverPriority } })

    const prev = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
    const marker: WeeklyResetMarker = { seasonId: input.seasonId, week: input.week, at: (deps.now ?? new Date()).toISOString() }
    await tx.league.update({
      where: { id: input.leagueId },
      data: { settings: { ...prev, [WEEKLY_PRIORITY_RESET_SETTINGS_KEY]: marker } },
    })
    return { applied: true, week: input.week, rostersReset: plan.league.length } as const
  })
}
