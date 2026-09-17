/**
 * Why a trade asset carries no value — the words the Trade Center prints beside "Unpriced".
 *
 * An unpriced asset has always rendered as an em dash, never a zero, and the builder counts it
 * toward "N unpriced". What it never said was WHY, and the reasons are not interchangeable: a
 * defender will never be on the value feed, a feed that failed to load will be back in a minute,
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

export type UnpricedReason = { code: UnpricedReasonCode; label: string }

const TEAM_DEFENSE_POSITIONS = new Set(['DEF', 'DST', 'D/ST'])

/** The only sport the value feed covers. */
const FEED_SPORT = 'NFL'

const SPORT_NAMES: Record<string, string> = {
  NCAAF: 'college football',
  NCAAFB: 'college football',
  NCAAB: 'college basketball',
  NCAABB: 'college basketball',
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
}): UnpricedReason {
  if (!args.identified) {
    return reason('unidentified', "We couldn't match this player to our player records")
  }
  return (
    sportReason(args.sport) ??
    positionReason(args.position) ??
    (args.marketLoaded
      ? reason('not_on_feed', "Not among the ~400 players our value feed prices")
      : reason('feed_unavailable', "Values couldn't be loaded — try again shortly"))
  )
}

/**
 * Why the trade ANALYSIS priced a player at nothing. Its engine tries the feed, this league's own
 * defender board, a historical value and a draft value before giving up, so "not on the feed" is
 * not the whole story there — but a position the feed never covers still is.
 */
export function analysisUnpricedReason(args: {
  position: string | null | undefined
  sport: string | null | undefined
}): UnpricedReason {
  return (
    sportReason(args.sport) ??
    positionReason(args.position) ??
    reason('no_value_on_file', 'No feed, historical or draft value on file')
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
