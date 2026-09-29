import type { PrismaClient } from '@prisma/client'

import { findMyRoster } from '@/lib/core-app/myRoster'
import { canFillSlotForSport, isStartableInSport } from '@/lib/core-app/sportSlotEligibility'
import { startingSlots } from '@/lib/core-app/slotEligibility'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'

import {
  allRosterIds,
  leagueIdColumn,
  leagueIdOf,
  loadIdentityForKeys,
  loadSeasonRatePool,
  loadSeasonRateRows,
  newestSeasonRateSeason,
  priceSeasonRate,
  resolveRosterIdsToKeys,
  SEASON_RATE_ID_FLOOR,
} from './seasonRatePool'
import { bestLineup, type Scored, type WaiverBoard, type WaiverBoardState, type WaiverCandidate } from './waiverBoard'
import { noSeasonProjectionsReason, waiverBasisSentence, waiverSportLabel, type WaiverSportPlan } from './waiverSportBasis'

/**
 * The one-league "Worth adding" board for the sports priced on a SEASON RATE — NBA, NCAAB, NHL,
 * MLB and NCAAF. `loadWaiverBoard` hands over here for any league whose sport is not the NFL; the
 * NFL path there is untouched.
 *
 * Same question, same answer shape: solve your best lineup, solve it again with the candidate, and
 * the difference is what he is worth to you — marginal, so flex handling falls out without a rule.
 * What differs is only where the numbers come from, and every board says which:
 *
 *   - the value is a PER-GAME rate from AllFantasy's season projection (`AFProjectionSnapshot`,
 *     season-baseline rows), not a weekly projection — no such row exists outside the NFL;
 *   - college football is re-scored under the league's own `scoring_settings`; the category sports
 *     use AllFantasy's default scoring (see waiverSportBasis.ts for why a league re-score would be
 *     partial there, which is worse than a stated default);
 *   - ids are hopped through the league's own identity column and never read as Sleeper ids.
 */

/** How many projected players to consider. Well past the depth of any real wire. */
export const SEASON_RATE_POOL = 600

const empty = (
  state: WaiverBoardState,
  plan: WaiverSportPlan,
  notes: string[] = [],
  season: number | null = null,
): WaiverBoard => ({
  state,
  season: season != null ? String(season) : null,
  week: null,
  currentLineupPoints: null,
  candidates: [],
  notes,
  sport: plan.sport,
  ...(plan.kind === 'per_game' ? { basis: plan.basis } : {}),
})

export async function loadSeasonRateWaiverBoard(args: {
  prisma: PrismaClient
  league: { id: string; settings: unknown; platform: string | null }
  plan: WaiverSportPlan
  userId: string
  limit: number
}): Promise<WaiverBoard> {
  const { prisma, league, plan, userId, limit } = args
  const label = waiverSportLabel(plan.sport)

  if (plan.kind !== 'per_game') {
    return empty('no_producer', plan, plan.kind === 'none' ? [plan.reason] : [])
  }
  const sport = plan.sport
  const basis = plan.basis

  const scoring = extractScoringSettings(league.settings)
  if (basis === 'season_per_game_league' && !scoring) return empty('no_scoring_settings', plan)

  const slots = startingSlots(league.settings)
  if (!slots || slots.length === 0) return empty('no_slots', plan)

  const mine = await findMyRoster(prisma, league.id, userId)
  if (!mine.found) return empty(mine.reason === 'no_team_claimed' ? 'no_team_claimed' : 'no_roster', plan)
  const myIds = allRosterIds(mine.playerData)
  if (myIds.length === 0) return empty('no_roster', plan)

  const column = leagueIdColumn(league.platform)
  const unreadable = `This league's ${label} player ids can't be matched to our projections yet, so free agents cannot be told apart from rostered players.`
  if (!column) return empty('ids_unreadable', plan, [unreadable])

  const season = await newestSeasonRateSeason(prisma, sport)
  if (season == null) return empty('no_projections', plan, [noSeasonProjectionsReason(sport)])

  const myKeys = await resolveRosterIdsToKeys(prisma, sport, column, myIds)
  if (myKeys.size / myIds.length < SEASON_RATE_ID_FLOOR) return empty('ids_unreadable', plan, [unreadable], season)

  /* Everyone rostered anywhere in the league, in the LEAGUE's id space — the only space a roster speaks. */
  const allRosters = await prisma.roster
    .findMany({ where: { leagueId: league.id }, select: { playerData: true } })
    .catch(() => [] as Array<{ playerData: unknown }>)
  const taken = new Set<string>(myIds)
  for (const r of allRosters) for (const id of allRosterIds(r.playerData)) taken.add(id)

  const [pool, rosterRows] = await Promise.all([
    loadSeasonRatePool(prisma, sport, season, SEASON_RATE_POOL),
    loadSeasonRateRows(prisma, sport, season, [...myKeys.values()]),
  ])
  const identity = await loadIdentityForKeys(prisma, sport, pool.map((r) => r.key))

  const fits = (slot: string, position: string | null) => canFillSlotForSport(sport, slot, position)

  const roster: Scored[] = []
  for (const key of new Set(myKeys.values())) {
    const row = rosterRows.get(key)
    if (!row) continue
    const pts = priceSeasonRate(row, basis, scoring)
    if (pts == null) continue
    roster.push({ sleeperId: key, name: row.name, position: row.position, team: null, points: Math.round(pts * 100) / 100 })
  }
  if (roster.length === 0) {
    return empty('no_projections', plan, [`None of your rostered players has a ${label} season projection we can price here.`], season)
  }

  const myKeySet = new Set(myKeys.values())
  let unprovable = 0
  let ineligible = 0
  const candidatesPool: Scored[] = []
  for (const row of pool) {
    if (myKeySet.has(row.key)) continue
    const leagueId = leagueIdOf(identity.get(row.key), column)
    if (!leagueId) {
      // Cannot be looked for on this league's rosters, so cannot be called a free agent.
      unprovable++
      continue
    }
    if (taken.has(leagueId)) continue
    if (!isStartableInSport(sport, slots, row.position)) {
      ineligible++
      continue
    }
    const pts = priceSeasonRate(row, basis, scoring)
    if (pts == null) continue
    candidatesPool.push({
      sleeperId: row.key,
      name: row.name,
      position: row.position,
      team: identity.get(row.key)?.team ?? null,
      points: Math.round(pts * 100) / 100,
    })
  }

  const base = bestLineup(roster, slots, fits)
  const candidates: WaiverCandidate[] = []
  for (const cand of candidatesPool) {
    const withCand = bestLineup([...roster, cand], slots, fits)
    const gain = Math.round((withCand.total - base.total) * 100) / 100
    if (gain <= 0) continue
    const dropped = roster.find((p) => base.used.has(p.sleeperId) && !withCand.used.has(p.sleeperId))
    candidates.push({
      // 🛑 Not a Sleeper id and never labelled one: the projection key rides in `playerKey`.
      sleeperId: null,
      playerKey: cand.sleeperId,
      name: cand.name,
      position: cand.position,
      team: cand.team,
      projectedPoints: cand.points,
      gain,
      displaces: dropped
        ? { sleeperId: null, playerKey: dropped.sleeperId, name: dropped.name, projectedPoints: dropped.points }
        : null,
      basis: 'season_rate',
    })
  }
  candidates.sort((a, b) => b.gain - a.gain)

  const notes: string[] = [
    `Ranked by how much each adds to your best starting lineup per game, not by raw projection — ` +
      `a big name who would not crack your lineup is worth nothing here.`,
    waiverBasisSentence(basis, sport),
  ]
  if (candidates.length > limit) {
    notes.push(`${candidates.length} free agents would improve your lineup; showing the top ${limit}.`)
  }
  if (unprovable > 0) {
    notes.push(
      `${unprovable} projected ${label} players could not be matched to this league's player ids, so we cannot tell ` +
        `whether they are free agents and they are not shown.`,
    )
  }
  if (ineligible > 0) {
    notes.push(`${ineligible} other projected players were skipped because no slot in this league can hold them.`)
  }

  return {
    state: 'ok',
    season: String(season),
    week: null,
    currentLineupPoints: base.total,
    candidates: candidates.slice(0, limit),
    notes,
    sport,
    basis,
  }
}
