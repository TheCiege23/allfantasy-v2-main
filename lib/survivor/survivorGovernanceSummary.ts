/**
 * The governance facts Chimmy is grounded with — pure. Only the asking castaway's own strikes and
 * alliance count; never who is allied with whom, never another castaway's record, never a sealed draw.
 */
import type { SurvivorGovernanceSettings } from './survivorGovernanceSettings'
import type { SurvivorTradeWindowStatus } from './survivorTradeRules'

export interface GovernanceGrounding {
  settings: SurvivorGovernanceSettings
  tradeWindow: SurvivorTradeWindowStatus | null
  currentWeek: number
  myStrikeCount: number | null
  myAllianceCount: number | null
  merged: boolean
}

export function survivorGovernanceGroundingLine(g: GovernanceGrounding): string {
  const s = g.settings
  const parts: string[] = []
  if (s.tradeRulesEnabled) {
    const cross = g.merged ? 'after the merge, no tribe limit' : s.crossTribeTrades === 'banned' ? 'cross-tribe banned' : s.crossTribeTrades === 'window' ? `cross-tribe only until ${s.crossTribeCloseDay} ${s.crossTribeCloseTime} ET after each Tribal` : 'cross-tribe allowed'
    const now = g.tradeWindow ? `${g.tradeWindow.frozen ? 'FROZEN now' : 'open now'}${g.tradeWindow.crossTribeClosesAt ? `, cross-tribe closes ${g.tradeWindow.crossTribeClosesAt.toISOString()}` : ''}` : ''
    parts.push(`Trade rules: ${cross}; played players locked until after Tribal: ${s.playedLockUntilTribal || s.withinTribeUnplayedOnly}; weekly freeze: ${s.weeklyTradeFreezeEnabled ? `${s.weeklyTradeFreezeDay} ${s.weeklyTradeFreezeTime} ET` : 'off'}${now ? ` (${now})` : ''}`)
  } else {
    parts.push('Trade rules: normal league rules (no Survivor trade rules)')
  }
  parts.push(`Conduct: ${s.strikeLimit} strikes ${s.strikeAutoRemove ? 'removes' : 'lets the commissioner remove'} a castaway${g.myStrikeCount != null ? `; user has ${g.myStrikeCount}` : ''}`)
  parts.push(s.alliancesEnabled ? `Alliances: on, up to ${s.allianceMaxSize}${s.allianceSameTribeOnly ? ', own tribe only before the merge' : ''}${g.myAllianceCount != null ? `; user is in ${g.myAllianceCount}` : ''}; Chimmy never joins one` : 'Alliances: off')
  const upcoming = s.swapSchedule.filter((w) => w.week >= g.currentWeek).map((w) => `week ${w.week} (${w.mode.replace(/_/g, ' ')})`)
  parts.push(upcoming.length ? `Scheduled tribe swaps after: ${upcoming.join(', ')}` : 'No extra tribe swaps scheduled')
  if (s.weekOneScoringStartDay) parts.push(`Week 1 counts games from ${s.weekOneScoringStartDay} on`)
  return `${parts.join('. ')}.`
}
