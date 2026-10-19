/**
 * Roster housekeeping when a dynasty league's next season starts.
 *
 * 🛑 NOTHING RE-CHECKED A CARRIED ROSTER. `carryDynastyRostersForward` copies every player with
 * his `slotType` verbatim, so last year's rookie sat on the taxi squad into his second season and
 * a player who was healthy by September stayed on IR, with nothing ever asking whether either was
 * still allowed there. And the rookie draft ADDS to a full roster, so every team came out of it
 * over the league's roster size with nothing to say so.
 *
 * What this does, and deliberately no more:
 *
 *   taxi  → re-checked with the SAME rules lineup validation enforces
 *           (`validateTaxiSectionAgainstLeague`: rookie-only unless `taxiAllowNonRookies`,
 *           `taxiYearsLimit`), plus "taxi is not enabled". Ineligible → bench.
 *   IR    → re-checked with `validateIrSectionAgainstLeague` against the row's injury status.
 *           Ineligible → bench.
 *   size  → over `maxRosterSize` is FLAGGED, never cut. Dropping a player is a manager's decision;
 *           the existing lineup validation (`roster_over_max`) already refuses a lineup save from
 *           an over-limit roster, and that is the only block applied.
 *
 * ⚠ EXPERIENCE COMES FROM `SportsPlayer.yearsExp` AND IS ALLOWED TO BE UNKNOWN. A taxi player
 * whose experience is not on file stays where he is, exactly as the validator treats a row with no
 * `years_exp`: an unknown is not a non-rookie. Those are counted as `taxiUnverified` so the
 * commissioner can see how much the check could not reach. Today the seed fills `yearsExp` from the
 * Sleeper feed, so for NBA/NHL/MLB most taxi players will be unverified.
 *
 * Idempotent: a second run finds nothing left to move and recomputes the same flags.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  validateIrSectionAgainstLeague,
  validateTaxiSectionAgainstLeague,
} from '@/lib/roster-lineup-engine/rosterValidationService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { isDynastyFamilyLeague } from './carryDynastyRosters'

type ValidationLeague = LineupValidationContext['league']

const TAXI_SLOT_TOKENS = new Set(['TAXI'])
/** Injured-list slots. `NA` (MLB minors) is a roster designation, not an injury, so it is left alone. */
const IR_SLOT_TOKENS = new Set(['IR', 'RESERVE', 'IL', 'IL_PLUS'])

export type HousekeepingPlayer = {
  /** RedraftRosterPlayer.id */
  id: string
  playerId: string
  playerName: string
  slotType: string
  injuryStatus: string | null
}

export type HousekeepingRoster = {
  rosterId: string
  ownerId: string
  teamName: string | null
  players: HousekeepingPlayer[]
}

export type HousekeepingMove = {
  rowId: string
  rosterId: string
  playerId: string
  playerName: string
  from: string
  to: 'bench'
  reason: string
}

export type CutDownFlag = {
  rosterId: string
  ownerId: string
  teamName: string | null
  rosterCount: number
  maxRosterSize: number
  over: number
}

export type HousekeepingPlan = {
  moves: HousekeepingMove[]
  needsCutDown: CutDownFlag[]
  /** Taxi players left in place because their experience is not on file. */
  taxiUnverified: number
}

/**
 * Pure: decide every move and flag. `yearsExpByPlayerId` holds only KNOWN experience — absence
 * means unknown, never zero.
 */
export function planRolloverHousekeeping(input: {
  league: ValidationLeague
  rosters: HousekeepingRoster[]
  yearsExpByPlayerId: Map<string, number>
  maxRosterSize: number
}): HousekeepingPlan {
  const { league } = input
  const taxiEnabled = (league.taxiSlots ?? 0) > 0
  const plan: HousekeepingPlan = { moves: [], needsCutDown: [], taxiUnverified: 0 }

  for (const roster of input.rosters) {
    const taxi = roster.players.filter((p) => TAXI_SLOT_TOKENS.has(normalizeToken(p.slotType)))
    const ir = roster.players.filter((p) => IR_SLOT_TOKENS.has(normalizeToken(p.slotType)))
    const move = (p: HousekeepingPlayer, reason: string) =>
      plan.moves.push({
        rowId: p.id,
        rosterId: roster.rosterId,
        playerId: p.playerId,
        playerName: p.playerName,
        from: p.slotType,
        to: 'bench',
        reason,
      })

    if (!taxiEnabled) {
      for (const p of taxi) move(p, 'taxi_disabled')
    } else if (taxi.length > 0) {
      const rows = taxi.map((p) => {
        const years = input.yearsExpByPlayerId.get(p.playerId)
        if (years == null) plan.taxiUnverified += 1
        return { id: p.playerId, years_exp: years ?? null }
      })
      const issues = validateTaxiSectionAgainstLeague(league, { lineup_sections: { taxi: rows } })
      const reasonByPlayer = new Map<string, string>()
      for (const issue of issues) if (issue.playerId && !reasonByPlayer.has(issue.playerId)) reasonByPlayer.set(issue.playerId, issue.code)
      for (const p of taxi) {
        const reason = reasonByPlayer.get(p.playerId)
        if (reason) move(p, reason)
      }
    }

    if (ir.length > 0) {
      const rows = ir.map((p) => ({ id: p.playerId, status: p.injuryStatus ?? '' }))
      const issues = validateIrSectionAgainstLeague(league, { lineup_sections: { ir: rows } })
      const flagged = new Set(issues.map((i) => i.playerId).filter((x): x is string => Boolean(x)))
      for (const p of ir) if (flagged.has(p.playerId)) move(p, 'ir_ineligible_status')
    }

    // Moving a player to the bench never changes the count, so the flag reads the roster as it is.
    const rosterCount = roster.players.length
    if (input.maxRosterSize > 0 && rosterCount > input.maxRosterSize) {
      plan.needsCutDown.push({
        rosterId: roster.rosterId,
        ownerId: roster.ownerId,
        teamName: roster.teamName,
        rosterCount,
        maxRosterSize: input.maxRosterSize,
        over: rosterCount - input.maxRosterSize,
      })
    }
  }

  return plan
}

/** Known experience by player id. Sources that disagree about one player yield no answer. */
async function loadYearsExp(sports: string[], playerIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (playerIds.length === 0) return out
  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport: { in: sports },
        yearsExp: { not: null },
        OR: [{ id: { in: playerIds } }, { externalId: { in: playerIds } }, { sleeperId: { in: playerIds } }],
      },
      select: { id: true, externalId: true, sleeperId: true, yearsExp: true },
    })
    .catch(() => [])
  const wanted = new Set(playerIds)
  const seen = new Map<string, Set<number>>()
  for (const r of rows) {
    if (r.yearsExp == null) continue
    for (const key of new Set([r.id, r.externalId, r.sleeperId])) {
      if (!key || !wanted.has(key)) continue
      const set = seen.get(key) ?? new Set<number>()
      set.add(r.yearsExp)
      seen.set(key, set)
    }
  }
  for (const [key, values] of seen) if (values.size === 1) out.set(key, [...values][0]!)
  return out
}

export type RolloverHousekeepingResult = {
  seasonId: string
  ranAt: string
  movedToBench: HousekeepingMove[]
  needsCutDown: CutDownFlag[]
  taxiUnverified: number
  maxRosterSize: number
}

/** The key under `League.lifecycleMetadata` the commissioner surface reads. */
export const DYNASTY_ROLLOVER_METADATA_KEY = 'dynastyRollover'

/**
 * Apply the plan to one season's rosters and record the outcome on the league, where the
 * commissioner's "Start new season" panel reads it.
 */
export async function runDynastyRolloverHousekeeping(
  leagueId: string,
  seasonId: string,
  now: Date = new Date(),
): Promise<RolloverHousekeepingResult | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueVariant: true,
      settings: true,
      lifecycleState: true,
      lifecycleMetadata: true,
      lockAllMoves: true,
      irAllowOut: true,
      irAllowCovid: true,
      irAllowSuspended: true,
      irAllowNA: true,
      irAllowDNR: true,
      irAllowDoubtful: true,
      taxiSlots: true,
      taxiAllowNonRookies: true,
      taxiYearsLimit: true,
      guillotineMode: true,
      bestBallMode: true,
    },
  })
  const season = await prisma.redraftSeason.findUnique({ where: { id: seasonId }, select: { sport: true } })
  if (!league || !season) return null

  const rosters = await prisma.redraftRoster.findMany({
    where: { leagueId, seasonId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      ownerId: true,
      teamName: true,
      players: {
        where: { droppedAt: null },
        select: { id: true, playerId: true, playerName: true, slotType: true, injuryStatus: true },
      },
    },
  })

  const taxiIds = rosters.flatMap((r) =>
    r.players.filter((p) => TAXI_SLOT_TOKENS.has(normalizeToken(p.slotType))).map((p) => p.playerId),
  )
  const yearsExpByPlayerId = await loadYearsExp(
    [...new Set([String(league.sport), season.sport])],
    [...new Set(taxiIds)],
  )
  const { maxRosterSize } = resolveRedraftRosterConfig(season.sport, league.settings)

  const plan = planRolloverHousekeeping({
    league: league as unknown as ValidationLeague,
    rosters: rosters.map((r) => ({ rosterId: r.id, ownerId: r.ownerId, teamName: r.teamName, players: r.players })),
    yearsExpByPlayerId,
    maxRosterSize,
  })

  const applied: HousekeepingMove[] = []
  for (const m of plan.moves) {
    // Guarded on the slot it was read in, so a manager's own move in between is never overwritten.
    const res = await prisma.redraftRosterPlayer.updateMany({
      where: { id: m.rowId, droppedAt: null, slotType: m.from },
      data: { slotType: m.to },
    })
    if (res.count > 0) applied.push(m)
  }

  const result: RolloverHousekeepingResult = {
    seasonId,
    ranAt: now.toISOString(),
    movedToBench: applied,
    needsCutDown: plan.needsCutDown,
    taxiUnverified: plan.taxiUnverified,
    maxRosterSize,
  }

  const meta =
    league.lifecycleMetadata && typeof league.lifecycleMetadata === 'object' && !Array.isArray(league.lifecycleMetadata)
      ? (league.lifecycleMetadata as Record<string, unknown>)
      : {}
  // A re-run moves nothing, so keep the moves the first run made for the commissioner to see.
  const previous = meta[DYNASTY_ROLLOVER_METADATA_KEY] as Partial<RolloverHousekeepingResult> | undefined
  const movedToBench =
    previous?.seasonId === seasonId && Array.isArray(previous.movedToBench)
      ? [...previous.movedToBench, ...applied]
      : applied
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      lifecycleMetadata: {
        ...meta,
        [DYNASTY_ROLLOVER_METADATA_KEY]: { ...result, movedToBench },
      } as unknown as Prisma.InputJsonValue,
    },
  })

  return { ...result, movedToBench }
}

/**
 * The step every route into a dynasty league's next season shares: the rookie draft completing,
 * the commissioner starting the season, and the week roller starting it at kickoff.
 *
 * Only for a dynasty-family league whose season FOLLOWS a completed one — a first season is built
 * by its startup draft and has nothing carried to re-check. Anything else is a no-op, so a redraft
 * or keeper league passing through a shared path is untouched.
 */
export async function afterDynastyNewSeasonActivated(
  leagueId: string,
  seasonId: string,
  now: Date = new Date(),
): Promise<RolloverHousekeepingResult | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueType: true, isDynasty: true },
  })
  if (!league || !isDynastyFamilyLeague(league)) return null
  const season = await prisma.redraftSeason.findUnique({ where: { id: seasonId }, select: { createdAt: true } })
  if (!season) return null
  const prior = await prisma.redraftSeason.findFirst({
    where: { leagueId, status: 'complete', NOT: { id: seasonId }, createdAt: { lt: season.createdAt } },
    select: { id: true },
  })
  if (!prior) return null

  // The offseason flag `triggerKeeperOffseason` set; left at `offseason` the renewal prompt stays up.
  await prisma.league.update({ where: { id: leagueId }, data: { dynastySeasonPhase: 'regular' } })
  return runDynastyRolloverHousekeeping(leagueId, seasonId, now)
}
