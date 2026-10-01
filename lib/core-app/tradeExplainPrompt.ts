import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'

/**
 * The question the Trade Center's "Explain with Chimmy" button pre-fills. Pure, so its shape is
 * tested rather than assumed.
 *
 * 🛑 WRITTEN IN THE SHAPE CHIMMY'S TRADE GRADER READS. `buildTradeScenario` splits a trade on
 * " for " and takes a received pick's partner from its bracketed owner — "2028 2nd Rd
 * (JeffersonTD)". The old prefill ("I give: Braelon Allen. I get: 2028 2nd.") had neither, so a
 * picks-only trade came back NOT COMPUTED and Chimmy asked the user which team's pick it was
 * (2026-09-30). The trade sentence goes FIRST so the first " for " is the trade's, not one inside
 * a league or team name.
 *
 * The screen's own values ride along, so Chimmy explains the numbers the user is looking at rather
 * than quoting a second price for the same player.
 */

export type ExplainSideValue = number | null

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th']

/** "2028 2nd (Champ DeThroner)" → "Champ DeThroner": an acquired pick names its original team. */
function ownerFromLabel(label: string | undefined): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(label ?? '')
  return m ? m[1]!.trim() : null
}

export function describeAssetForChimmy(a: PickedAsset, sideOwner: string | null): string {
  if (a.kind === 'player') return a.name
  if (a.kind === 'faab') return `$${a.amount} FAAB`
  const round = ORDINAL[a.round] ?? `round ${a.round}`
  const owner = ownerFromLabel(a.label) ?? sideOwner
  return owner ? `${a.year} ${round} Rd (${owner})` : `${a.year} ${round} Rd`
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function tradeExplainPrompt(args: {
  leagueName: string | null
  give: readonly PickedAsset[]
  get: readonly PickedAsset[]
  /** The name Chimmy knows each manager by — the manager's own name before the team name. */
  myName: string | null
  partnerName: string | null
  partnerTeamName: string | null
  /** Each side's total on screen, or null when any asset on that side is unpriced. */
  giveValue: ExplainSideValue
  getValue: ExplainSideValue
  verdict: string | null
}): string {
  const league = args.leagueName ? ` in ${args.leagueName}` : ''
  if (args.give.length === 0 || args.get.length === 0) {
    return `Help me think about a trade${league}.`
  }
  const side = (list: readonly PickedAsset[], owner: string | null) =>
    list.map((a) => describeAssetForChimmy(a, owner)).join(' and ')
  const partner =
    args.partnerTeamName && args.partnerName && args.partnerTeamName !== args.partnerName
      ? `${args.partnerTeamName} (${args.partnerName})`
      : (args.partnerTeamName ?? args.partnerName)
  const parts = [
    `${side(args.give, args.myName)} for ${side(args.get, args.partnerName ?? args.partnerTeamName)}.`,
    `Explain this trade${league}${partner ? ` with ${partner}` : ''}.`,
  ]
  if (args.giveValue != null && args.getValue != null) {
    parts.push(
      `On the trade screen I give ${fmt(args.giveValue)} and get ${fmt(args.getValue)} in league value — explain using those numbers.`,
    )
  }
  if (args.verdict) parts.push(args.verdict)
  parts.push('What am I missing?')
  return parts.join(' ')
}
