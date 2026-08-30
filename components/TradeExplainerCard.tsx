'use client'

import { TradeDelta, PricedAsset } from '@/lib/hybrid-valuation'
import MiniPlayerImg from '@/components/MiniPlayerImg'

export interface TradeExplainer {
  headline: string
  verdict: string
  deltaValue: number
  breakdown: {
    received: Array<{ label: string; value: number; source: string }>
    gave: Array<{ label: string; value: number; source: string }>
  }
  bullets: string[]
  confidence: 'High' | 'Medium' | 'Low'
  grade: string
}

interface TradeExplainerCardProps {
  explainer: TradeExplainer
  mode: 'atTime' | 'hindsight'
}

export function createExplainerFromDelta(
  delta: TradeDelta | null,
  mode: 'atTime' | 'hindsight',
  tradeDate?: string
): TradeExplainer | null {
  if (!delta) return null

  const confidenceLabel: 'High' | 'Medium' | 'Low' = 
    delta.confidence >= 0.7 ? 'High' :
    delta.confidence >= 0.4 ? 'Medium' : 'Low'

  const bullets: string[] = []
  
  const excelPlayers = delta.valuationStats.playersFromExcel
  const fcPlayers = delta.valuationStats.playersFromFantasyCalc
  const idpPlayers = delta.valuationStats.playersFromIdpVorp
  const kickerPlayers = delta.valuationStats.playersFromKickerFlat
  const fallbackPlayers = delta.valuationStats.playersFromFallback
  const totalPlayers =
    excelPlayers +
    fcPlayers +
    idpPlayers +
    kickerPlayers +
    fallbackPlayers +
    delta.valuationStats.playersUnknown
  
  if (excelPlayers > 0) {
    bullets.push(`${excelPlayers} of ${totalPlayers} players valued from historical data${mode === 'atTime' && tradeDate ? ` (${tradeDate})` : ''}`)
  }
  
  if (fcPlayers > 0) {
    bullets.push(`${fcPlayers} player${fcPlayers > 1 ? 's' : ''} valued from live market data`)
  }

  /* Named separately from the market bullet on purpose: no market prices defenders, so
   * this number comes from THIS league's scoring and starting slots, and saying so is the
   * difference between a value a manager can argue with and one that looks made up. */
  if (idpPlayers > 0) {
    bullets.push(`${idpPlayers} defender${idpPlayers > 1 ? 's' : ''} valued from your league's IDP scoring and starting slots`)
  }

  /* Says the quiet part out loud. Every kicker in a league carries the SAME value here
   * because kicker rank does not persist (year-over-year Spearman -0.455, negative in all
   * six measured season pairs). A manager reading a flat number deserves the reason. */
  if (kickerPlayers > 0) {
    bullets.push(`${kickerPlayers} kicker${kickerPlayers > 1 ? 's' : ''} valued at your league's flat kicker price — kicker rank does not carry year to year, so we don't pretend one is worth more than another`)
  }
  
  /* 🛑 THE ONE BULLET THAT ADMITS A WEAK PRICE, AND THE REASON THE SOURCE SPLIT HAPPENED.
   * These players were priced by a stand-in: a flat per-position IDP constant that is the
   * same for every linebacker in the league, or a draft lifetime value because no board
   * carried them. Both used to be indistinguishable from "we could not price him", so this
   * card could not have said it. A manager about to send a trade should know which side of
   * it rests on a number nothing measured. */
  if (fallbackPlayers > 0) {
    bullets.push(
      `${fallbackPlayers} player${fallbackPlayers > 1 ? 's' : ''} priced from a fallback, not a market or your league's own board — treat ${fallbackPlayers > 1 ? 'those values' : 'that value'} as a rough placeholder`,
    )
  }

  if (delta.valuationStats.picksFromExcel > 0 || delta.valuationStats.picksFromCurve > 0) {
    const pickTotal = delta.valuationStats.picksFromExcel + delta.valuationStats.picksFromCurve
    bullets.push(`${pickTotal} draft pick${pickTotal > 1 ? 's' : ''} included in valuation`)
  }

  if (Math.abs(delta.percentDiff) < 5) {
    bullets.push('Trade is well-balanced with fair value on both sides')
  } else if (delta.deltaValue > 0) {
    bullets.push(`You gained ${Math.abs(delta.percentDiff).toFixed(0)}% more value than you gave`)
  } else {
    bullets.push(`You gave ${Math.abs(delta.percentDiff).toFixed(0)}% more value than you received`)
  }

  const headline = generateHeadline(delta)
  const verdict = generateVerdict(delta, mode)

  return {
    headline,
    verdict,
    deltaValue: delta.deltaValue,
    breakdown: {
      received: delta.receivedAssets.map(a => ({
        label: a.name,
        value: a.value,
        source: a.source
      })),
      gave: delta.gaveAssets.map(a => ({
        label: a.name,
        value: a.value,
        source: a.source
      }))
    },
    bullets,
    confidence: confidenceLabel,
    grade: delta.grade
  }
}

function generateHeadline(delta: TradeDelta): string {
  const absDiff = Math.abs(delta.percentDiff)
  
  if (absDiff < 5) return 'Well-balanced trade with fair value exchange'
  if (delta.deltaValue > 0) {
    if (absDiff >= 25) return 'Significant value gained in this trade'
    if (absDiff >= 15) return 'Clear value advantage in this trade'
    return 'Slight edge gained in this trade'
  } else {
    if (absDiff >= 25) return 'Significant value given up in this trade'
    if (absDiff >= 15) return 'Clear value disadvantage in this trade'
    return 'Slight value given up in this trade'
  }
}

function generateVerdict(delta: TradeDelta, mode: 'atTime' | 'hindsight'): string {
  const absDiff = Math.abs(delta.percentDiff)
  
  if (absDiff < 5) {
    return 'Fair Trade'
  }
  
  const prefix = mode === 'hindsight' ? 'Outcome' : 'Process'
  
  if (delta.deltaValue > 0) {
    return `${prefix} Win`
  } else {
    return `${prefix} Loss`
  }
}

export function TradeExplainerCard({ explainer, mode }: TradeExplainerCardProps) {
  const isWin = explainer.deltaValue >= 0
  
  return (
    <div className="rounded-xl bg-white/5 p-4 border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">
          Why this trade graded {explainer.grade}
        </h3>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          explainer.verdict.includes('Win') 
            ? 'bg-emerald-500/20 text-emerald-300'
            : explainer.verdict.includes('Loss')
            ? 'bg-rose-500/20 text-rose-300'
            : 'bg-slate-500/20 text-slate-300'
        }`}>
          {explainer.verdict}
        </span>
      </div>

      <p className="text-sm text-white/70 mb-4">{explainer.headline}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
        <div>
          <div className="text-xs text-white/50 mb-2">You Received</div>
          {explainer.breakdown.received.map((item, i) => (
            <div key={i} className="flex justify-between items-center text-sm mb-1">
              <span className="text-white/80 truncate mr-2 flex items-center gap-1.5"><MiniPlayerImg name={item.label} size={18} />{item.label}</span>
              <span className="text-emerald-400 font-medium">{item.value.toLocaleString()}</span>
            </div>
          ))}
          {explainer.breakdown.received.length === 0 && (
            <div className="text-sm text-white/40">Nothing</div>
          )}
        </div>
        <div>
          <div className="text-xs text-white/50 mb-2">You Gave</div>
          {explainer.breakdown.gave.map((item, i) => (
            <div key={i} className="flex justify-between items-center text-sm mb-1">
              <span className="text-white/80 truncate mr-2 flex items-center gap-1.5"><MiniPlayerImg name={item.label} size={18} />{item.label}</span>
              <span className="text-rose-400 font-medium">{item.value.toLocaleString()}</span>
            </div>
          ))}
          {explainer.breakdown.gave.length === 0 && (
            <div className="text-sm text-white/40">Nothing</div>
          )}
        </div>
      </div>

      <ul className="text-sm space-y-1.5 mb-4 text-white/70">
        {explainer.bullets.map((bullet, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-white/40 mt-0.5">•</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <div className="flex justify-between items-center text-xs text-white/50 pt-3 border-t border-white/10">
        <span className={`px-2 py-0.5 rounded ${
          explainer.confidence === 'High' ? 'bg-emerald-500/20 text-emerald-300' :
          explainer.confidence === 'Medium' ? 'bg-amber-500/20 text-amber-300' :
          'bg-slate-500/20 text-slate-300'
        }`}>
          {explainer.confidence} Confidence
        </span>
        <span className={`font-medium ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isWin ? '+' : ''}{explainer.deltaValue.toLocaleString()} value
        </span>
      </div>
    </div>
  )
}
