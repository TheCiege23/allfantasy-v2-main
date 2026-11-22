/**
 * AI League Meta Engine
 *
 * League-specific intelligence: trading culture, waiver culture, market
 * distortions, position hoarding, exploitable patterns. The hidden layer
 * that explains why generic advice fails in specific leagues.
 *
 * Pure deterministic. <20ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TradingCulture = 'dead' | 'passive' | 'moderate' | 'active' | 'hyperactive'
type WaiverCulture = 'quiet' | 'balanced' | 'aggressive' | 'chaotic'
type RiskCulture = 'safe' | 'balanced' | 'volatile'

interface LeagueTeamMeta {
  rosterId: number
  managerName: string
  tradeCount: number
  waiverClaimCount: number
  rosterMoveCount: number
  avgTradeValue: number
  positionHoldings: Record<string, number>
  contenderTier: string
  archetype?: string
}

export const LeagueMetaInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  leagueId: z.string(),
  leagueName: z.string().default('League'),
  numTeams: z.number().default(12),
  scoringFormat: z.string().default('PPR'),
  teams: z.array(z.object({
    rosterId: z.number(), managerName: z.string(),
    tradeCount: z.number().default(0), waiverClaimCount: z.number().default(0),
    rosterMoveCount: z.number().default(0), avgTradeValue: z.number().default(0),
    positionHoldings: z.record(z.string(), z.number()).default({}),
    contenderTier: z.string().default('middle'), archetype: z.string().optional(),
  })),
  totalTradesThisSeason: z.number().default(0),
  totalWaiverClaimsThisSeason: z.number().default(0),
  avgFaabSpent: z.number().optional(),
  avgPickValue: z.number().optional(),
})
type LeagueMetaInput = z.infer<typeof LeagueMetaInputSchema>

interface LeagueMetaResult {
  leagueId: string
  leagueName: string
  metaSummary: string
  confidencePct: number
  tradingCulture: TradingCulture
  waiverCulture: WaiverCulture
  riskCulture: RiskCulture
  pickMarketHealth: string
  marketDistortions: string[]
  overvaluedAssets: string[]
  undervaluedAssets: string[]
  hoardedPositions: string[]
  scarcePositions: string[]
  exploitablePatterns: string[]
  draftCultureNotes: string[]
  waiverNotes: string[]
  tradeNotes: string[]
  managerClusterNotes: string[]
  bestExploitationStrategies: string[]
  cautionFlags: string[]
  metaTags: string[]
  summary: string
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Culture Classification
// ---------------------------------------------------------------------------

function classifyTradingCulture(totalTrades: number, numTeams: number): TradingCulture {
  const perTeam = totalTrades / Math.max(numTeams, 1)
  if (perTeam >= 5) return 'hyperactive'
  if (perTeam >= 3) return 'active'
  if (perTeam >= 1.5) return 'moderate'
  if (perTeam >= 0.5) return 'passive'
  return 'dead'
}

function classifyWaiverCulture(totalClaims: number, numTeams: number): WaiverCulture {
  const perTeam = totalClaims / Math.max(numTeams, 1)
  if (perTeam >= 15) return 'chaotic'
  if (perTeam >= 8) return 'aggressive'
  if (perTeam >= 3) return 'balanced'
  return 'quiet'
}

function classifyRiskCulture(teams: LeagueTeamMeta[]): RiskCulture {
  const archetypes = teams.map(t => t.archetype).filter(Boolean)
  const aggressive = archetypes.filter(a => a === 'Gambler' || a === 'Impulsive').length
  const conservative = archetypes.filter(a => a === 'Hoarder' || a === 'Fair Dealer').length
  if (aggressive > conservative + 2) return 'volatile'
  if (conservative > aggressive + 2) return 'safe'
  return 'balanced'
}

// ---------------------------------------------------------------------------
// Market Analysis
// ---------------------------------------------------------------------------

function detectHoardedPositions(teams: LeagueTeamMeta[], numTeams: number): string[] {
  const positionTotals: Record<string, number> = {}
  for (const team of teams) {
    for (const [pos, count] of Object.entries(team.positionHoldings)) {
      positionTotals[pos] = (positionTotals[pos] || 0) + count
    }
  }
  const hoarded: string[] = []
  for (const [pos, total] of Object.entries(positionTotals)) {
    const avgPerTeam = total / numTeams
    if (pos === 'RB' && avgPerTeam >= 6) hoarded.push('RB — heavily hoarded across the league')
    if (pos === 'WR' && avgPerTeam >= 7) hoarded.push('WR — deep rosters absorbing WR supply')
    if (pos === 'QB' && avgPerTeam >= 3) hoarded.push('QB — more QBs rostered than needed')
    if (pos === 'TE' && avgPerTeam >= 3) hoarded.push('TE — TE hoarding creating artificial scarcity')
  }
  return hoarded
}

function detectDistortions(teams: LeagueTeamMeta[], tradingCulture: TradingCulture): string[] {
  const distortions: string[] = []
  if (tradingCulture === 'dead' || tradingCulture === 'passive') {
    distortions.push('Low trade volume means assets are harder to move — adjust patience expectations')
  }
  if (tradingCulture === 'hyperactive') {
    distortions.push('Very active trade market — values shift frequently. Monitor for buy/sell windows.')
  }
  const traderCount = teams.filter(t => t.tradeCount >= 3).length
  const passiveCount = teams.filter(t => t.tradeCount === 0).length
  if (traderCount <= 3 && passiveCount >= teams.length / 2) {
    distortions.push('Trade market concentrated — only a few managers are active traders')
  }
  return distortions
}

function detectExploitablePatterns(teams: LeagueTeamMeta[], tradingCulture: TradingCulture, waiverCulture: WaiverCulture): string[] {
  const patterns: string[] = []
  if (tradingCulture === 'passive' || tradingCulture === 'dead') {
    patterns.push('Low trade activity — you can acquire assets from the few active traders without competition')
  }
  if (waiverCulture === 'quiet') {
    patterns.push('Passive waiver market — breakout players sit unclaimed longer. Be aggressive on adds.')
  }
  if (waiverCulture === 'chaotic') {
    patterns.push('Chaotic waiver market — FAAB overspending is common. Be disciplined and pick up the scraps.')
  }
  const tacos = teams.filter(t => t.archetype === 'Taco')
  if (tacos.length >= 2) {
    patterns.push(`${tacos.length} managers consistently overpay in trades — target them for value extraction`)
  }
  const hoarders = teams.filter(t => t.archetype === 'Hoarder')
  if (hoarders.length >= 3) {
    patterns.push('Multiple hoarders — assets are locked up. Focus on waivers and the few active traders.')
  }
  return patterns.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeLeagueMeta(input: LeagueMetaInput): LeagueMetaResult {
  const tradingCulture = classifyTradingCulture(input.totalTradesThisSeason, input.numTeams)
  const waiverCulture = classifyWaiverCulture(input.totalWaiverClaimsThisSeason, input.numTeams)
  const riskCulture = classifyRiskCulture(input.teams)
  const hoarded = detectHoardedPositions(input.teams, input.numTeams)
  const distortions = detectDistortions(input.teams, tradingCulture)
  const exploitable = detectExploitablePatterns(input.teams, tradingCulture, waiverCulture)

  const archetypeCounts: Record<string, number> = {}
  for (const t of input.teams) {
    if (t.archetype) archetypeCounts[t.archetype] = (archetypeCounts[t.archetype] || 0) + 1
  }
  const managerClusterNotes = Object.entries(archetypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([arch, count]) => `${count} ${arch}${count > 1 ? 's' : ''} in the league`)

  const pickHealth = input.avgPickValue != null
    ? input.avgPickValue >= 5000 ? 'Picks are premium in this league — hold for leverage'
      : input.avgPickValue >= 3000 ? 'Picks are moderately valued — standard market'
      : 'Picks are undervalued — accumulate cheaply'
    : 'Insufficient data to assess pick market'

  const confidence = Math.min(85, 40 + (input.teams.length >= 8 ? 15 : 0) + (input.totalTradesThisSeason >= 5 ? 15 : 0) + (input.totalWaiverClaimsThisSeason >= 10 ? 10 : 0))

  return {
    leagueId: input.leagueId, leagueName: input.leagueName,
    metaSummary: `${input.leagueName} is a ${tradingCulture} trading league with ${waiverCulture} waivers and ${riskCulture} risk tolerance.`,
    confidencePct: confidence, tradingCulture, waiverCulture, riskCulture,
    pickMarketHealth: pickHealth,
    marketDistortions: distortions,
    overvaluedAssets: hoarded.length > 0 ? [`${hoarded[0].split(' —')[0]} assets may be overpriced due to hoarding`] : [],
    undervaluedAssets: tradingCulture === 'dead' ? ['Veterans on passive teams — owners won\'t sell but value is there'] : [],
    hoardedPositions: hoarded, scarcePositions: hoarded.map(h => h.split(' —')[0]),
    exploitablePatterns: exploitable,
    draftCultureNotes: [], waiverNotes: waiverCulture === 'chaotic' ? ['FAAB overspending is rampant — stay disciplined'] : [],
    tradeNotes: tradingCulture === 'dead' ? ['Most managers won\'t engage — focus on the 2-3 active traders'] : [],
    managerClusterNotes, bestExploitationStrategies: exploitable.slice(0, 3),
    cautionFlags: tradingCulture === 'dead' ? ['League may resist trades — be patient'] : [],
    metaTags: [tradingCulture, waiverCulture, riskCulture, input.leagueType],
    summary: `${input.leagueName}: ${tradingCulture} trading, ${waiverCulture} waivers, ${riskCulture} risk. ${distortions[0] ?? 'Standard market dynamics.'}`,
    generatedAt: new Date().toISOString(),
  }
}
