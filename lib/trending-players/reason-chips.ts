import type { FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import type { TrendReasonChip, TrendTypeId } from './types'

export function chipsFromFantasyCalc(p: FantasyCalcPlayer, trendType: TrendTypeId): TrendReasonChip[] {
  const chips: TrendReasonChip[] = []
  const vol = p.maybeMovingStandardDeviationPerc ?? 0
  if (Math.abs(vol) > 25) chips.push('Volatile')
  if ((p.player.maybeYoe ?? 99) <= 0) chips.push('Prospect Rise')
  if (p.trend30Day > 0 && trendType === 'trade' && (p.maybeTradeFrequency ?? 0) > 0.5) chips.push('Trade Buzz')
  if (p.trend30Day > 0) chips.push('Performance Swing')
  if (p.trend30Day < 0) chips.push('Performance Swing')
  if (trendType === 'injury_replacement') chips.push('Injury Opportunity')
  if (trendType === 'usage') chips.push('Usage Shift')
  if (chips.length === 0) chips.push('Performance Swing')
  return chips.slice(0, 3)
}

export function chipsFromMetaRates(args: {
  addRate: number
  dropRate: number
  tradeInterest: number
  lineupStartRate: number
  injuryImpact: number
  trendType: TrendTypeId
}): TrendReasonChip[] {
  const c: TrendReasonChip[] = []
  if (args.addRate > 0.2) c.push('Waiver Surge')
  if (args.dropRate > 0.2) c.push('Volatile')
  if (args.tradeInterest > 0.2) c.push('Trade Buzz')
  if (args.lineupStartRate > 0.2) c.push('Start Surge')
  if (args.injuryImpact > 0.15) c.push('Injury Opportunity')
  if (args.trendType === 'usage') c.push('Usage Shift')
  if (c.length === 0) c.push('Performance Swing')
  return c.slice(0, 3)
}
