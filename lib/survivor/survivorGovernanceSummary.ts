/**
 * The governance facts Chimmy is grounded with — pure. Only the asking castaway's own strikes and
 * alliance count; never who is allied with whom, never another castaway's record, never a sealed draw.
 */
import type { SurvivorGovernanceSettings } from './survivorGovernanceSettings'
import type { SurvivorTradeWindowStatus } from './survivorTradeRules'
import { crossTribeWindowsLabel } from './survivorGovernanceCopy'

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
    const windows = s.crossTribeWindows ?? []
    const cross = g.merged ? 'after the merge, no tribe limit' : s.crossTribeTrades === 'banned' ? 'cross-tribe banned'
      : s.crossTribeTrades === 'window' && (windows.length > 1 || windows[0]?.opensOn === 'time') ? `cross-tribe only in ${windows.length} weekly window${windows.length > 1 ? 's' : ''}: ${crossTribeWindowsLabel('en', windows)}`
        : s.crossTribeTrades === 'window' ? `cross-tribe only until ${s.crossTribeCloseDay} ${s.crossTribeCloseTime} ET after each Tribal` : 'cross-tribe allowed'
    const tw = g.tradeWindow
    const which = tw?.crossTribeWindow && tw.crossTribeWindow.count > 1 ? ` (window ${tw.crossTribeWindow.index} of ${tw.crossTribeWindow.count})` : ''
    const now = tw ? `${tw.frozen ? 'FROZEN now' : 'open now'}${tw.crossTribeClosesAt ? `, cross-tribe closes ${tw.crossTribeClosesAt.toISOString()}${which}` : ''}${tw.crossTribeOpensAt ? `, next cross-tribe window opens ${tw.crossTribeOpensAt.toISOString()}` : ''}` : ''
    parts.push(`Trade rules: ${cross}; played players locked until after Tribal: ${s.playedLockUntilTribal || s.withinTribeUnplayedOnly} (in a week with no Tribal, until the week's last game is final, or the week advancing if that cannot be read); if the check cannot run: ${s.tradeCheckFailureMode === 'hold' ? 'held for the commissioner' : 'allowed'}; weekly freeze: ${s.weeklyTradeFreezeEnabled ? `${s.weeklyTradeFreezeDay} ${s.weeklyTradeFreezeTime} ET` : 'off'}${now ? ` (${now})` : ''}`)
  } else {
    parts.push('Trade rules: normal league rules (no Survivor trade rules)')
  }
  parts.push(`Conduct: ${s.strikeLimit} strikes ${s.strikeAutoRemove ? 'removes' : 'lets the commissioner remove'} a castaway${g.myStrikeCount != null ? `; user has ${g.myStrikeCount}` : ''}`)
  parts.push(s.alliancesEnabled ? `Alliances: on, up to ${s.allianceMaxSize}${s.allianceSameTribeOnly ? ', own tribe only before the merge' : ''}${g.myAllianceCount != null ? `; user is in ${g.myAllianceCount}` : ''}; Chimmy never joins one` : 'Alliances: off')
  const upcoming = s.swapSchedule.filter((w) => w.week >= g.currentWeek).map((w) => `week ${w.week} (${w.mode.replace(/_/g, ' ')})`)
  parts.push(upcoming.length ? `Scheduled tribe swaps after: ${upcoming.join(', ')}` : 'No extra tribe swaps scheduled')
  if (s.tribeSplit === 'rooks_vs_vets') parts.push(`Rooks vs Vets: veterans are castaways who owned a team in an earlier season of this league${s.experienceCrossLeague ? ' or played an earlier Survivor season in any AllFantasy league (never say which league)' : ''}; the commissioner's flag wins`)
  if (s.weekOneScoringStartDay) parts.push(`Week 1 counts games from ${s.weekOneScoringStartDay} on`)
  return `${parts.join('. ')}.`
}
