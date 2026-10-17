import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { UnpricedReason } from './unpricedReason'

/**
 * A player BELOW this league's chart, told apart from a player we cannot price.
 *
 * 🛑 GUAP'S RULING, 2026-09-30, AND IT NARROWS "A MISSING ASSET IS NOT GRADED AS WORTHLESS" RATHER
 * THAN REVERSING IT. Case Keenum held Pirate League twinty's 4-for-2 ungraded: FantasyCalc's REDRAFT
 * chart does not list him, while its dynasty charts price him (757 superflex, 394 one-QB). The chart
 * lists ~420 players down to a value of 5 (measured 2026-09-28), so a player it drops is below that
 * floor — worth nothing on it, not unknown. A backup QB rostered in a redraft league is exactly that.
 *
 * So the refusal still stands for everything it was written for — a player we could not identify, a
 * feed that did not load, a defender or kicker the feed never prices. It gives way only when
 * FantasyCalc itself lists the player on ANOTHER of its charts today: that is the evidence the player
 * is real and current, and absent from this chart because he ranks below it.
 *
 * The grade says so on its basis line (`belowChartFloorNote`), so a 0 is never silent.
 */

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

/** Reasons that mean "we could not look" rather than "the chart does not list him". */
const NOT_A_FLOOR = new Set<UnpricedReason['code']>([
  'unidentified',
  'ambiguous_identity',
  'feed_unavailable',
  'no_feed_for_sport',
  'defender',
  'kicker',
  'team_defense',
])

/** An unpriced player the floor may apply to: an offensive skill player the chart simply omits. */
export function isFloorEligible(
  pa: Pick<PricedAsset, 'unpriced' | 'unpricedReason' | 'position'>,
  position: string | null | undefined,
  leagueReason?: UnpricedReason | null,
): boolean {
  if (!pa.unpriced) return false
  const pos = String(position ?? pa.position ?? '').trim().toUpperCase()
  if (!SKILL_POSITIONS.has(pos)) return false
  for (const r of [pa.unpricedReason, leagueReason]) if (r && NOT_A_FLOOR.has(r.code)) return false
  return true
}

/** The priced stand-in: 0 on the chart, not unpriced. */
export function belowChartFloorAsset(name: string, position?: string): PricedAsset {
  return {
    name,
    type: 'player',
    value: 0,
    assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0.5 },
    source: 'fantasycalc',
    ...(position ? { position } : {}),
  }
}

/** The sentence the grade's basis carries for them. */
export function belowChartFloorNote(names: readonly string[]): string | null {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (list.length === 0) return null
  const who = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  const verb = list.length === 1 ? 'is' : 'are'
  return `${who} ${verb} below this league's chart — FantasyCalc lists ${list.length === 1 ? 'him' : 'them'} on its other charts but not this one — so ${list.length === 1 ? 'he counts' : 'they count'} as 0.`
}
