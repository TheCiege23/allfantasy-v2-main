import { prisma } from '@/lib/prisma'

type LeagueClass = 'DYN_SF' | 'DYN_1QB' | 'RED_SF' | 'RED_1QB' | 'SPC' | 'UNK'

export interface ComponentWeights {
  market: number
  impact: number
  scarcity: number
  demand: number
}

const LEAGUE_CLASS_BASELINES: Record<string, ComponentWeights> = {
  DYN_SF:  { market: 0.35, impact: 0.25, scarcity: 0.20, demand: 0.20 },
  DYN_1QB: { market: 0.40, impact: 0.25, scarcity: 0.15, demand: 0.20 },
  RED_SF:  { market: 0.25, impact: 0.45, scarcity: 0.20, demand: 0.10 },
  RED_1QB: { market: 0.20, impact: 0.50, scarcity: 0.20, demand: 0.10 },
  SPC:     { market: 0.10, impact: 0.60, scarcity: 0.25, demand: 0.05 },
  UNK:     { market: 0.35, impact: 0.35, scarcity: 0.15, demand: 0.15 },
}

const USER_GOAL_WEIGHTS: Record<string, ComponentWeights> = {
  win_now:  { market: 0.20, impact: 0.50, scarcity: 0.20, demand: 0.10 },
  rebuild:  { market: 0.50, impact: 0.10, scarcity: 0.20, demand: 0.20 },
  balanced: { market: 0.30, impact: 0.30, scarcity: 0.20, demand: 0.20 },
}

const SMOOTHING_ALPHA = 0.6

function normalizeWeights(w: ComponentWeights): ComponentWeights {
  const sum = w.market + w.impact + w.scarcity + w.demand
  if (sum === 0) return { market: 0.25, impact: 0.25, scarcity: 0.25, demand: 0.25 }
  return {
    market: w.market / sum,
    impact: w.impact / sum,
    scarcity: w.scarcity / sum,
    demand: w.demand / sum,
  }
}

export function getBaselineWeights(leagueClass: string): ComponentWeights {
  return LEAGUE_CLASS_BASELINES[leagueClass] ?? LEAGUE_CLASS_BASELINES.UNK
}

export function getGoalWeights(goal: string): ComponentWeights {
  return USER_GOAL_WEIGHTS[goal] ?? USER_GOAL_WEIGHTS.balanced
}

export function smoothWeights(
  defaultW: ComponentWeights,
  learnedW: ComponentWeights,
  alpha: number = SMOOTHING_ALPHA,
): ComponentWeights {
  return normalizeWeights({
    market: alpha * defaultW.market + (1 - alpha) * learnedW.market,
    impact: alpha * defaultW.impact + (1 - alpha) * learnedW.impact,
    scarcity: alpha * defaultW.scarcity + (1 - alpha) * learnedW.scarcity,
    demand: alpha * defaultW.demand + (1 - alpha) * learnedW.demand,
  })
}

export function applyGoalModifier(
  learnedWeights: ComponentWeights,
  goalWeights: ComponentWeights,
  goalAlpha: number = 0.7,
): ComponentWeights {
  return normalizeWeights({
    market: goalAlpha * learnedWeights.market + (1 - goalAlpha) * goalWeights.market,
    impact: goalAlpha * learnedWeights.impact + (1 - goalAlpha) * goalWeights.impact,
    scarcity: goalAlpha * learnedWeights.scarcity + (1 - goalAlpha) * goalWeights.scarcity,
    demand: goalAlpha * learnedWeights.demand + (1 - goalAlpha) * goalWeights.demand,
  })
}

export function resolveLeagueClass(params: {
  leagueType?: string | null
  specialtyFormat?: string | null
  isSF?: boolean | null
}): LeagueClass {
  const lt = (params.leagueType ?? '').toLowerCase()
  const sfmt = (params.specialtyFormat ?? '').toLowerCase()
  const sf = params.isSF ?? false

  if (sfmt && sfmt !== 'standard') return 'SPC'
  if (lt.includes('dyn')) return sf ? 'DYN_SF' : 'DYN_1QB'
  if (lt.includes('red')) return sf ? 'RED_SF' : 'RED_1QB'
  return 'UNK'
}

export async function getWeightEvolution(
  leagueClass: LeagueClass,
): Promise<Array<{ season: number; weights: ComponentWeights; correlations: ComponentWeights; nTrades: number }>> {
  const rows = await prisma.learnedWeights.findMany({
    where: { leagueClass },
    orderBy: { season: 'asc' },
  })

  return rows.map(r => ({
    season: r.season,
    weights: { market: r.wMarket, impact: r.wImpact, scarcity: r.wScarcity, demand: r.wDemand },
    correlations: { market: r.corrMarket, impact: r.corrImpact, scarcity: r.corrScarcity, demand: r.corrDemand },
    nTrades: r.nTrades,
  }))
}

export function blendMultiYearWeights(
  rows: Array<{ season: number; weights: ComponentWeights; nTrades: number }>,
  years: number = 3,
): ComponentWeights {
  const recent = rows.slice(-years)
  const totalTrades = recent.reduce((s, r) => s + r.nTrades, 0)
  if (totalTrades === 0) return LEAGUE_CLASS_BASELINES.UNK

  let wm = 0, wi = 0, ws = 0, wd = 0
  for (const r of recent) {
    const w = r.nTrades / totalTrades
    wm += w * r.weights.market
    wi += w * r.weights.impact
    ws += w * r.weights.scarcity
    wd += w * r.weights.demand
  }

  return normalizeWeights({ market: wm, impact: wi, scarcity: ws, demand: wd })
}
