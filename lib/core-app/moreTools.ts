/**
 * Where the Tools hub's links live now (2026-11-12). Tools (/core/tools) left the nav: most of its
 * cards repeated a nav entry, and the rest belong on a screen people already open. Each entry here
 * is one of those — keyed to the screen it moved to, so nothing the hub offered became unreachable.
 *
 * Already reachable elsewhere, so not listed here: Waiver Assistant, Draft Room, Season Outlook,
 * Power Rankings, Settings, Plans (nav entries); Share a card (Career links it); Tokens (Plans
 * links it); Import a league (the rail's connect card); Commissioner Hub (its own nav entry).
 *
 * The trade tools are one tool since 2026-11-12: the Trade Analyzer at `/trade-evaluator`, and the
 * finder on the Trades screen itself — which is where this list renders, so it needs no link.
 * The player-comparison pages are one tool since 2026-11-12 too: the Player Comparison Lab.
 * `/player-compare` redirects into it, and `/player-comparison` is its search landing page.
 */
export type MoreToolsScreen = 'trades' | 'draft' | 'rankings' | 'players'

export type MoreToolLink = {
  /** Key into moreToolsMessages for the label; `${key}Desc` is the one-line description. */
  key:
    | 'tradeAnalyzer'
    | 'tradeHistory'
    | 'mockDraft'
    | 'warRoom'
    | 'managerCompare'
    | 'playerComparisonLab'
  href: string
  /** A full page outside the /core shell. */
  leavesShell: boolean
  /** Shown as a "Pro" tag, as the Tools hub card did. The destination page does the gating. */
  pro?: boolean
}

export const MORE_TOOLS: Readonly<Record<MoreToolsScreen, readonly MoreToolLink[]>> = {
  trades: [
    { key: 'tradeAnalyzer', href: '/trade-evaluator', leavesShell: true },
    { key: 'tradeHistory', href: '/af-legacy?tab=finder', leavesShell: true, pro: true },
  ],
  draft: [
    { key: 'mockDraft', href: '/mock-draft', leavesShell: true },
    { key: 'warRoom', href: '/war-room', leavesShell: true },
  ],
  rankings: [{ key: 'managerCompare', href: '/manager-compare', leavesShell: true, pro: true }],
  players: [
    { key: 'playerComparisonLab', href: '/player-comparison-lab', leavesShell: true },
  ],
}

/** The screen a /core nav key shows these links on, or null. */
export function moreToolsScreenFor(activeKey: string): MoreToolsScreen | null {
  if (activeKey === 'trades') return 'trades'
  if (activeKey === 'draft-hq') return 'draft'
  if (activeKey === 'rankings') return 'rankings'
  if (activeKey === 'players') return 'players'
  return null
}
