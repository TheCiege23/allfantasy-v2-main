import type { FantasyCalcSettings } from '@/lib/fantasycalc'

/** League metadata has authority over defaults; a known false is never discarded. */
export function tradeConsoleMarketProfile(league: { isDynasty: boolean } | null, numTeams: number, isSuperFlex: boolean, ppr: 0 | 0.5 | 1): FantasyCalcSettings {
  return { isDynasty: league?.isDynasty ?? true, numTeams, numQbs: isSuperFlex ? 2 : 1, ppr }
}
