import 'server-only'

import { allocateFaabAcrossPool } from '@/lib/trade-intel/faabBid'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
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
 */

/** Enough to act on; a longer list is noise the model will pad an answer with. */
const MAX_BIDS = 8

const money = (n: number) => `$${Math.round(n)}`

export async function buildFaabBidContext(leagueId: string, userId: string): Promise<string> {
  const league = await leagueContextFor(leagueId, userId).league().catch(() => null)
  if (!league) return 'FAAB BID PLAN: the league in scope could not be read. Do not estimate bids.'
  if (isForeignIdSpace(league.platform)) {
    return 'FAAB BID PLAN: this platform\'s player ids are not readable here, so available players cannot be priced. Say so; do not estimate bids.'
  }

  const rows = await readLeagueTradeRows(leagueId).catch(() => null)
  if (!rows) return 'FAAB BID PLAN: the league\'s rosters could not be read. Do not estimate bids.'
  const { myRoster } = callerTradeSeat(rows, userId)
  if (!myRoster) return 'FAAB BID PLAN: the user has no claimed team in this league, so there is no lineup to bid for. Say so.'

  const leagueSize = rows.rosters.length || 12
  const marketContext = marketContextFor(league.settings, league.leagueType, leagueSize)
  const values = await getMarketValues(marketContext).catch(() => null)
  if (!values) return 'FAAB BID PLAN: no player values are loaded for this league\'s format yet, so nobody can be priced. Say so; do not estimate bids.'

  const rostered = new Set(rows.rosters.flatMap((r) => tradeRosterPlayerIds(r)))
  const candidateIds = Object.keys(values.bySleeperId).filter((id) => !rostered.has(id))
  const myIds = tradeRosterPlayerIds(myRoster)
  const byId = await readTradePlayerRows([...new Set([...myIds, ...candidateIds])])
  const leagueScoring = marketContext.scoring.settings
  const myPlayers = toDiscoveryPlayers(myRoster, byId, values, leagueScoring)
  const pool = faabPoolFor({ candidateIds, byId, values, leagueScoring, myPlayers, leagueSettings: league.settings })
  const seats = lineupSeatsFromSettings(league.settings)
  const displacedById = new Map(pool.map((c) => [c.id, c.displacedName ?? null]))

  const concept = readFormatRules({ leagueType: league.leagueType, isDynasty: marketContext.variant.dynasty, settings: league.settings }).concept
  const elimination = concept === 'guillotine' || concept === 'survivor'
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const seasonBudget = Number(settings.faab_budget)
  const remaining = typeof myRoster.faabRemaining === 'number' && Number.isFinite(myRoster.faabRemaining) ? myRoster.faabRemaining : null

  const lines: string[] = [
    `FAAB BID PLAN — ${concept} league, values from ${values.source} as of ${values.fetchedAt.slice(0, 10)}.`,
    remaining != null
      ? `The user has ${money(remaining)} FAAB left${Number.isFinite(seasonBudget) && seasonBudget > 0 ? ` of a ${money(seasonBudget)} season budget` : ''}.`
      : 'The user\'s remaining FAAB is NOT on file for this league. Give shares of the budget, never dollar amounts.',
    seats
      ? `Upgrades are measured against the user's best legal starting lineup under this league's slots (${describeSeats(seats)}).`
      : 'This league\'s starting slots are NOT on file, so a standard 1 QB / 2 RB / 2 WR / 1 TE lineup is ASSUMED. Say so: in a FLEX or SUPER_FLEX league the real upgrades can be very different.',
  ]

  if (pool.length === 0) {
    lines.push(
      `No valued player is on nobody's roster (${rostered.size} rostered). That is a statement about our value chart, not proof the waiver wire is empty: tell the user nothing ranked is available and that deeper names need checking on their platform.`,
    )
    return lines.join('\n')
  }

  /*
   * Paced against a PUBLISHED elimination schedule where one exists. A plain guillotine without one
   * is paced at one chop a week from the teams still alive (a chopped roster holds no players). A
   * survivor league without one stays unpaced — its elimination pattern is not one-a-week — and the
   * allocator labels that the aggressive read in its own reason.
   */
  let horizon: SurvivorHorizon | null = null
  if (elimination) {
    const schedule = scheduleForLeague(league.platformLeagueId)
    const week = schedule ? await resolveCurrentWeekForLeague(league.platformLeagueId ?? '').catch(() => null) : null
    horizon = schedule && week ? survivorHorizon(schedule, week.week) : null
    if (!horizon && !schedule && concept === 'guillotine') {
      const alive = rows.rosters.filter((r) => tradeRosterPlayerIds(r).length > 0).length
      horizon = assumedOneChopHorizon(alive)
      if (horizon) lines.push(horizon.basis)
    }
  }

  const alloc = allocateFaabAcrossPool({ pool, budgetRemaining: remaining ?? 0, horizon })
  if (!alloc) return [...lines, 'The bid calculation could not run on this data. Do not estimate bids.'].join('\n')

  const upgrades = alloc.bids.filter((b) => b.marginalValue > 0).sort((a, b) => b.marginalValue - a.marginalValue)
  const nonUpgrades = alloc.bids.length - upgrades.length

  if (upgrades.length === 0) {
    lines.push(
      `None of the ${alloc.bids.length} valued unrostered players would improve the user's starting lineup. The answer is: do not spend FAAB this week; save it.`,
    )
    return lines.join('\n')
  }

  /* What he does to the lineup, in words the model cannot turn into "his value over a WR". */
  const effect = (b: { id: string; position: string | null; marginalValue: number }) => {
    if (!seats) return `adds ${b.marginalValue} value over the user's weakest ${b.position} starter (assumed lineup)`
    const out = displacedById.get(b.id)
    return out
      ? `would start in place of ${out}, raising the best lineup's value by ${b.marginalValue}`
      : `fills an empty starting seat, raising the best lineup's value by ${b.marginalValue}`
  }

  if (elimination) {
    lines.push(alloc.reason)
    for (const b of upgrades.slice(0, MAX_BIDS)) {
      const dollars = remaining != null ? `bid up to ${money(b.ceiling)}` : `${Math.round(b.shareOfSupply * 100)}% of this week's share`
      lines.push(`- ${b.name} (${b.position}): ${dollars}; ${effect(b)}, ${Math.round(b.shareOfSupply * 100)}% of the upgrade value on offer.`)
    }
  } else {
    lines.push(
      `This is not an elimination league, so NO dollar amounts: the bid sizing assumes released rosters are the only supply, which is false in an ordinary waiver league with a deep, refilling pool. Rank these upgrades for the user and let them set bids from their league's usual prices.`,
    )
    for (const b of upgrades.slice(0, MAX_BIDS)) {
      lines.push(`- ${b.name} (${b.position}): ${effect(b)}.`)
    }
  }
  if (upgrades.length > MAX_BIDS) lines.push(`(${upgrades.length - MAX_BIDS} smaller upgrades not listed.)`)
  if (nonUpgrades > 0) lines.push(`${nonUpgrades} other valued unrostered players would not improve the lineup: bid nothing on them.`)
  lines.push(
    'Unrostered is not the same as claimable: we cannot see waiver periods or pending claims, so confirm on the platform. Values are long-term market-value units under this league\'s scoring — not fantasy points and not this week\'s projection; never call them points.',
  )
  return lines.join('\n')
}
