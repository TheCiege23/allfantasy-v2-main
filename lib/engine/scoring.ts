import type { EngineLeagueContext } from './types'
import type { TradeLeagueContext } from './trade-types'

interface NormalizedTradeScoring {
  qbFormat: '1QB' | 'superflex'
  ppr: number
  tep: { enabled: boolean; premiumPprBonus: number }
  ppCarry: number
  ppCompletion: number
  sixPtPassTd: boolean
  bonuses: Record<string, boolean>
}

export function normalizeTradeScoring(ctx?: TradeLeagueContext | null): NormalizedTradeScoring {
  const s = ctx?.scoring
  return {
    qbFormat: s?.qbFormat ?? '1QB',
    ppr: s?.ppr ?? 1,
    tep: {
      enabled: s?.tep?.enabled ?? false,
      premiumPprBonus: s?.tep?.premiumPprBonus ?? 0,
    },
    ppCarry: s?.ppCarry ?? 0,
    ppCompletion: s?.ppCompletion ?? 0,
    sixPtPassTd: s?.sixPtPassTd ?? false,
    bonuses: s?.bonusFlags ?? {},
  }
}

export function tradeScoringLabel(scoring: NormalizedTradeScoring): string {
  const parts: string[] = []
  if (scoring.qbFormat === 'superflex') parts.push('SF')
  if (scoring.tep.enabled) parts.push('TEP')
  if (scoring.ppCarry > 0) parts.push('PPCarry')
  if (scoring.ppr === 0.5) parts.push('Half-PPR')
  else if (scoring.ppr === 0) parts.push('Standard')
  else parts.push('PPR')
  if (scoring.sixPtPassTd) parts.push('6PT-Pass')
  return parts.join(' / ') || 'PPR'
}

export interface ScoringAdjustment {
  baseMultiplier: number
  tepMultiplier: number
  sfMultiplier: number
  idpMultiplier: number
  positionMultiplier: Record<string, number>
}

export function computeScoringAdjustments(league: EngineLeagueContext): ScoringAdjustment {
  const { scoring, roster } = league

  const positionMultiplier: Record<string, number> = {
    QB: 1.0,
    RB: 1.0,
    WR: 1.0,
    TE: 1.0,
    K: 0.3,
    DEF: 0.4,
  }

  if (scoring.isSF) {
    positionMultiplier.QB = 2.0
  }

  if (scoring.isTEP) {
    positionMultiplier.TE = 1.0 + scoring.tepBonus * 0.5
  }

  if (scoring.ppr >= 1) {
    positionMultiplier.WR *= 1.1
    positionMultiplier.RB *= 0.95
  } else if (scoring.ppr === 0) {
    positionMultiplier.RB *= 1.15
    positionMultiplier.WR *= 0.9
  }

  if (scoring.passBonus6pt) {
    positionMultiplier.QB *= 1.15
  }

  return {
    baseMultiplier: 1.0,
    tepMultiplier: scoring.isTEP ? 1.0 + scoring.tepBonus * 0.3 : 1.0,
    sfMultiplier: scoring.isSF ? 1.8 : 1.0,
    idpMultiplier: roster.idpEnabled ? 1.1 : 1.0,
    positionMultiplier,
  }
}

