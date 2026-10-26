/**
 * Sleeper-style free agency — the commissioner's "Waivers, then free agents" option
 * (`waiverEngineConfig.free_agency_mode = 'after_run'`, lib/waiver-wire/hub-waiver-options.ts).
 *
 * It is a MODE of the add/drop decision, not a second waiver system: claims, the run, its order
 * (FAAB / rolling / reverse standings) and the processor are the league's own, unchanged. What it
 * decides is only whether a player nobody rosters is an instant add right now:
 *
 *   - before the league's first waiver run after its draft, every player is on waivers;
 *   - once a run has cleared, every unclaimed player is a free agent, first come first served;
 *   - a player whose game has started since that run is locked and back on waivers until the next;
 *   - a dropped player still serves the league's waiver period (dropped-player-waivers.ts, #2719);
 *   - a player named by a pending claim stays on waivers until that claim's run, so the claim wins
 *     (#2728) — an add never beats a claim to him.
 *
 * "On waivers" means the add/drop route answers WAIVER_REQUIRED, and the screens open the claim form.
 *
 * ⚠ A RUN COUNTS AS CLEARED AT ITS SCHEDULED TIME, NOT ONLY WHEN THE PROCESSOR WROTE ONE. The
 * processor records no run when no claim is pending, so `lastRunAt` alone would keep a quiet league
 * on waivers forever. A player with a claim on him is held by the claim either way, so counting the
 * scheduled time loses nobody a claim.
 *
 * ⚠ A PLAYER WITH NO TEAM, OR A TEAM WITH NO GAME ON FILE, HAS NO GAME TO LOCK HIM — the same
 * fail-open the lineup lock applies to a bye (lib/redraft/lineupLock.ts). A FAILED read is different:
 * the route turns any throw here into "claim required", never into a free add.
 *
 * Product decision (Sleeper's default, reported to the owner): the run day(s) and time are the
 * league's own schedule. The mode does not change them — NBA / NHL / MLB keep their sport default
 * (Mon / Wed / Fri) unless the commissioner picks others; Sleeper's own default there is a daily run.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { loadLeagueWeekContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { computePreviousWaiverRunAtUtc, type NextRunInput } from './next-waiver-run'
import { getLeagueWaiverState } from './waiver-state-service'

export const AFTER_RUN_AWAITING_FIRST_RUN_MESSAGE =
  "This player is on waivers until the league's first waiver run. Submit a claim; after the run, unclaimed players are free agents."

export const AFTER_RUN_GAME_STARTED_MESSAGE =
  "This player's game has started, so he is on waivers until the next waiver run. Submit a claim."

export type AfterRunFreeAgencyState =
  | { onWaivers: false; clearedAt: Date }
  | { onWaivers: true; reason: 'awaiting_first_run' | 'game_started'; clearedAt: Date | null }

/** The latest of two instants that are not after `now`, or null. */
function latestNotAfter(now: Date, ...instants: Array<Date | null | undefined>): Date | null {
  let out: Date | null = null
  for (const t of instants) {
    if (!t || !Number.isFinite(t.getTime()) || t.getTime() > now.getTime()) continue
    if (!out || t.getTime() > out.getTime()) out = t
  }
  return out
}

/**
 * Pure: whether a player nobody rosters is on waivers under the after-run mode.
 *
 * `seasonStartedAt` is the league's draft completion: a run before it belongs to last season, so
 * the league waits for its first run after the draft. `gameStartedAt` is his team's latest game
 * start at or before `now`, or null when none is known.
 */
export function afterRunFreeAgencyState(input: {
  now: Date
  lastRunAt: Date | null
  lastScheduledRunAt: Date | null
  seasonStartedAt: Date | null
  gameStartedAt: Date | null
}): AfterRunFreeAgencyState {
  const clearedAt = latestNotAfter(input.now, input.lastRunAt, input.lastScheduledRunAt)
  if (!clearedAt || (input.seasonStartedAt && clearedAt.getTime() < input.seasonStartedAt.getTime())) {
    return { onWaivers: true, reason: 'awaiting_first_run', clearedAt: null }
  }
  const game = input.gameStartedAt
  if (game && game.getTime() > clearedAt.getTime() && game.getTime() <= input.now.getTime()) {
    return { onWaivers: true, reason: 'game_started', clearedAt }
  }
  return { onWaivers: false, clearedAt }
}

export function afterRunRefusalMessage(state: AfterRunFreeAgencyState): string | null {
  if (!state.onWaivers) return null
  return state.reason === 'game_started' ? AFTER_RUN_GAME_STARTED_MESSAGE : AFTER_RUN_AWAITING_FIRST_RUN_MESSAGE
}

/**
 * His team's latest game start at or before `now`, read from the same kickoff map the lineup lock
 * uses, over this fantasy week and the one before (a Thursday game in week N still holds him on the
 * Tuesday the week rolls to N+1, before Wednesday's run).
 */
export async function latestTeamGameStartAt(
  db: PrismaClient,
  args: { sport: string; season: number; week: number; team: string | null | undefined; now: Date },
): Promise<Date | null> {
  if (!args.team) return null
  const keys = lockTeamLookupKeys(args.sport, args.team)
  if (keys.length === 0) return null
  let latest: Date | null = null
  for (const week of [args.week, args.week - 1]) {
    if (week < 1) continue
    const map = await buildWeekKickoffMap(db, { sport: args.sport, season: args.season, week })
    const candidates: Date[] = []
    for (const key of keys) {
      const first = map.byTeam.get(key)
      if (first) candidates.push(first)
      const days = map.byTeamDay?.get(key)
      if (days) candidates.push(...days.values())
    }
    latest = latestNotAfter(args.now, latest, ...candidates)
  }
  return latest
}

/**
 * The after-run state for one player in one league. Throws on a failed read; the caller fails
 * CLOSED (a claim is required).
 */
export async function loadAfterRunFreeAgencyState(
  leagueId: string,
  playerId: string,
  schedule: NextRunInput,
  now: Date = new Date(),
): Promise<AfterRunFreeAgencyState> {
  const [league, state, draft, player, redraftSeason] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } }),
    getLeagueWaiverState(leagueId),
    prisma.draftSession.findFirst({
      where: { leagueId, status: 'completed', completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
    prisma.sportsPlayer.findFirst({ where: { id: playerId }, select: { team: true } }),
    prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      select: { season: true, currentWeek: true },
    }),
  ])
  const lastRunAt = state?.lastRunAt ? new Date(state.lastRunAt) : null
  const lastScheduledRunAt = computePreviousWaiverRunAtUtc(now, schedule)
  const seasonStartedAt = draft?.completedAt ? new Date(draft.completedAt) : null

  const base = afterRunFreeAgencyState({ now, lastRunAt, lastScheduledRunAt, seasonStartedAt, gameStartedAt: null })
  // Already on waivers, or nobody to look a game up for: no schedule read needed.
  if (base.onWaivers || !player?.team || !league?.sport) return base

  const ctx = redraftSeason?.currentWeek
    ? { season: redraftSeason.season, week: redraftSeason.currentWeek }
    : await loadLeagueWeekContext(leagueId, league.settings, league.season ?? now.getUTCFullYear())
  const gameStartedAt = await latestTeamGameStartAt(prisma as unknown as PrismaClient, {
    sport: league.sport,
    season: ctx.season,
    week: ctx.week,
    team: player.team,
    now,
  })
  return afterRunFreeAgencyState({ now, lastRunAt, lastScheduledRunAt, seasonStartedAt, gameStartedAt })
}
