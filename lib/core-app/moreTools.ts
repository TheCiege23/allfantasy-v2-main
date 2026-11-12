/**
 * Where the Tools hub's links live now (2026-11-12). Tools (/core/tools) left the nav: most of its
 * cards repeated a nav entry, and the rest belong on a screen people already open. Each entry here
 * is one of those — keyed to the screen it moved to, so nothing the hub offered became unreachable.
 *
 * Already reachable elsewhere, so not listed here: Waiver Assistant, Draft Room, Season Outlook,
 * Power Rankings, Settings, Plans (nav entries); Share a card (Career links it); Tokens (Plans
 * links it); Import a league (the rail's connect card); Commissioner Hub (its own nav entry).
 *
 * ⚠ THE FOUR TRADE TOOLS AND THREE PLAYER-COMPARISON PAGES ARE STILL AN OPEN PRODUCT CALL
 * (toolsHub.ts `openDecision`). This moves the links; it does not merge or retire any of them.
 */
export type MoreToolsScreen = 'trades' | 'draft' | 'rankings' | 'players'

export type MoreToolLink = {
  /** Key into moreToolsMessages for the label; `${key}Desc` is the one-line description. */
  key:
    | 'tradeAnalyzer'
    | 'tradeEvaluator'
    | 'tradeFinder'
    | 'dynastyTradeAnalyzer'
    | 'tradeHistory'
    | 'mockDraft'
    | 'warRoom'
    | 'managerCompare'
    | 'playerCompare'
    | 'playerComparison'
    | 'playerComparisonLab'
  href: string
  /** A full page outside the /core shell. */
  leavesShell: boolean
  /** Shown as a "Pro" tag, as the Tools hub card did. The destination page does the gating. */
  pro?: boolean
}

export const MORE_TOOLS: Readonly<Record<MoreToolsScreen, readonly MoreToolLink[]>> = {
  trades: [
    { key: 'tradeAnalyzer', href: '/trade-analyzer', leavesShell: true },
    { key: 'tradeEvaluator', href: '/trade-evaluator', leavesShell: true },
    { key: 'tradeFinder', href: '/trade-finder', leavesShell: true },
    { key: 'dynastyTradeAnalyzer', href: '/dynasty-trade-analyzer', leavesShell: true },
    { key: 'tradeHistory', href: '/af-legacy?tab=finder', leavesShell: true, pro: true },
  ],
  draft: [
    { key: 'mockDraft', href: '/mock-draft', leavesShell: true },
    { key: 'warRoom', href: '/war-room', leavesShell: true },
  ],
  rankings: [{ key: 'managerCompare', href: '/manager-compare', leavesShell: true, pro: true }],
  players: [
    { key: 'playerCompare', href: '/player-compare', leavesShell: true },
    { key: 'playerComparison', href: '/player-comparison', leavesShell: true },
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
