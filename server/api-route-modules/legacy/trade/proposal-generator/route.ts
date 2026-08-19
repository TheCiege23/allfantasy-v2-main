import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { pricePlayer, pricePick, PricedAsset, ValuationContext, PickInput } from '@/lib/hybrid-valuation'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc'
import { getCachedDNA } from '@/lib/manager-dna'
import { getCachedOpponentProfile, formatOpponentForPrompt } from '@/lib/opponent-tendencies'
import { z } from 'zod'
import { autoLogDecision } from '@/lib/decision-log'
import { computeConfidenceRisk, getHistoricalHitRate, type AssetContext } from '@/lib/analytics/confidence-risk-engine'
import { computeTradeAcceptance, suggestOptimizations, type TradeAcceptanceInput } from '@/lib/analytics/trade-acceptance'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RequestSchema = z.object({
  leagueId: z.string().min(1),
  username: z.string().min(1),
  myRosterId: z.string().or(z.number()),
  targetRosterId: z.string().or(z.number()),
  desiredAssets: z.array(z.object({
    type: z.enum(['player', 'pick']),
    id: z.string().optional(),
    name: z.string(),
    pos: z.string().optional(),
    team: z.string().optional(),
    pickYear: z.number().optional(),
    pickRound: z.number().optional(),
    pickSlot: z.number().optional().nullable(),
    originalOwner: z.string().optional(),
  })),
  myTeam: z.object({
    displayName: z.string(),
    players: z.array(z.object({
      id: z.string(),
      name: z.string(),
      pos: z.string(),
      team: z.string().optional(),
    })),
    draftPicks: z.array(z.object({
      season: z.string(),
      round: z.number(),
      slot: z.number().optional().nullable(),
      originalOwner: z.string().optional(),
      originalRosterId: z.number().optional(),
    })).optional().default([]),
    record: z.object({ wins: z.number(), losses: z.number() }).optional(),
  }),
  targetTeam: z.object({
    displayName: z.string(),
    players: z.array(z.object({
      id: z.string(),
      name: z.string(),
      pos: z.string(),
      team: z.string().optional(),
    })),
    draftPicks: z.array(z.object({
      season: z.string(),
      round: z.number(),
      slot: z.number().optional().nullable(),
      originalOwner: z.string().optional(),
      originalRosterId: z.number().optional(),
    })).optional().default([]),
    record: z.object({ wins: z.number(), losses: z.number() }).optional(),
  }),
  format: z.enum(['dynasty', 'redraft']).default('dynasty'),
  isSuperFlex: z.boolean().default(false),
})

interface PricedRosterAsset {
  type: 'player' | 'pick'
  id?: string
  name: string
  pos?: string
  team?: string
  value: number
  source: string
  pickYear?: number
  pickRound?: number
  pickSlot?: number | null
  originalOwner?: string
}

async function priceTeamAssets(
  team: z.infer<typeof RequestSchema>['myTeam'],
  ctx: ValuationContext
): Promise<PricedRosterAsset[]> {
  const playerPrices = await Promise.all(
    team.players.map(async (p) => {
      const priced = await pricePlayer(p.name, ctx)
      return {
        type: 'player' as const,
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        value: priced.value,
        source: priced.source,
      }
    })
  )

  const pickPrices = await Promise.all(
    (team.draftPicks || []).map(async (pk) => {
      const pickInput: PickInput = {
        year: parseInt(pk.season) || new Date().getFullYear(),
        round: pk.round,
        tier: null,
      }
      const priced = await pricePick(pickInput, ctx)
      return {
        type: 'pick' as const,
        name: priced.name,
        value: priced.value,
        source: priced.source,
        pickYear: pickInput.year,
        pickRound: pk.round,
        pickSlot: pk.slot,
        originalOwner: pk.originalOwner,
      }
    })
  )

  return [...playerPrices, ...pickPrices]
}

async function priceDesiredAssets(
  assets: z.infer<typeof RequestSchema>['desiredAssets'],
  ctx: ValuationContext
): Promise<PricedRosterAsset[]> {
  return Promise.all(
    assets.map(async (a) => {
      if (a.type === 'player') {
        const priced = await pricePlayer(a.name, ctx)
        return {
          type: 'player' as const,
          id: a.id,
          name: a.name,
          pos: a.pos,
          team: a.team,
          value: priced.value,
          source: priced.source,
        }
      } else {
        const pickInput: PickInput = {
          year: a.pickYear || new Date().getFullYear(),
          round: a.pickRound || 1,
          tier: null,
        }
        const priced = await pricePick(pickInput, ctx)
        return {
          type: 'pick' as const,
          name: priced.name,
          value: priced.value,
          source: priced.source,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
          pickSlot: a.pickSlot,
          originalOwner: a.originalOwner,
        }
      }
    })
  )
}

function findBestCombination(
  pool: PricedRosterAsset[],
  targetValue: number,
  toleranceLow: number,
  toleranceHigh: number,
  maxAssets: number = 5
): PricedRosterAsset[] | null {
  const sorted = [...pool]
    .filter(a => a.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 25)

  let bestCombo: PricedRosterAsset[] | null = null
  let bestDiff = Infinity

  for (let size = 1; size <= Math.min(maxAssets, sorted.length); size++) {
    const combos = getCombinations(sorted, size)
    for (const combo of combos) {
      const total = combo.reduce((s, a) => s + a.value, 0)
      if (total >= toleranceLow && total <= toleranceHigh) {
        const diff = Math.abs(total - targetValue)
        if (diff < bestDiff) {
          bestDiff = diff
          bestCombo = combo
        }
      }
    }
  }

  if (!bestCombo) {
    let closestCombo: PricedRosterAsset[] | null = null
    let closestDiff = Infinity
    for (let size = 1; size <= Math.min(maxAssets, sorted.length); size++) {
      const combos = getCombinations(sorted, size)
      for (const combo of combos) {
        const total = combo.reduce((s, a) => s + a.value, 0)
        const diff = Math.abs(total - targetValue)
        if (diff < closestDiff && total >= toleranceLow * 0.85) {
          closestDiff = diff
          closestCombo = combo
        }
      }
    }
    bestCombo = closestCombo
  }

  return bestCombo
}

function getCombinations(arr: PricedRosterAsset[], size: number): PricedRosterAsset[][] {
  if (size === 1) return arr.map(a => [a])
  const result: PricedRosterAsset[][] = []
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1)
    for (const combo of rest) {
      result.push([arr[i], ...combo])
    }
    if (result.length > 2000) break
  }
  return result
}

function buildProposal(
  myAssets: PricedRosterAsset[],
  desiredAssets: PricedRosterAsset[],
  desiredTotal: number,
  label: string,
  ratioLow: number,
  ratioHigh: number,
  ratioTarget: number
): { label: string; myOffer: PricedRosterAsset[]; theirOffer: PricedRosterAsset[]; myTotal: number; theirTotal: number; delta: number; fairnessScore: number } | null {
  const targetValue = desiredTotal * ratioTarget
  const lowBound = desiredTotal * ratioLow
  const highBound = desiredTotal * ratioHigh

  const combo = findBestCombination(myAssets, targetValue, lowBound, highBound)
  if (!combo) return null

  const myTotal = combo.reduce((s, a) => s + a.value, 0)
  const delta = desiredTotal - myTotal
  const fairnessScore = Math.max(0, Math.min(100, 100 - Math.abs(delta / Math.max(desiredTotal, 1)) * 100))

  return {
    label,
    myOffer: combo,
    theirOffer: desiredAssets,
    myTotal,
    theirTotal: desiredTotal,
    delta,
    fairnessScore: Math.round(fairnessScore),
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/proposal-generator", tool: "LegacyTradeProposalGenerator" })(async (req: NextRequest) => {
  const authResult = requireAuthOrOrigin(req)
  if (!authResult.authenticated) return forbiddenResponse(authResult.error || 'Unauthorized')

  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'trade_proposal',
    ip,
    maxRequests: 10,
    windowMs: 60_000,
    includeIpInKey: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before generating more proposals.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  try {
    const body = await req.json()
    const parsed = RequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    const {
      myTeam,
      targetTeam,
      desiredAssets,
      format,
      isSuperFlex,
      username,
    } = parsed.data

    const today = new Date().toISOString().split('T')[0]
    let fcPlayers: any[] | undefined
    try {
      fcPlayers = await fetchFantasyCalcValues({
        isDynasty: format === 'dynasty',
        numQbs: isSuperFlex ? 2 : 1,
        numTeams: 12,
        ppr: 1,
      })
    } catch {
      fcPlayers = []
    }

    const ctx: ValuationContext = {
      asOfDate: today,
      isSuperFlex,
      fantasyCalcPlayers: fcPlayers,
    }

    const [pricedMyAssets, pricedDesired, pricedTargetAssets] = await Promise.all([
      priceTeamAssets(myTeam, ctx),
      priceDesiredAssets(desiredAssets, ctx),
      priceTeamAssets(targetTeam, ctx),
    ])

    const desiredTotal = pricedDesired.reduce((s, a) => s + a.value, 0)

    if (desiredTotal === 0) {
      return NextResponse.json({
        error: 'Could not determine value for the selected assets. Try different players or picks.',
      }, { status: 400 })
    }

    const MIN_ASSET_VALUE = 5
    const availablePool = pricedMyAssets.filter(a => a.value >= MIN_ASSET_VALUE)

    const slightEdge = buildProposal(availablePool, pricedDesired, desiredTotal, 'Slight Edge', 0.88, 0.96, 0.92)
    const even = buildProposal(availablePool, pricedDesired, desiredTotal, 'Fair & Balanced', 0.96, 1.06, 1.00)
    const theyWin = buildProposal(availablePool, pricedDesired, desiredTotal, 'Overpay', 1.08, 1.25, 1.15)

    const MIN_FAIRNESS = 80
    const proposals = [slightEdge, even, theyWin]
      .filter((p): p is NonNullable<typeof p> => p != null && p.fairnessScore >= MIN_FAIRNESS)

    if (proposals.length === 0) {
      return NextResponse.json({
        error: 'Could not find viable trade combinations from your roster. The assets you want may be too valuable or your tradeable assets may not match well.',
      }, { status: 400 })
    }

    const proposalSummaries = proposals.map(p => {
      if (!p) return ''
      const myNames = p.myOffer.map(a => `${a.name} (${a.type === 'pick' ? 'Pick' : a.pos || 'Player'}, val: ${a.value})`).join(', ')
      const theirNames = p.theirOffer.map(a => `${a.name} (${a.type === 'pick' ? 'Pick' : a.pos || 'Player'}, val: ${a.value})`).join(', ')
      return `${p.label}: You send [${myNames}] (total ${p.myTotal}) for [${theirNames}] (total ${p.theirTotal}). Delta: ${p.delta > 0 ? '+' : ''}${p.delta}. Fairness: ${p.fairnessScore}/100.`
    }).join('\n\n')

    const myRosterSummary = pricedMyAssets
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(a => `${a.name} (${a.pos || a.type}, val: ${a.value})`)
      .join(', ')

    const targetRosterSummary = pricedTargetAssets
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(a => `${a.name} (${a.pos || a.type}, val: ${a.value})`)
      .join(', ')

    let aiExplanations: any = {}

    let dnaSystemAddendum = '';
    try {
      const dna = await getCachedDNA(username);
      if (dna) {
        dnaSystemAddendum = `\n\nMANAGER DNA: This user is "${dna.archetype}"${dna.secondaryArchetype ? ` / "${dna.secondaryArchetype}"` : ''}. Tailor your pitch suggestions to their style — e.g. a Gambler likes bold moves, an Architect prefers patient value plays, a Win-Now General wants proven talent.`;
      }
    } catch {}

    let opponentAddendum = '';
    let opponentTendencyData: any = null;
    try {
      const targetRId = typeof parsed.data.targetRosterId === 'string'
        ? parseInt(parsed.data.targetRosterId)
        : parsed.data.targetRosterId;
      if (targetRId && parsed.data.leagueId) {
        const opponentProfile = await getCachedOpponentProfile(parsed.data.leagueId, targetRId);
        if (opponentProfile && opponentProfile.confidence >= 0.15) {
          opponentAddendum = formatOpponentForPrompt(opponentProfile);
          opponentTendencyData = {
            tendencies: opponentProfile.tendencies,
            tradeLikelihood: opponentProfile.tradeLikelihood,
            pitchAngles: opponentProfile.pitchAngles,
            confidence: opponentProfile.confidence,
            tradeCount: opponentProfile.tradeCount,
            seasonsCovered: opponentProfile.seasonsCovered,
          };
        }
      }
    } catch {}

    // Deterministic acceptance model — the single source of truth for "how likely is this
    // accepted", computed from real trade math BEFORE the LLM call. The LLM is given these
    // exact numbers and told to quote them, never estimate its own — previously it generated
    // a second, unreconciled "acceptance" % that could (and did) disagree with this one.
    const acceptanceByLabel = new Map<string, { score: number; factors: any; summary: string; optimizations: any }>()
    for (const p of proposals) {
      const acceptanceInput: TradeAcceptanceInput = {
        fairnessScore: p.fairnessScore,
        valueDelta: p.delta,
        myTotal: p.myTotal,
        theirTotal: p.theirTotal,
        proposedAssets: p.myOffer.map((a: any) => ({
          type: a.type,
          name: a.name,
          pos: a.pos,
          value: a.value,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
        })),
        opponentTendencies: opponentTendencyData?.tendencies || null,
        opponentTradeCount: opponentTendencyData?.tradeCount ?? undefined,
        opponentSeasonsCovered: opponentTendencyData?.seasonsCovered ?? undefined,
        targetRecord: targetTeam.record || null,
        myRecord: myTeam.record || null,
        leagueSize: 12,
        format,
      };
      const acceptance = computeTradeAcceptance(acceptanceInput);
      const optimizations = suggestOptimizations(acceptance, acceptanceInput);
      acceptanceByLabel.set(p.label, {
        score: acceptance.score,
        factors: acceptance.factors,
        summary: acceptance.summary,
        optimizations,
      })
    }

    const acceptanceForPrompt = proposals
      .map(p => `${p.label}: computed acceptance likelihood is ${acceptanceByLabel.get(p.label)?.score ?? '?'}%.`)
      .join('\n')

    try {
      const aiResponse = await openaiChatJson({
        messages: [{
          role: 'system',
          content: `You are AllFantasy's trade proposal analyst. You evaluate fantasy football trade proposals and explain why each option works for both managers.

Your philosophy: Trades are their own ecosystem — both teams should feel they gave up value but got better. Never encourage exploiting managers. Be honest and constructive. League integrity matters more than "winning" a trade.

For each proposal, explain:
1. WHY the other manager would realistically accept this — be honest about weaknesses
2. What makes this proposal attractive to THEM specifically
3. A pitch the user could use when proposing this trade
4. If the trade is lopsided (fairness below 85%), be transparent about that

Keep explanations concise but insightful (2-3 sentences each). Consider team needs, roster construction, and competitive windows. If a trade heavily favors one side, say so — don't dress it up.${dnaSystemAddendum}${opponentAddendum}`
        }, {
          role: 'user',
          content: `Analyze these trade proposals between ${username} (${myTeam.displayName}) and ${targetTeam.displayName}.

${username}'s team (${myTeam.record?.wins ?? '?'}-${myTeam.record?.losses ?? '?'}):
Top assets: ${myRosterSummary}

${targetTeam.displayName} (${targetTeam.record?.wins ?? '?'}-${targetTeam.record?.losses ?? '?'}):
${targetRosterSummary}

PROPOSALS:
${proposalSummaries}

ACCEPTANCE LIKELIHOOD (already computed from real trade math — this is the ONLY acceptance
number that exists; do not estimate your own, do not include an "acceptance" field. If you
reference likelihood anywhere in theirPitch or tradePitch, quote this exact figure):
${acceptanceForPrompt}

For each proposal (Slight Edge, Fair & Balanced, Overpay), provide:
- "theirPitch": why this trade appeals to ${targetTeam.displayName} (2-3 sentences). Be honest about value gaps. If you mention acceptance likelihood, use the exact computed number above — never estimate your own.
- "yourAdvantage": what ${username} gains strategically (1-2 sentences)
- "tradePitch": a message ${username} could send to propose this trade (1-2 sentences, casual tone)
- "fairnessNote": a brief honest assessment of the trade's fairness (1 sentence)

Respond in JSON format:
{
  "proposals": {
    "slightEdge": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string, "fairnessNote": string },
    "even": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string, "fairnessNote": string },
    "overpay": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string, "fairnessNote": string }
  }
}`
        }],
        temperature: 0.7,
        maxTokens: 1200,
      })

      const parsed = parseJsonContentFromChatCompletion(aiResponse)
      if (parsed?.proposals) {
        aiExplanations = parsed.proposals
      }
    } catch (e) {
      console.error('AI explanation generation failed:', e)
    }

    const labelToKey: Record<string, string> = {
      'Slight Edge': 'slightEdge',
      'Fair & Balanced': 'even',
      'Overpay': 'overpay',
    }

    const finalProposals = proposals.map(p => {
      if (!p) return null
      const key = labelToKey[p.label] || ''
      const ai = aiExplanations[key] || {}
      return {
        label: p.label,
        myOffer: p.myOffer.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          pos: a.pos,
          team: a.team,
          value: a.value,
          source: a.source,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
        })),
        theirOffer: p.theirOffer.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          pos: a.pos,
          team: a.team,
          value: a.value,
          source: a.source,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
        })),
        myTotal: p.myTotal,
        theirTotal: p.theirTotal,
        delta: p.delta,
        fairnessScore: p.fairnessScore,
        acceptanceModel: acceptanceByLabel.get(p.label) ?? null,
        theirPitch: ai.theirPitch ?? null,
        yourAdvantage: ai.yourAdvantage ?? null,
        tradePitch: ai.tradePitch ?? null,
        fairnessNote: ai.fairnessNote ?? null,
      }
    }).filter(Boolean)

    const bestAcceptanceIdx = finalProposals.reduce((best, cur, idx) => {
      if (!cur || !cur.acceptanceModel) return best;
      if (best === -1) return idx;
      const bestScore = finalProposals[best]?.acceptanceModel?.score ?? 0;
      return cur.acceptanceModel.score > bestScore ? idx : best;
    }, -1);

    const proposalAssets: AssetContext[] = pricedDesired.map((a: any) => ({
      type: a.type === 'pick' ? 'pick' as const : 'player' as const,
      name: a.name,
      position: a.pos,
      value: a.value,
      pickYear: a.pickYear,
      pickRound: a.pickRound,
    }))

    const hitRate = await getHistoricalHitRate(parsed.data.username, 'trade_proposal', parsed.data.leagueId).catch(() => null)

    const crResult = computeConfidenceRisk({
      category: 'trade_proposal',
      userId: parsed.data.username,
      leagueId: parsed.data.leagueId,
      assets: proposalAssets,
      dataCompleteness: {
        hasHistoricalData: true,
        dataPointCount: pricedDesired.length * 15,
        playerCoverage: 0.9,
        isCommonScenario: true,
      },
      tradeContext: {
        assetCount: pricedDesired.length,
        fairnessScore: finalProposals[1]?.fairnessScore,
      },
      historicalHitRate: hitRate,
    })

    autoLogDecision({
      userId: parsed.data.username,
      leagueId: parsed.data.leagueId,
      decisionType: 'trade_proposal',
      aiRecommendation: {
        summary: `Trade Proposals: ${finalProposals.length} generated`,
        proposalCount: finalProposals.length,
        desiredTotal,
      },
      confidenceScore: crResult.confidenceScore01,
      riskProfile: crResult.riskProfile,
      contextSnapshot: { leagueId: parsed.data.leagueId },
      confidenceRisk: crResult,
    })

    for (const proposal of finalProposals) {
      if (!proposal) continue
      logTradeOfferEvent({
        leagueId: parsed.data.leagueId,
        senderUserId: parsed.data.username,
        opponentUserId: String(parsed.data.targetRosterId),
        assetsGiven: (proposal.myOffer || []).map((a: any) => ({ name: a.name, value: a.value })),
        assetsReceived: (proposal.theirOffer || []).map((a: any) => ({ name: a.name, value: a.value })),
        acceptProb: proposal.acceptanceModel?.score ?? null,
        verdict: proposal.label ?? null,
        confidenceScore: crResult.confidenceScore01,
        mode: 'PROPOSAL_GENERATOR',
        isSuperFlex: parsed.data.isSuperFlex ?? null,
        leagueFormat: parsed.data.format ?? null,
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      proposals: finalProposals,
      desiredTotal,
      bestAcceptanceIndex: bestAcceptanceIdx >= 0 ? bestAcceptanceIdx : null,
      opponentTendencies: opponentTendencyData,
      confidenceRisk: {
        confidence: crResult.numericConfidence,
        level: crResult.confidenceLevel,
        volatility: crResult.volatilityLevel,
        riskProfile: crResult.riskProfile,
        riskTags: crResult.riskTags,
        explanation: crResult.explanation,
      },
      valuationSources: {
        desired: pricedDesired.map(a => ({ name: a.name, value: a.value, source: a.source })),
      },
    })

  } catch (e) {
    console.error('proposal-generator error:', e)
    return NextResponse.json({ error: 'Failed to generate trade proposals' }, { status: 500 })
  }
})
