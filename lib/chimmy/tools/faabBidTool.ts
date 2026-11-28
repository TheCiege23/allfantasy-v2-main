import 'server-only'

import { allocateFaabAcrossPool } from '@/lib/trade-intel/faabBid'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { createLeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { marketValuesFromLeagueChart } from '@/lib/trade-value-console/leagueChartValues'
import { marketContextFor } from '@/lib/trade-intel/marketContext'
import {
  assumedOneChopHorizon,
  scheduleForLeague,
  survivorHorizon,
  type SurvivorHorizon,
} from '@/lib/trade-intel/survivorSchedule'
import { describeSeats } from '@/lib/trade-intel/faabLineupGain'
import { lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { leagueContextFor } from '@/lib/core-app/leagueContext'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { loadDeclaredAvailability, type DeclaredAvailability } from '@/lib/core-app/declaredAvailability'
import { startingSlots } from '@/lib/core-app/slotEligibility'
import { prisma } from '@/lib/prisma'
import { boardGamesText, boardUnit, isBoardValueSport, loadLeagueValueBoard, type LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import { loadSeasonRateWaiverBoard } from '@/lib/waivers/seasonRateWaiverBoard'
import { waiverSportLabel, waiverSportPlan } from '@/lib/waivers/waiverSportBasis'
import type { FaabCandidate } from '@/lib/trade-intel/faabBid'
import {
  callerTradeSeat,
  faabPoolFor,
  readLeagueTradeRows,
  readTradePlayerRows,
  toDiscoveryPlayers,
  tradeRosterPlayerIds,
} from '@/lib/core-app/playerTradeVisual'

/**
 * `get_faab_bid_plan`: "should I spend FAAB this week, and how much?", for the user's team in the
 * league in scope. Asked live in a guillotine league on 2026-09-28, Chimmy had no way to answer it.
 * The calculator existed (`allocateFaabAcrossPool`, behind the Player Finder's bid card), but no
 * tool reached it.
 *
 * THE POOL IS EVERY VALUED PLAYER ON NOBODY'S ROSTER. Each is priced under the league's scoring and
 * measured by what he adds to the user's best legal lineup under the league's REAL starting slots,
 * by `faabPoolFor`, the same code as the Player Finder, so the two cannot disagree about a player.
 *
 * 🛑 THE FIRST VERSION ASSUMED 1 QB / 2 RB / 2 WR / 1 TE, and in a FLEX ×4 + SUPER_FLEX guillotine
 * (2026-09-28) it told a user with one receiver to bid $31 on Brian Thomas Jr.: the phantom second WR
 * seat made every free-agent receiver worth his FULL value. See `faabLineupGain.ts`. The fixed table
 * is now only a fallback for a league with no slots on file, and the block says when it was used.
 *
 * ⚠ A PLAIN GUILLOTINE WITH NO PUBLISHED SCHEDULE IS PACED at one chop a week from the teams still
 * alive (`assumedOneChopHorizon`). Unpaced, the same answer's ceilings summed to the user's whole
 * $200 in week 3 of a 16-team field.
 *
 * ⚠ DOLLARS ONLY IN AN ELIMINATION LEAGUE. The allocator's premise, stated in `faabBid.ts`, is that
 * released rosters are the ONLY supply and that future weeks' pools resemble this one; it was
 * calibrated on Survivor All-Stars Guillotine. In an ordinary waiver league the pool is deep and
 * refills from everywhere, so "this week's pool gets a week's share of your budget" is not advice.
 * There the tool ranks the upgrades and says why it gives no dollar figure.
 *
 * ⚠ UNROSTERED IS NOT CLAIMABLE, and the block says so (the same caution as
 * `get_available_players`): we cannot see waiver periods or pending claims.
 *
 * ⚠ THE BID IS AGAINST WHAT THE USER HAS LEFT (`rosters.faabRemaining`), never the league's season
 * budget. With no remaining figure on file it gives shares, and refuses the dollars.
 *
 * 🛑 THE MARKET CHART IS NFL-ONLY, AND IT IS KEYED BY SLEEPER ID — WHICH SLEEPER REUSES ACROSS SPORTS.
 * Before 2026-11-16 an NBA Sleeper league fell through to the NFL chart: its pool was NFL players nobody
 * in the league could roster, and any NBA id that happened to equal an NFL one was priced as him. A
 * league of another sport now never reads the chart. A sport on a league value board (NBA first) is
 * planned from that board — the Waivers board's own per-game lineup gain, times the games left, under
 * the league's own scoring — and any other sport is refused in words.
 */

/** Enough to act on; a longer list is noise the model will pad an answer with. */
const MAX_BIDS = 8

const money = (n: number) => `$${Math.round(n)}`

/** One genuine upgrade, as the plan prices it. */
export type FaabPlanBid = {
  id: string
  name: string
  position: string | null
  /** Dollars to bid up to — null outside an elimination league or with no remaining FAAB on file. */
  ceiling: number | null
  /** His share of this week's upgrade value, 0–1. */
  shareOfSupply: number
  /** What he adds to the best lineup (market-value units, never points). */
  marginalValue: number
  /** Who leaves the lineup for him; null when he fills an empty seat or the slots were assumed. */
  displacedName: string | null
}

/**
 * The plan as DATA, for surfaces that render or send it (the chat's bid card, the chop-release
 * alert) as well as for the model's text. `buildFaabBidContext` is a pure rendering of this, so
 * every surface reads the same numbers.
 */
export type FaabBidPlan =
  | { status: 'refused'; line: string }
  | {
      status: 'ok'
      /**
       * What every value in the plan measures: the NFL market chart's units, or — on a league value
       * board — this league's rest-of-season fantasy points (or category score) added to the lineup.
       */
      valueUnit: 'market' | 'fantasy points' | 'category score'
      /**
       * `no_pool`: nothing valued is unrostered. `no_calc`: the allocator refused the inputs.
       * `save`: nobody improves the lineup. `rank`: upgrades, no dollars (ordinary league).
       * `bid`: upgrades with a dollar ceiling or a share each (elimination league).
       */
      outcome: 'no_pool' | 'no_calc' | 'save' | 'rank' | 'bid'
      leagueName: string
      platform: string
      platformLeagueId: string | null
      concept: string
      elimination: boolean
      valuesSource: string
      valuesAsOf: string
      remaining: number | null
      seasonBudget: number | null
      /** "FLEX ×4, SUPER_FLEX", or null when a standard lineup had to be assumed. */
      seatsLabel: string | null
      /** The assumed one-chop pacing sentence, when that horizon was used. */
      horizonBasis: string | null
      allocReason: string | null
      rosteredCount: number
      /**
       * A pasted Yahoo league only: rostered players no Sleeper-id read can see. Each one's own row is
       * kept out of the pool by name; the count is said in the text.
       */
      unmatchedRostered?: number
      /** Every valued unrostered player the allocator priced. */
      pricedCount: number
      /** All genuine upgrades, best first — renderers cap the list themselves. */
      upgrades: FaabPlanBid[]
      nonUpgrades: number
    }

/** How many bids the model's text lists. */
export const FAAB_TEXT_MAX_BIDS = MAX_BIDS

/** Test seams for the league-value-board path. */
export type FaabPlanDeps = {
  valueBoard?: (leagueId: string) => Promise<LeagueValueBoard>
  waiverBoard?: typeof loadSeasonRateWaiverBoard
  now?: Date
}

const refuse = (line: string): FaabBidPlan => ({ status: 'refused', line })

export async function computeFaabBidPlan(leagueId: string, userId: string, deps: FaabPlanDeps = {}): Promise<FaabBidPlan> {
  const league = await leagueContextFor(leagueId, userId).league().catch(() => null)
  if (!league) return refuse('FAAB BID PLAN: the league in scope could not be read. Do not estimate bids.')
  /*
   * A pasted Yahoo league is read through its declared Sleeper ids — but only above the coverage bar,
   * and with its unmatched rostered players kept out of the pool (declaredAvailability.ts).
   */
  const declared: DeclaredAvailability | null = isForeignIdSpace(league.platform, league.sport)
    ? await loadDeclaredAvailability({ id: leagueId, platform: league.platform }).catch(() => null)
    : null
  if (declared && !declared.verified) {
    return refuse(
      `FAAB BID PLAN: ${declared.unmatched} player${declared.unmatched === 1 ? '' : 's'} on this league's rosters couldn't be matched to ours, so who is available cannot be verified. Say so; do not estimate bids or name anyone as available.`,
    )
  }
  // A native league of another sport holds Rolling Insights ids, and these values are NFL Sleeper ids.
  if (!declared && isForeignIdSpace(league.platform, league.sport)) {
    return refuse('FAAB BID PLAN: this platform\'s player ids are not readable here, so available players cannot be priced. Say so; do not estimate bids.')
  }
  // 🛑 Any sport but the NFL leaves here, before the NFL chart is read (see the header).
  const sport = String(league.sport ?? '').trim().toUpperCase() || 'NFL'
  if (sport !== 'NFL') return computeBoardFaabPlan(league, userId, sport, deps)

  const rows = await readLeagueTradeRows(leagueId).catch(() => null)
  if (!rows) return refuse('FAAB BID PLAN: the league\'s rosters could not be read. Do not estimate bids.')
  const { myRoster } = callerTradeSeat(rows, userId)
  if (!myRoster) return refuse('FAAB BID PLAN: the user has no claimed team in this league, so there is no lineup to bid for. Say so.')

  const leagueSize = rows.rosters.length || 12
  const marketContext = marketContextFor(league.settings, league.leagueType, leagueSize)
  /*
   * 🛑 THE GRADER'S PRICE (2026-11-26). Values come from the league chart `createLeagueTradeGrader`
   * prices every trade letter on (`marketValuesFromLeagueChart`), not from `marketValueService`'s own
   * FantasyCalc request — so "what is he worth to bid on" and "what is he worth in a trade" are one
   * number. The league was read through `leagueContextFor` above, which is the membership proof.
   */
  const grader = await createLeagueTradeGrader({ leagueId, userId }).catch(() => null)
  const values = grader ? marketValuesFromLeagueChart(grader.chart) : null
  if (!values) return refuse('FAAB BID PLAN: no player values are loaded for this league\'s format yet, so nobody can be priced. Say so; do not estimate bids.')

  const rostered = new Set(rows.rosters.flatMap((r) => tradeRosterPlayerIds(r)))
  const unrostered = Object.keys(values.bySleeperId).filter((id) => !rostered.has(id))
  const myIds = tradeRosterPlayerIds(myRoster)
  const byId = await readTradePlayerRows([...new Set([...myIds, ...unrostered])], league.sport)
  // A pasted Yahoo league's unmatched rostered player is somebody's, not a free agent.
  const candidateIds = declared
    ? unrostered.filter((id) => !declared.hides({ name: byId.get(id)?.name, position: byId.get(id)?.position }))
    : unrostered
  const leagueScoring = marketContext.scoring.settings
  const myPlayers = toDiscoveryPlayers(myRoster, byId, values, leagueScoring)
  const pool = faabPoolFor({ candidateIds, byId, values, leagueScoring, myPlayers, leagueSettings: league.settings })
  const seats = lineupSeatsFromSettings(league.settings)
  const displacedById = new Map(pool.map((c) => [c.id, c.displacedName ?? null]))

  const concept = readFormatRules({ leagueType: league.leagueType, isDynasty: marketContext.variant.dynasty, settings: league.settings }).concept
  const elimination = concept === 'guillotine' || concept === 'survivor'
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const budgetRaw = Number(settings.faab_budget)
  const remaining = typeof myRoster.faabRemaining === 'number' && Number.isFinite(myRoster.faabRemaining) ? myRoster.faabRemaining : null

  const base: PlanBase = {
    status: 'ok' as const,
    valueUnit: 'market',
    leagueName: String(league.name ?? ''),
    platform: String(league.platform ?? ''),
    platformLeagueId: league.platformLeagueId ?? null,
    concept,
    elimination,
    valuesSource: values.source,
    valuesAsOf: values.fetchedAt.slice(0, 10),
    remaining,
    seasonBudget: Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null,
    seatsLabel: seats ? describeSeats(seats) : null,
    rosteredCount: rostered.size,
    ...(declared ? { unmatchedRostered: declared.unmatched } : {}),
  }
  return finishPlan({ base, pool, rows, league, displacedById, seatsKnown: Boolean(seats) })
}

type PlanBase = Omit<Extract<FaabBidPlan, { status: 'ok' }>, 'outcome' | 'horizonBasis' | 'allocReason' | 'pricedCount' | 'upgrades' | 'nonUpgrades'>

/** The pool, paced and allocated — one path for the NFL chart and a league value board. */
async function finishPlan(args: {
  base: PlanBase
  pool: FaabCandidate[]
  rows: NonNullable<Awaited<ReturnType<typeof readLeagueTradeRows>>>
  league: { platformLeagueId: string | null }
  displacedById: ReadonlyMap<string, string | null>
  seatsKnown: boolean
  /**
   * What an empty pool means. On the NFL chart, nothing VALUED is unrostered (`no_pool`, a statement
   * about the chart). A league value board's pool holds only lineup upgrades, so there an empty pool
   * means nobody on the wire would start: save the FAAB.
   */
  emptyPool?: 'no_pool' | 'save'
}): Promise<FaabBidPlan> {
  const { base, pool, rows, league, displacedById } = args
  const { elimination, concept, remaining } = base
  const seats = args.seatsKnown
  const empty = { horizonBasis: null, allocReason: null, pricedCount: 0, upgrades: [], nonUpgrades: 0 }

  if (pool.length === 0) return { ...base, ...empty, outcome: args.emptyPool ?? 'no_pool' }

  /*
   * Paced against a PUBLISHED elimination schedule where one exists. A plain guillotine without one
   * is paced at one chop a week from the teams still alive (a chopped roster holds no players). A
   * survivor league without one stays unpaced — its elimination pattern is not one-a-week — and the
   * allocator labels that the aggressive read in its own reason.
   */
  let horizon: SurvivorHorizon | null = null
  let horizonBasis: string | null = null
  if (elimination) {
    const schedule = scheduleForLeague(league.platformLeagueId)
    const week = schedule ? await resolveCurrentWeekForLeague(league.platformLeagueId ?? '').catch(() => null) : null
    horizon = schedule && week ? survivorHorizon(schedule, week.week) : null
    if (!horizon && !schedule && concept === 'guillotine') {
      const alive = rows.rosters.filter((r) => tradeRosterPlayerIds(r).length > 0).length
      horizon = assumedOneChopHorizon(alive)
      if (horizon) horizonBasis = horizon.basis
    }
  }

  const alloc = allocateFaabAcrossPool({ pool, budgetRemaining: remaining ?? 0, horizon })
  if (!alloc) return { ...base, ...empty, horizonBasis, outcome: 'no_calc' }

  const upgrades: FaabPlanBid[] = alloc.bids
    .filter((b) => b.marginalValue > 0)
    .sort((a, b) => b.marginalValue - a.marginalValue)
    .map((b) => ({
      id: b.id,
      name: b.name,
      position: b.position,
      ceiling: elimination && remaining != null ? b.ceiling : null,
      shareOfSupply: b.shareOfSupply,
      marginalValue: b.marginalValue,
      displacedName: seats ? (displacedById.get(b.id) ?? null) : null,
    }))

  return {
    ...base,
    horizonBasis,
    allocReason: alloc.reason,
    pricedCount: alloc.bids.length,
    upgrades,
    nonUpgrades: alloc.bids.length - upgrades.length,
    outcome: upgrades.length === 0 ? 'save' : elimination ? 'bid' : 'rank',
  }
}

/** "PG, SG, G ×2, UTIL ×3" — a lineup's starting slots, counted. */
function slotsLabel(slots: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const slot of slots) counts.set(slot, (counts.get(slot) ?? 0) + 1)
  return [...counts].map(([slot, n]) => (n > 1 ? `${slot} ×${n}` : slot)).join(', ')
}

/**
 * The plan for a league of another sport. A league-value-board sport (NBA first) is planned from the
 * Waivers board's own answer — each free agent's per-game gain to the user's best legal lineup under the
 * league's own scoring — times the games left, so the bid and the "worth adding" row cannot disagree.
 * Any other sport has no value to bid with, and says so.
 */
async function computeBoardFaabPlan(
  league: NonNullable<Awaited<ReturnType<ReturnType<typeof leagueContextFor>['league']>>>,
  userId: string,
  sport: string,
  deps: FaabPlanDeps,
): Promise<FaabBidPlan> {
  const label = waiverSportLabel(sport)
  if (!isBoardValueSport(sport)) {
    return refuse(`FAAB BID PLAN: AllFantasy has no ${label} player values to bid with yet, so bids cannot be priced in this league. Say so; do not estimate bids, and never use NFL values.`)
  }
  const board = await (deps.valueBoard ?? loadLeagueValueBoard)(league.id).catch((): LeagueValueBoard => ({ kind: 'not_board_sport' }))
  if (board.kind !== 'ok') {
    const why = board.kind === 'unavailable' ? board.reason : 'it could not be read just now.'
    return refuse(`FAAB BID PLAN: this league's ${label} value board is not available — ${why} Say so; do not estimate bids.`)
  }
  const games = board.ctx.window.gamesRemaining
  if (!(games > 0)) {
    return refuse(`FAAB BID PLAN: the ${board.ctx.window.seasonLabel} ${label} regular season has no games left, so no pickup adds anything. Say so; do not estimate bids.`)
  }

  const rows = await readLeagueTradeRows(league.id).catch(() => null)
  if (!rows) return refuse('FAAB BID PLAN: the league\'s rosters could not be read. Do not estimate bids.')
  const { myRoster } = callerTradeSeat(rows, userId)
  if (!myRoster) return refuse('FAAB BID PLAN: the user has no claimed team in this league, so there is no lineup to bid for. Say so.')

  const wire = await (deps.waiverBoard ?? loadSeasonRateWaiverBoard)({
    prisma,
    league: { id: league.id, settings: league.settings, platform: league.platform },
    plan: waiverSportPlan(sport),
    userId,
    limit: 100,
    valueBoard: async () => board,
  }).catch(() => null)
  if (!wire) return refuse('FAAB BID PLAN: the waiver wire could not be read just now. Do not estimate bids.')
  if (wire.state !== 'ok') {
    const why = wire.notes[0] ?? `the waiver board could not be built (${wire.state.replace(/_/g, ' ')}).`
    return refuse(`FAAB BID PLAN: ${why} Say so; do not estimate bids.`)
  }

  /*
   * Rest-of-season gain: the per-game lift to the user's best lineup, times the games left. The board
   * already dropped every free agent who would not start, so each one here is an upgrade.
   */
  const pool: FaabCandidate[] = wire.candidates.map((c) => ({
    id: c.playerKey ?? c.name,
    name: c.name,
    position: c.position,
    playerValue: Math.round(c.gain * games),
    replacedValue: 0,
    displacedName: c.displaces?.name ?? null,
  }))

  const concept = readFormatRules({ leagueType: league.leagueType, isDynasty: Boolean(league.isDynasty), settings: league.settings }).concept
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const budgetRaw = Number(settings.faab_budget)
  const remaining = typeof myRoster.faabRemaining === 'number' && Number.isFinite(myRoster.faabRemaining) ? myRoster.faabRemaining : null
  const slots = startingSlots(league.settings)
  const base: PlanBase = {
    status: 'ok' as const,
    valueUnit: boardUnit(board.ctx),
    leagueName: String(league.name ?? ''),
    platform: String(league.platform ?? ''),
    platformLeagueId: league.platformLeagueId ?? null,
    concept,
    elimination: concept === 'guillotine' || concept === 'survivor',
    valuesSource: `this league's own ${label} value board (${board.ctx.window.seasonLabel}, ${boardGamesText(board.ctx.window)})`,
    valuesAsOf: (deps.now ?? new Date()).toISOString().slice(0, 10),
    remaining,
    seasonBudget: Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : null,
    seatsLabel: slots ? slotsLabel(slots) : null,
    rosteredCount: new Set(rows.rosters.flatMap((r) => tradeRosterPlayerIds(r))).size,
  }
  return finishPlan({ base, pool, rows, league, displacedById: new Map(pool.map((c) => [c.id, c.displacedName ?? null])), seatsKnown: true, emptyPool: 'save' })
}

/** The model's text for a plan. Pure; the wording is what the tool has always returned. */
export function renderFaabBidText(plan: FaabBidPlan): string {
  if (plan.status === 'refused') return plan.line

  const lines: string[] = [
    `FAAB BID PLAN — ${plan.concept} league, values from ${plan.valuesSource} as of ${plan.valuesAsOf}.`,
    plan.remaining != null
      ? `The user has ${money(plan.remaining)} FAAB left${plan.seasonBudget != null ? ` of a ${money(plan.seasonBudget)} season budget` : ''}.`
      : 'The user\'s remaining FAAB is NOT on file for this league. Give shares of the budget, never dollar amounts.',
    plan.seatsLabel
      ? `Upgrades are measured against the user's best legal starting lineup under this league's slots (${plan.seatsLabel}).`
      : 'This league\'s starting slots are NOT on file, so a standard 1 QB / 2 RB / 2 WR / 1 TE lineup is ASSUMED. Say so: in a FLEX or SUPER_FLEX league the real upgrades can be very different.',
  ]
  if (plan.unmatchedRostered) {
    lines.push(
      `${plan.unmatchedRostered} player${plan.unmatchedRostered === 1 ? '' : 's'} on this league's rosters couldn't be matched to ours; they are kept out of this list. Say so when naming bids.`,
    )
  }
  const onBoard = plan.valueUnit !== 'market'

  if (plan.outcome === 'no_pool') {
    lines.push(
      `No valued player is on nobody's roster (${plan.rosteredCount} rostered). That is a statement about our value chart, not proof the waiver wire is empty: tell the user nothing ranked is available and that deeper names need checking on their platform.`,
    )
    return lines.join('\n')
  }
  if (plan.horizonBasis) lines.push(plan.horizonBasis)
  if (plan.outcome === 'no_calc') return [...lines, 'The bid calculation could not run on this data. Do not estimate bids.'].join('\n')

  if (plan.outcome === 'save') {
    lines.push(
      plan.pricedCount === 0
        ? 'No free agent would improve the user\'s starting lineup. The answer is: do not spend FAAB this week; save it.'
        : `None of the ${plan.pricedCount} valued unrostered players would improve the user's starting lineup. The answer is: do not spend FAAB this week; save it.`,
    )
    return lines.join('\n')
  }

  /* What he does to the lineup, in words the model cannot turn into "his value over a WR". */
  const effect = (b: FaabPlanBid) => {
    if (!plan.seatsLabel) return `adds ${b.marginalValue} value over the user's weakest ${b.position} starter (assumed lineup)`
    return b.displacedName
      ? `would start in place of ${b.displacedName}, raising the best lineup's value by ${b.marginalValue}`
      : `fills an empty starting seat, raising the best lineup's value by ${b.marginalValue}`
  }

  if (plan.outcome === 'bid') {
    if (plan.allocReason) lines.push(plan.allocReason)
    for (const b of plan.upgrades.slice(0, MAX_BIDS)) {
      const dollars = b.ceiling != null ? `bid up to ${money(b.ceiling)}` : `${Math.round(b.shareOfSupply * 100)}% of this week's share`
      lines.push(`- ${b.name} (${b.position}): ${dollars}; ${effect(b)}, ${Math.round(b.shareOfSupply * 100)}% of the upgrade value on offer.`)
    }
  } else {
    lines.push(
      `This is not an elimination league, so NO dollar amounts: the bid sizing assumes released rosters are the only supply, which is false in an ordinary waiver league with a deep, refilling pool. Rank these upgrades for the user and let them set bids from their league's usual prices.`,
    )
    for (const b of plan.upgrades.slice(0, MAX_BIDS)) {
      lines.push(`- ${b.name} (${b.position}): ${effect(b)}.`)
    }
  }
  if (plan.upgrades.length > MAX_BIDS) lines.push(`(${plan.upgrades.length - MAX_BIDS} smaller upgrades not listed.)`)
  if (plan.nonUpgrades > 0) lines.push(`${plan.nonUpgrades} other valued unrostered players would not improve the lineup: bid nothing on them.`)
  lines.push(
    onBoard
      ? `Unrostered is not the same as claimable: we cannot see waiver periods or pending claims, so confirm on the platform. Values are rest-of-season ${plan.valueUnit} added to the user's best lineup (per-game gain × games left) under this league's own scoring — not the NFL market chart, and not this week's projection.`
      : 'Unrostered is not the same as claimable: we cannot see waiver periods or pending claims, so confirm on the platform. Values are long-term market-value units under this league\'s scoring — not fantasy points and not this week\'s projection; never call them points.',
  )
  return lines.join('\n')
}

export async function buildFaabBidContext(leagueId: string, userId: string): Promise<string> {
  return renderFaabBidText(await computeFaabBidPlan(leagueId, userId))
}
