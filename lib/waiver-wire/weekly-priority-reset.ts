import { prisma } from '@/lib/prisma'
import { buildNflRedraftPlayoffRuntimeState } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { resolveNflRedraftPlayoffRuntime, rulesWithPlayoffTeamOverride } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import { PRIORITY_RESET_WAIVER_TYPES, readWaiverOrderResetPolicy } from './hub-waiver-options'

/**
 * Weekly waiver priority reset (`LeagueWaiverSettings.waiverOrderResetPolicy = 'weekly'`): when a
 * scoring week opens, a rolling or standard league's priority order resets to reverse standings —
 * the last-place team picks first — the Yahoo/ESPN behaviour. `rolling` (the default) never resets.
 *
 * Called from the one week-advance writer, `advanceNflRedraftScheduleWeek`
 * (lib/schedule-runtime/resolveNflRedraftScheduleRuntime.ts), which both the hourly
 * `/api/cron/season-week-roll` and the commissioner's schedule route go through, right after it has
 * recomputed standings.
 *
 * THE ORDER IS THE LEAGUE'S OWN STANDINGS (owner's decision 2026-10-25), not a rule of this file's.
 * There is no single shared ranker, so it reuses the two real ones:
 *   - points / H2H leagues: the playoff runtime's ranking (`buildNflRedraftPlayoffRuntimeState`) —
 *     win %, then the commissioner's `tiebreaker_order` (or the league's configured tiebreakers),
 *     head-to-head, all-play and the seeded coin flip, with points-only seeding honoured. It is built
 *     with every team "qualifying" (`rulesWithPlayoffTeamOverride`, the bracket route's own override),
 *     so division-winner selection cannot pull a team out of standings order.
 *   - roto leagues (`settings.scoring_mode === 'roto'`, the check `updateStandings` uses): the
 *     category standings rank `updateStandings` just wrote to `RedraftRoster.playoffSeed`.
 *     That rank is also the fallback when the playoff runtime does not cover the league's format.
 *
 * SURVIVOR LEAGUES NEVER RESET (owner's decision 2026-10-25): their priority carries survivor boosts
 * (lib/survivor/survivorStealThree.ts) a reset would erase. The hub hides the option and the settings
 * patch refuses it; this is the last guard if a survivor league has it set anyway.
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

export type RedraftPriorityRow = { id: string; ownerId: string; waiverPriority?: number | null }

export type LeagueRosterRow = {
  id: string
  platformUserId: string
  redraftRosterId: string | null
  waiverPriority: number | null
}

/** Is this league's standings a roto (category) table? The check `updateStandings` ranks by. */
export function isRotoStandingsLeague(settings: unknown): boolean {
  return Boolean(settings && typeof settings === 'object' && (settings as Record<string, unknown>).scoring_mode === 'roto')
}

/** Redraft roster ids best first, from the standings rank `updateStandings` stores (1 = first place). */
export function orderByStoredStandingsRank(rows: ReadonlyArray<{ id: string; playoffSeed: number | null }>): string[] | null {
  const ranked = rows.filter((r) => typeof r.playoffSeed === 'number')
  if (ranked.length === 0) return null
  return [...ranked].sort((a, b) => a.playoffSeed! - b.playoffSeed! || a.id.localeCompare(b.id)).map((r) => r.id)
}

/**
 * The new priority for every row in both tables from a BEST-FIRST standings order: priority 1 is
 * the last-place team. A redraft roster missing from the order keeps its relative place behind the
 * ranked teams. A league roster is matched by `redraftRosterId`, else `platformUserId === ownerId`;
 * one with no match goes behind every matched team rather than jumping the queue.
 */
export function planWeeklyPriorityReset(input: {
  standingsBestFirst: readonly string[]
  redraftRosters: readonly RedraftPriorityRow[]
  leagueRosters: readonly LeagueRosterRow[]
}): { redraft: Array<{ id: string; waiverPriority: number }>; league: Array<{ id: string; waiverPriority: number }> } {
  const known = new Set(input.redraftRosters.map((r) => r.id))
  const ranked = [...input.standingsBestFirst].filter((id) => known.has(id)).reverse()
  const rankedSet = new Set(ranked)
  const unranked = input.redraftRosters
    .filter((r) => !rankedSet.has(r.id))
    .sort((a, b) => (a.waiverPriority ?? 999) - (b.waiverPriority ?? 999) || a.id.localeCompare(b.id))
    .map((r) => r.id)
  const order = [...ranked, ...unranked]
  const rank = new Map(order.map((id, i) => [id, i + 1]))
  const ownerToRedraft = new Map(input.redraftRosters.map((r) => [r.ownerId, r.id]))

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

/**
 * The league's standings, best first, from its own ranker (see the header). Null when there is
 * nothing ranked yet.
 */
export async function loadLeagueStandingsBestFirst(
  input: { seasonId: string; leagueSettings: unknown },
  db: typeof prisma = prisma,
): Promise<string[] | null> {
  const storedRank = async () =>
    orderByStoredStandingsRank(await db.redraftRoster.findMany({ where: { seasonId: input.seasonId }, select: { id: true, playoffSeed: true } }))
  if (isRotoStandingsLeague(input.leagueSettings)) return storedRank()
  const resolved = await resolveNflRedraftPlayoffRuntime({ seasonId: input.seasonId })
  if (!resolved.ok) return storedRank()
  const everyone = buildNflRedraftPlayoffRuntimeState({
    leagueId: resolved.state.leagueId,
    seasonId: resolved.state.seasonId,
    season: resolved.state.season,
    week: resolved.state.week,
    rules: rulesWithPlayoffTeamOverride(resolved.state, resolved.state.teams.length),
    teams: resolved.state.teams,
    regularSeasonMatchups: resolved.regularSeasonMatchups,
  })
  return everyone.teams.length ? everyone.teams.map((t) => t.rosterId) : storedRank()
}

type Db = typeof prisma
type ResetDeps = {
  db?: Db
  loadSettings?: (leagueId: string) => Promise<{ waiverOrderResetPolicy: string | null; normalizedWaiverType: string }>
  isSurvivor?: (leagueId: string, league: { survivorMode?: boolean | null }) => Promise<boolean>
  loadStandingsBestFirst?: (input: { seasonId: string; leagueSettings: unknown }) => Promise<string[] | null>
  now?: Date
}

export type WeeklyResetOutcome =
  | { applied: true; week: number; rostersReset: number }
  | {
      applied: false
      reason: 'policy_rolling' | 'waiver_type_not_priority' | 'survivor_league' | 'already_applied' | 'no_standings' | 'league_not_found'
    }

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

  const league = await db.league.findUnique({ where: { id: input.leagueId }, select: { settings: true, survivorMode: true } })
  if (!league) return { applied: false, reason: 'league_not_found' }
  const survivor = await (deps.isSurvivor ?? (async (id, l) => l.survivorMode === true || (await isSurvivorLeague(id))))(input.leagueId, league)
  if (survivor) return { applied: false, reason: 'survivor_league' }
  if (weeklyResetAlreadyApplied(readWeeklyResetMarker(league.settings), input.seasonId, input.week)) {
    return { applied: false, reason: 'already_applied' }
  }

  // Read-only and outside the transaction: the ranker resolves the whole playoff runtime.
  const standingsBestFirst = await (deps.loadStandingsBestFirst ?? ((i) => loadLeagueStandingsBestFirst(i, db)))({
    seasonId: input.seasonId,
    leagueSettings: league.settings,
  })
  if (!standingsBestFirst?.length) return { applied: false, reason: 'no_standings' }

  return db.$transaction(async (tx) => {
    // Re-checked inside the write: a run that finished meanwhile wins, and this one does nothing.
    const fresh = await tx.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
    if (!fresh) return { applied: false, reason: 'league_not_found' } as const
    if (weeklyResetAlreadyApplied(readWeeklyResetMarker(fresh.settings), input.seasonId, input.week)) {
      return { applied: false, reason: 'already_applied' } as const
    }

    const [redraftRosters, leagueRosters] = await Promise.all([
      tx.redraftRoster.findMany({ where: { seasonId: input.seasonId }, select: { id: true, ownerId: true, waiverPriority: true } }),
      tx.roster.findMany({
        where: { leagueId: input.leagueId },
        select: { id: true, platformUserId: true, redraftRosterId: true, waiverPriority: true },
      }),
    ])
    if (redraftRosters.length === 0) return { applied: false, reason: 'no_standings' } as const

    const plan = planWeeklyPriorityReset({ standingsBestFirst, redraftRosters, leagueRosters })
    for (const r of plan.redraft) await tx.redraftRoster.update({ where: { id: r.id }, data: { waiverPriority: r.waiverPriority } })
    for (const r of plan.league) await tx.roster.update({ where: { id: r.id }, data: { waiverPriority: r.waiverPriority } })

    const prev = fresh.settings && typeof fresh.settings === 'object' && !Array.isArray(fresh.settings)
      ? (fresh.settings as Record<string, unknown>)
      : {}
    const marker: WeeklyResetMarker = { seasonId: input.seasonId, week: input.week, at: (deps.now ?? new Date()).toISOString() }
    await tx.league.update({
      where: { id: input.leagueId },
      data: { settings: { ...prev, [WEEKLY_PRIORITY_RESET_SETTINGS_KEY]: marker } },
    })
    return { applied: true, week: input.week, rostersReset: plan.league.length } as const
  })
}
