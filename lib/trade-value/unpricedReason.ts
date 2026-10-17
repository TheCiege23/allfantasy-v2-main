/**
 * Why a trade asset carries no value — the words the Trade Center prints beside "Unpriced".
 *
 * An unpriced asset has always rendered as an em dash, never a zero, and the builder counts it
 * toward "N unpriced". What it never said was WHY, and the reasons are not interchangeable: a
 * defender may have a league-derived value despite being absent from the market feed,
 * and a player we could not identify needs a different search. Measured on staging 2026-09-16,
 * 11,920 of 67,879 rostered players (17.6%) showed a dash on the roster list:
 *
 *     defender                6,153      the feed prices QB/RB/WR/TE and picks, nothing else
 *     not on the feed list    3,579      the feed carries ~420 players
 *     not identified            792
 *     kicker                    715
 *     team defense              563
 *     college player            118
 *
 * ⚠ CLIENT-SAFE ON PURPOSE. The roster route and the search route attach a reason on the server,
 * and the builder derives one on the client for a line the ANALYSIS could not price — so one rule
 * serves both, and a player cannot be explained two different ways on one screen.
 *
 * ⚠ ORDER IS THE RULE. A player we could not identify has no position to reason about, so that
 * comes first; a sport with no feed at all outranks anything about the player; a defender is
 * unpriced whether or not the feed loaded, so position outranks an outage; only an identified NFL
 * skill player can be "not on the list".
 */
import { isIdpPosition } from '@/lib/core-app/scoringNotes'
import { isKickerPosition } from '@/lib/af-projections/kickerScoring'

export type UnpricedReasonCode =
  | 'unidentified'
  | 'no_feed_for_sport'
  | 'defender'
  | 'kicker'
  | 'team_defense'
  | 'feed_unavailable'
  | 'not_on_feed'
  | 'no_value_on_file'
  | 'pick_without_round'
  | 'priced_on_analysis'
  | 'idp_no_history'
  | 'idp_insufficient_sample'
  | 'idp_no_defensive_production'
  | 'idp_replacement_unavailable'
  | 'idp_scoring_unavailable'
  | 'ambiguous_identity'
  | 'no_pick_market'

export type UnpricedReason = { code: UnpricedReasonCode; label: string }

/** Projection refusals describe this player, rather than the offence-only market feed. */
export function idpProjectionUnpricedReason(
  cause: 'no_history' | 'insufficient_sample' | 'no_defensive_production' | 'not_idp_position' | 'history_unavailable',
): UnpricedReason {
  if (cause === 'history_unavailable') return reason('feed_unavailable', 'Defensive history could not be loaded — try again shortly')
  if (cause === 'no_history') return reason('idp_no_history', 'No defensive game history on file for this player')
  if (cause === 'insufficient_sample') return reason('idp_insufficient_sample', 'Too few recorded games to estimate a reliable defensive value')
  if (cause === 'no_defensive_production') return reason('idp_no_defensive_production', 'Recorded games contain no defensive production to project')
  return reason('unidentified', 'Player records do not resolve to a defensive position')
}

export function idpReplacementUnpricedReason(): UnpricedReason {
  return reason('idp_replacement_unavailable', 'League starting slots or projected defender coverage cannot establish replacement value')
}

/**
 * A pick the league's value chart carries no market price for. The chart for guillotine, survivor
 * and zombie leagues is the redraft one, which has no pick rows; a dynasty chart can lack a far
 * season. Before 2026-09-28 those fell to a formula curve that priced a 2027 1st at 7,360 against
 * FantasyCalc's ~2,900, and letters were issued on it (trade price coverage audit).
 */
export function noPickMarketUnpricedReason(year: number, round: number): UnpricedReason {
  return reason('no_pick_market', `No market value for a ${year} round ${round} pick in this league's format`)
}

const TEAM_DEFENSE_POSITIONS = new Set(['DEF', 'DST', 'D/ST'])

/** The only sport the value feed covers. */
const FEED_SPORT = 'NFL'

const SPORT_NAMES: Record<string, string> = {
  NCAAF: 'college football',
  NCAAFB: 'college football',
  NCAAB: 'college basketball',
  NCAABB: 'college basketball',
  SOCCER: 'soccer',
}

function reason(code: UnpricedReasonCode, label: string): UnpricedReason {
  return { code, label }
}

function positionReason(position: string | null | undefined): UnpricedReason | null {
  const p = String(position ?? '').trim().toUpperCase()
  if (!p) return null
  if (isIdpPosition(p)) return reason('defender', "Our value feed doesn't price defenders")
  if (isKickerPosition(p)) return reason('kicker', "Our value feed doesn't price kickers")
  if (TEAM_DEFENSE_POSITIONS.has(p)) {
    return reason('team_defense', "Our value feed doesn't price team defenses")
  }
  return null
}

function sportReason(sport: string | null | undefined): UnpricedReason | null {
  const s = String(sport ?? '').trim().toUpperCase()
  // An unknown sport is not evidence of a feed gap; the caller's other facts decide.
  if (!s || s === FEED_SPORT) return null
  return reason('no_feed_for_sport', `No values on file for ${SPORT_NAMES[s] ?? s} players`)
}

/**
 * A draft pick in a sport nothing prices picks for. Every pick price on file is the NFL's (the
 * FantasyCalc chart), so outside the NFL a pick is unpriced rather than read off a football chart —
 * the same rule `pickPolicyRefusal` applies inside a league, extended to the open analyzer and the
 * roster picker's previews, which had no sport check (trade grade audit, 2026-10-09).
 */
export function noSportPickMarketUnpricedReason(sport: string | null | undefined): UnpricedReason {
  const s = String(sport ?? '').trim().toUpperCase()
  return reason('no_pick_market', `Draft picks have no ${SPORT_NAMES[s] ?? (s || 'league')} price yet`)
}

/** Whether a pick in this sport has any price source at all. Only the NFL's chart carries picks. */
export function sportHasPickMarket(sport: string | null | undefined): boolean {
  return String(sport ?? '').trim().toUpperCase() === FEED_SPORT
}

/**
 * Why a player the value feed was asked about came back with nothing.
 *
 * `marketLoaded` is false when the feed itself could not be read, as opposed to read and missing
 * this player — the caller knows which, this function does not.
 */
export function playerUnpricedReason(args: {
  identified: boolean
  position: string | null | undefined
  sport: string | null | undefined
  marketLoaded: boolean
  /** The caller also attempted this league's defensive board, not just the market feed. */
  leagueDerived?: boolean
}): UnpricedReason {
  if (!args.identified) {
    return reason('unidentified', "We couldn't match this player to our player records")
  }
  return (
    sportReason(args.sport) ??
    (args.leagueDerived && isIdpPosition(args.position)
      ? reason('defender', 'No league-derived defensive value available for this player') : null) ??
    positionReason(args.position) ??
    (args.marketLoaded
      ? reason('not_on_feed', "Not among the ~400 players our value feed prices")
      : reason('feed_unavailable', "Values couldn't be loaded — try again shortly"))
  )
}

/**
 * Why the trade ANALYSIS priced a player at nothing. Its engine tries the feed, this league's own
 * defender board (and, for a question about the past, a historical value) before giving up, so "not
 * on the feed" is not the whole story there — but a position the feed never covers still is.
 */
export function analysisUnpricedReason(args: {
  position: string | null | undefined
  sport: string | null | undefined
}): UnpricedReason {
  return (
    sportReason(args.sport) ??
    (isIdpPosition(args.position) ? reason('defender', 'No league-derived defensive value available for this player') : null) ??
    positionReason(args.position) ??
    reason('no_value_on_file', 'No feed, historical or draft value on file')
  )
}

/**
 * A player today's market board does not carry, whose only number is an old historical snapshot.
 *
 * That snapshot is NOT the market (measured 2026-09-28, SF 12-team): rank for rank it sits 1.4–2.4×
 * above the live board at the fringe — rank 150 is 2,210 against 1,431, rank 300 is 773 against 316 —
 * and the board lists ~420 players down to a value of 5, so a player missing from it is valued below
 * that floor today. Carrying the snapshot priced exactly those players at a multiple of their market.
 */
export function staleHistoricalUnpricedReason(snapshotDate: string | null | undefined): UnpricedReason {
  const when = String(snapshotDate ?? '').slice(0, 10)
  return reason(
    'not_on_feed',
    when
      ? `Not on today's market board — the only value on file is from a ${when} snapshot, which is not today's market`
      : "Not on today's market board — the only value on file is an old snapshot, which is not today's market",
  )
}

export function pickUnpricedReason(): UnpricedReason {
  return reason('pick_without_round', 'No round on file, so the pick curve cannot place it')
}

/**
 * An asset nobody has tried to price yet: FAAB, which only the analysis converts against the
 * league's budget, and a player carried in without a lookup (a counter-offer is rebuilt from the
 * offer by name). Saying "not on the feed" there would state a lookup that never happened.
 */
export function pricedOnAnalysisReason(): UnpricedReason {
  return reason('priced_on_analysis', 'Priced when you analyze the trade')
}
