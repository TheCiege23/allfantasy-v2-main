// ============================================
// LAYER C: AI LAYER (Controlled)
// ============================================
// AI operates ONLY on deterministic outputs.
// AI is FORBIDDEN to:
//   - Decide player/pick value
//   - Ignore scoring format
//   - Override cornerstone/premium rules
//   - Invent "surplus/need" without proof

import {
  LeagueIntelligence,
  ManagerProfile,
  TradeCandidate,
  Asset
} from './types'

// ============================================
// AI OUTPUT TYPES
// ============================================

export interface AITargetRecommendation {
  managerId: string
  managerName: string
  whyTarget: string[]
  bestOffers: string[]
  messageTemplate: string
}

export interface AIRestructuredOffer {
  basedOnOfferId: string
  newOffer: {
    userGives: string[]
    userGets: string[]
  } | null
  whyMoreAcceptable: string[]
}

export interface AIRiskAnalysis {
  offerId: string
  riskSummary: string[]
  timingSummary: string[]
  whoBenefitsNow: string
  whoBenefitsLater: string
}

// ============================================
// PROMPT BUILDERS
// ============================================

export function buildTargetRecommendationPrompt(
  intelligence: LeagueIntelligence,
  userRosterId: number
): string {
  const userProfile = intelligence.managerProfiles[userRosterId]
  if (!userProfile) return ''

  const managerSummaries = Object.values(intelligence.managerProfiles)
    .filter(m => m.rosterId !== userRosterId)
    .map(m => {
      const pickCount = (m.assets || []).filter(a => a.type === 'PICK').length
      const cornerstones = (m.assets || []).filter(a => a.isCornerstone).map(a => a.name || `${a.pickSeason} ${a.round}rd`)
      return `- ${m.displayName}: ${m.contenderTier} (${m.record?.wins ?? 0}-${m.record?.losses ?? 0})
  Needs: ${m.needs.join(', ') || 'None'}
  Surplus: ${m.surplus.join(', ') || 'None'}
  Picks: ${pickCount} | Trade Activity: ${m.tradeAggression}
  Cornerstones: ${cornerstones.slice(0, 3).join(', ') || 'None'}
  Prefers: ${m.prefersYouth ? 'Youth' : 'Production'}, ${m.prefersPicks ? 'Picks' : 'Players'}, ${m.prefersConsolidation ? 'Consolidation' : 'Depth'}`
    })
    .join('\n\n')

  const userNeeds = userProfile.needs.join(', ') || 'None identified'
  const userSurplus = userProfile.surplus.join(', ') || 'None identified'
  const userCornerstones = (userProfile.assets || []).filter(a => a.isCornerstone).map(a => a.name).join(', ')

  return `## YOUR TASK
Identify the 3-5 BEST trade partners for the user based on roster fit and trading tendencies.

## USER PROFILE
- Direction: ${userProfile.contenderTier} (${userProfile.record?.wins ?? 0}-${userProfile.record?.losses ?? 0})
- Needs: ${userNeeds}
- Surplus: ${userSurplus}
- Cornerstones: ${userCornerstones || 'None'}

## LEAGUE MANAGERS
${managerSummaries}

## INSTRUCTIONS
1. Identify managers whose NEEDS match user's SURPLUS
2. Identify managers whose SURPLUS match user's NEEDS
3. Prioritize active traders (high trade activity)
4. Consider direction alignment (contender trading with rebuilder is ideal)
5. DO NOT suggest trades - only rank and explain WHY each manager is a good target

## OUTPUT FORMAT (JSON)
{
  "recommendations": [
    {
      "managerId": "...",
      "managerName": "...",
      "whyTarget": ["Reason 1", "Reason 2"],
      "bestAssetCategories": ["Their RB surplus for your WR need", ...]
    }
  ]
}`
}

export function buildRestructurePrompt(
  rejectedTrade: { give: Asset[]; receive: Asset[]; reasons: string[] },
  userRosterId: number,
  targetRosterId: number,
  intelligence: LeagueIntelligence,
  constraints: { maxAssetsPerSide: number; cornerstonePremiumMin: number }
): string {
  const userProfile = intelligence.managerProfiles[userRosterId]
  const targetProfile = intelligence.managerProfiles[targetRosterId]
  if (!userProfile || !targetProfile) return ''

  const giveNames = rejectedTrade.give.map(a => 
    a.type === 'PLAYER' ? `${a.name} (${a.pos}, $${a.value})` :
    a.type === 'PICK' ? `${a.pickSeason} ${a.round}rd ($${a.value})` :
    `$${a.faabAmount} FAAB`
  ).join(' + ')

  const getNames = rejectedTrade.receive.map(a =>
    a.type === 'PLAYER' ? `${a.name} (${a.pos}, $${a.value})` :
    a.type === 'PICK' ? `${a.pickSeason} ${a.round}rd ($${a.value})` :
    `$${a.faabAmount} FAAB`
  ).join(' + ')

  const userAvailable = (userProfile.assets || [])
    .filter(a => !rejectedTrade.give.some(g => g.id === a.id))
    .slice(0, 20)
    .map(a => a.type === 'PLAYER' ? `${a.name} (${a.pos}, $${a.value})` : `${a.pickSeason} ${a.round}rd ($${a.value})`)
    .join(', ')

  const targetAvailable = (targetProfile.assets || [])
    .filter(a => !rejectedTrade.receive.some(g => g.id === a.id))
    .slice(0, 20)
    .map(a => a.type === 'PLAYER' ? `${a.name} (${a.pos}, $${a.value})` : `${a.pickSeason} ${a.round}rd ($${a.value})`)
    .join(', ')

  return `## YOUR TASK
Restructure a rejected trade to satisfy the constraints.

## REJECTED TRADE
User gives: ${giveNames}
User gets: ${getNames}

## REJECTION REASONS
${rejectedTrade.reasons.map(r => `- ${r}`).join('\n')}

## CONSTRAINTS TO SATISFY
- Max ${constraints.maxAssetsPerSide} assets per side
- Cornerstone trades require ${((constraints.cornerstonePremiumMin - 1) * 100).toFixed(0)}% premium
- Value ratio must be 0.92-1.08 for standard trades
- No more than 1 filler (<$1000) per side

## USER'S OTHER AVAILABLE ASSETS
${userAvailable}

## TARGET'S OTHER AVAILABLE ASSETS
${targetAvailable}

## INSTRUCTIONS
1. Identify which constraint was violated
2. Suggest SPECIFIC swaps to fix the issue
3. Keep the core intent (e.g., if user wanted their WR, keep targeting a WR)
4. Only use assets from the available lists above
5. DO NOT invent values - use the values shown

## OUTPUT FORMAT (JSON)
{
  "restructuredOffer": {
    "userGives": ["Player Name ($value)", ...],
    "userGets": ["Player Name ($value)", ...],
    "whyFixed": ["Reason 1", "Reason 2"]
  }
}`
}

export function buildRiskAnalysisPrompt(
  trade: TradeCandidate,
  intelligence: LeagueIntelligence
): string {
  const userProfile = intelligence.managerProfiles[trade.fromRosterId]
  const targetProfile = intelligence.managerProfiles[trade.toRosterId]
  if (!userProfile || !targetProfile) return ''

  const userGivesDesc = trade.give.map(a => {
    if (a.type === 'PLAYER') {
      return `${a.name} (${a.pos}, age ${a.age || '?'}, $${a.value})`
    }
    if (a.type === 'PICK') {
      return `${a.pickSeason} ${a.round}rd (proj ${a.projected}, $${a.value})`
    }
    return `$${a.faabAmount} FAAB`
  }).join(' + ')

  const userGetsDesc = trade.receive.map(a => {
    if (a.type === 'PLAYER') {
      return `${a.name} (${a.pos}, age ${a.age || '?'}, $${a.value})`
    }
    if (a.type === 'PICK') {
      return `${a.pickSeason} ${a.round}rd (proj ${a.projected}, $${a.value})`
    }
    return `$${a.faabAmount} FAAB`
  }).join(' + ')

  return `## YOUR TASK
Provide risk/timing analysis for this trade. Focus on uncertainty factors.

## TRADE
User (${userProfile.contenderTier}) gives: ${userGivesDesc}
User (${userProfile.contenderTier}) gets: ${userGetsDesc}

## DETERMINISTIC ANALYSIS (DO NOT OVERRIDE)
- Fairness Score: ${(trade.fairnessScore * 100).toFixed(0)}%
- Value Ratio: ${(trade.valueRatio * 100).toFixed(0)}%
- Label: ${trade.acceptanceLabel}

## INSTRUCTIONS
You may ONLY discuss:
1. Injury history/risk for players involved
2. Age curve projections (RB cliff at 28, QB longevity)
3. Role security (depth chart, target share, snap count)
4. Timeline alignment (contender windows, rebuild horizons)
5. Draft class quality for picks involved

You CANNOT:
- Change the fairness score or value ratio
- Claim a player is worth more/less than shown
- Override the trade label
- Invent roster needs not in the profile

## OUTPUT FORMAT (JSON)
{
  "riskFactors": ["Risk 1", "Risk 2"],
  "timingFactors": ["Timing consideration 1", ...],
  "whoBenefitsNow": "Brief answer",
  "whoBenefitsLater": "Brief answer"
}`
}

export function buildMessagingPrompt(
  trade: TradeCandidate,
  targetProfile: ManagerProfile
): string {
  const userGives = trade.give.map(a => a.name || `${a.pickSeason} ${a.round}rd`).join(' + ')
  const userGets = trade.receive.map(a => a.name || `${a.pickSeason} ${a.round}rd`).join(' + ')

  return `## YOUR TASK
Write a trade proposal message tailored to the target manager's style.

## TRADE SUMMARY
Offering: ${userGives}
Requesting: ${userGets}

## TARGET MANAGER PROFILE
- Name: ${targetProfile.displayName}
- Direction: ${targetProfile.contenderTier}
- Trade Activity: ${targetProfile.tradeAggression}
- Prefers: ${targetProfile.prefersYouth ? 'Youth' : 'Production'}, ${targetProfile.prefersPicks ? 'Picks' : 'Players'}

## WHY THEY SHOULD ACCEPT (DETERMINISTIC - USE THESE)
${trade.explanation.whyTheyAccept.map(r => `- ${r}`).join('\n')}

## INSTRUCTIONS
1. Keep it brief (2-3 sentences max)
2. Reference THEIR needs/situation
3. Use the deterministic reasons above - DO NOT invent new reasons
4. Match their trading style (aggressive traders want quick responses, conservative want explanation)

## OUTPUT FORMAT (JSON)
{
  "message": "Your trade proposal message here"
}`
}

// ============================================
// PROMPT TEMPLATES FOR EXTERNAL AI CALLS
// ============================================

export const AI_PROMPTS = {
  TARGET_RECOMMENDATION: buildTargetRecommendationPrompt,
  RESTRUCTURE: buildRestructurePrompt,
  RISK_ANALYSIS: buildRiskAnalysisPrompt,
  MESSAGING: buildMessagingPrompt
}

// ============================================
// VALIDATION HELPERS
// ============================================

export function validateAITargetResponse(response: any): AITargetRecommendation[] {
  if (!response?.recommendations || !Array.isArray(response.recommendations)) {
    return []
  }

  return response.recommendations
    .filter((r: any) => r.managerId && r.managerName && Array.isArray(r.whyTarget))
    .map((r: any) => ({
      managerId: r.managerId,
      managerName: r.managerName,
      whyTarget: r.whyTarget,
      bestOffers: r.bestAssetCategories || [],
      messageTemplate: ''
    }))
}

export function validateAIRestructureResponse(response: any): AIRestructuredOffer | null {
  if (!response?.restructuredOffer) {
    return null
  }

  const ro = response.restructuredOffer
  if (!Array.isArray(ro.userGives) || !Array.isArray(ro.userGets)) {
    return null
  }

  return {
    basedOnOfferId: 'rejected',
    newOffer: {
      userGives: ro.userGives,
      userGets: ro.userGets
    },
    whyMoreAcceptable: ro.whyFixed || []
  }
}

export function validateAIRiskResponse(response: any, offerId: string): AIRiskAnalysis {
  return {
    offerId,
    riskSummary: response?.riskFactors || [],
    timingSummary: response?.timingFactors || [],
    whoBenefitsNow: response?.whoBenefitsNow || 'Unknown',
    whoBenefitsLater: response?.whoBenefitsLater || 'Unknown'
  }
}

// ============================================
// RUNTIME AI ASSIST (USES OPENAI)
// ============================================

import OpenAI from 'openai'
import { LeagueIntelSnapshot } from './types'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'

let openai: OpenAI | null = null

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns null when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return null

  if (!apiKey) return null
  if (!openai) {
    openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    })
  }
  return openai
}

export async function runAiAssist(params: {
  snapshot: LeagueIntelSnapshot
  userRosterId: number
  trades: TradeCandidate[]
}) {
  const top = params.trades.slice(0, 10)

  const prompt = `
You are AllFantasy Trade Assistant.

IMPORTANT RULES:
- You may NOT change assets, values, fairness scores, or veto likelihood.
- You may NOT invent roster needs or surplus. Use only what's provided.
- Your job is to:
  (1) Rank the best 3 target managers to approach first
  (2) Provide a short message template per target
  (3) Provide risk/timing explanation for each top trade

Data:
league: ${JSON.stringify({ name: params.snapshot.league.leagueName, isSF: params.snapshot.league.isSF, isTEP: params.snapshot.league.isTEP }, null, 2)}
profilesByRosterId: ${JSON.stringify(params.snapshot.profilesByRosterId, null, 2)}
topTrades: ${JSON.stringify(top, null, 2)}

Return JSON ONLY:
{
  "targets": [
    {
      "toRosterId": number,
      "why": ["...","..."],
      "messageTemplate": "..."
    }
  ],
  "tradeNotes": [
    {
      "tradeId": "string",
      "riskNarrative": ["...","..."],
      "timingNarrative": ["...","..."]
    }
  ]
}
`

  try {
    const client = getOpenAIClient()
    if (!client) return params.trades

    const r = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    })

    const content = r.choices[0]?.message?.content || '{}'
    let json: any = {}
    try { json = JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '')) } catch { json = {} }

    const byId = new Map(params.trades.map(t => [t.id || t.offerId, t]))
    for (const note of (json.tradeNotes || [])) {
      const t = byId.get(note.tradeId)
      if (!t) continue
      if (!t.ai) t.ai = {}
      t.ai.riskNarrative = Array.isArray(note.riskNarrative) ? note.riskNarrative : undefined
      t.ai.timingNarrative = Array.isArray(note.timingNarrative) ? note.timingNarrative : undefined
    }

    const targetMap = new Map<number, any>()
    for (const t of (json.targets || [])) targetMap.set(t.toRosterId, t)

    for (const trade of params.trades) {
      const t = targetMap.get(trade.toRosterId)
      if (!t) continue
      if (!trade.ai) trade.ai = {}
      trade.ai.targetWhy = Array.isArray(t.why) ? t.why : undefined
      trade.ai.messageTemplate = typeof t.messageTemplate === 'string' ? t.messageTemplate : undefined
    }
  } catch (err) {
    console.error('[AI Assist] Error:', err)
  }

  return params.trades
}


