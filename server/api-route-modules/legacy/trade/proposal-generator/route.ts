import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { pricePlayer, pricePick, PricedAsset, ValuationContext, PickInput } from '@/lib/hybrid-valuation'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { getCachedOpponentProfile, formatOpponentForPrompt } from '@/lib/opponent-tendencies'
import { z } from 'zod'
import { autoLogDecision } from '@/lib/decision-log'
import { computeConfidenceRisk, getHistoricalHitRate, type AssetContext } from '@/lib/analytics/confidence-risk-engine'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'
import { createLegacyPackageGrader, legacySessionUserId } from '@/lib/legacy/legacyOneGrade'
import { gradeInputsFromRosterAssets, type LegacyPackageGrade } from '@/lib/legacy/legacyPackageGrade'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/*
 * 🛑 EVERY PROPOSAL THIS GENERATOR SHOWS CARRIES THE ONE TRADE GRADE (2026-09-29).
 *
 * It used to score its own packages "fairness N/100" on its FantasyCalc totals, run a separate
 * acceptance model ("computed acceptance likelihood is N%"), rank the packages by that acceptance,
 * and label them "Slight Edge" / "Fair & Balanced" / "Overpay" — three verdicts, none of them the
 * letter the full analyzer on the same page gives the same deal.
 *
 * It still BUILDS the packages the same way (value-matched combinations from your roster; the
 * FantasyCalc totals only choose which assets go in). What it SHOWS about each one is THE grade from
 * `lib/legacy/legacyOneGrade.ts`, from your side, taken before the AI writes a word — so the pitch
 * explains the letter instead of inventing one. The labels now say how a package was built, not who
 * wins it. No acceptance odds: nothing measured them.
 */
export const PROPOSAL_LABELS = {
  /** You send less than you ask for, on the builder's values. */
  lighter: 'Lighter offer',
  /** About what you ask for. */
  matched: 'Matched offer',
  /** More than you ask for. */
  stronger: 'Stronger offer',
} as const

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
): { label: string; myOffer: PricedRosterAsset[]; theirOffer: PricedRosterAsset[]; builtGapPct: number } | null {
  const targetValue = desiredTotal * ratioTarget
  const lowBound = desiredTotal * ratioLow
  const highBound = desiredTotal * ratioHigh

  const combo = findBestCombination(myAssets, targetValue, lowBound, highBound)
  if (!combo) return null

  const myTotal = combo.reduce((s, a) => s + a.value, 0)
  return {
    label,
    myOffer: combo,
    theirOffer: desiredAssets,
    // How far the BUILD landed from the ask, on the builder's own values. Only filters packages; never shown.
    builtGapPct: Math.round((Math.abs(desiredTotal - myTotal) / Math.max(desiredTotal, 1)) * 100),
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
      fcPlayers = await getFantasyCalcValuesDbFirst({
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

    // Labels say how each package was BUILT (less, about the same, more than the ask on the builder's
    // values). Whether it is a good deal is the one grade's call, below.
    const lighter = buildProposal(availablePool, pricedDesired, desiredTotal, PROPOSAL_LABELS.lighter, 0.88, 0.96, 0.92)
    const matched = buildProposal(availablePool, pricedDesired, desiredTotal, PROPOSAL_LABELS.matched, 0.96, 1.06, 1.00)
    const stronger = buildProposal(availablePool, pricedDesired, desiredTotal, PROPOSAL_LABELS.stronger, 1.08, 1.25, 1.15)

    const MAX_BUILT_GAP_PCT = 20
    const proposals = [lighter, matched, stronger]
      .filter((p): p is NonNullable<typeof p> => p != null && p.builtGapPct <= MAX_BUILT_GAP_PCT)

    if (proposals.length === 0) {
      return NextResponse.json({
        error: 'Could not find viable trade combinations from your roster. The assets you want may be too valuable or your tradeable assets may not match well.',
      }, { status: 400 })
    }

    /*
     * THE grade of every package, from your side (you send `myOffer`), BEFORE the AI is asked
     * anything — so the pitch it writes explains the letter rather than deciding one.
     */
    const gradeOf = await createLegacyPackageGrader({
      suppliedLeagueId: parsed.data.leagueId,
      userId: await legacySessionUserId(),
      viewerSide: false,
    })
    const grades: LegacyPackageGrade[] = await Promise.all(
      proposals.map((p) => gradeOf(gradeInputsFromRosterAssets(p.myOffer), gradeInputsFromRosterAssets(p.theirOffer))),
    )

    const proposalSummaries = proposals.map((p, i) => {
      const g = grades[i]!
      const myNames = p.myOffer.map(a => `${a.name} (${a.type === 'pick' ? 'Pick' : a.pos || 'Player'})`).join(', ')
      const theirNames = p.theirOffer.map(a => `${a.name} (${a.type === 'pick' ? 'Pick' : a.pos || 'Player'})`).join(', ')
      const verdict = g.graded
        ? `AllFantasy trade grade for ${username}: ${g.letter} ("${g.label}"), on league values ${g.giveValue} sent vs ${g.getValue} received.`
        : `Not graded: ${g.reason}`
      return `${p.label}: You send [${myNames}] for [${theirNames}]. ${verdict}`
    }).join('\n\n')

    const myRosterSummary = pricedMyAssets
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(a => `${a.name} (${a.pos || a.type})`)
      .join(', ')

    const targetRosterSummary = pricedTargetAssets
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(a => `${a.name} (${a.pos || a.type})`)
      .join(', ')

    let aiExplanations: any = {}

    let opponentAddendum = '';
    try {
      const targetRId = typeof parsed.data.targetRosterId === 'string'
        ? parseInt(parsed.data.targetRosterId)
        : parsed.data.targetRosterId;
      if (targetRId && parsed.data.leagueId) {
        const opponentProfile = await getCachedOpponentProfile(parsed.data.leagueId, targetRId);
        if (opponentProfile && opponentProfile.confidence >= 0.15) {
          opponentAddendum = formatOpponentForPrompt(opponentProfile);
        }
      }
    } catch {}

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

Each proposal already carries AllFantasy's trade grade. That grade is FINAL and is what the user sees: explain it, never argue for a different one, never give your own letter, fairness score, value estimate or acceptance percentage. If the grade says the trade favors one side, say so — don't dress it up.

Keep explanations concise but insightful (2-3 sentences each). Consider team needs, roster construction, and competitive windows.${opponentAddendum}`
        }, {
          role: 'user',
          content: `Analyze these trade proposals between ${username} (${myTeam.displayName}) and ${targetTeam.displayName}.

${username}'s team (${myTeam.record?.wins ?? '?'}-${myTeam.record?.losses ?? '?'}):
Top assets: ${myRosterSummary}

${targetTeam.displayName} (${targetTeam.record?.wins ?? '?'}-${targetTeam.record?.losses ?? '?'}):
${targetRosterSummary}

PROPOSALS (each with its AllFantasy trade grade):
${proposalSummaries}

For each proposal (${PROPOSAL_LABELS.lighter}, ${PROPOSAL_LABELS.matched}, ${PROPOSAL_LABELS.stronger}), provide:
- "theirPitch": why this trade appeals to ${targetTeam.displayName} (2-3 sentences). Be honest about what the grade says.
- "yourAdvantage": what ${username} gains strategically (1-2 sentences)
- "tradePitch": a message ${username} could send to propose this trade (1-2 sentences, casual tone)

Respond in JSON format:
{
  "proposals": {
    "lighter": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string },
    "matched": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string },
    "stronger": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string }
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
      [PROPOSAL_LABELS.lighter]: 'lighter',
      [PROPOSAL_LABELS.matched]: 'matched',
      [PROPOSAL_LABELS.stronger]: 'stronger',
    }

    // The builder's values chose the assets; they are not printed — the grade's league values are.
    const shown = (a: PricedRosterAsset) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      pos: a.pos,
      team: a.team,
      pickYear: a.pickYear,
      pickRound: a.pickRound,
    })

    const finalProposals = proposals.map((p, i) => {
      const key = labelToKey[p.label] || ''
      const ai = aiExplanations[key] || {}
      return {
        label: p.label,
        myOffer: p.myOffer.map(shown),
        theirOffer: p.theirOffer.map(shown),
        /** THE trade grade, from your side (you send `myOffer`). Withheld with a reason, never guessed. */
        grade: grades[i]!,
        theirPitch: ai.theirPitch ?? null,
        yourAdvantage: ai.yourAdvantage ?? null,
        tradePitch: ai.tradePitch ?? null,
      }
    })

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

    proposals.forEach((p, i) => {
      const g = grades[i]!
      logTradeOfferEvent({
        leagueId: parsed.data.leagueId,
        senderUserId: parsed.data.username,
        opponentUserId: String(parsed.data.targetRosterId),
        assetsGiven: p.myOffer.map((a) => ({ name: a.name, value: a.value })),
        assetsReceived: p.theirOffer.map((a) => ({ name: a.name, value: a.value })),
        acceptProb: null,
        verdict: g.graded ? g.letter : null,
        confidenceScore: crResult.confidenceScore01,
        mode: 'PROPOSAL_GENERATOR',
        isSuperFlex: parsed.data.isSuperFlex ?? null,
        leagueFormat: parsed.data.format ?? null,
      }).catch(() => {})
    })

    return NextResponse.json({
      success: true,
      proposals: finalProposals,
      opponentTendencies: null, // Private inputs may inform internal calculations, never the public dossier.
      confidenceRisk: {
        confidence: crResult.numericConfidence,
        level: crResult.confidenceLevel,
        volatility: crResult.volatilityLevel,
        riskProfile: crResult.riskProfile,
        riskTags: crResult.riskTags,
        explanation: crResult.explanation,
      },
    })

  } catch (e) {
    console.error('proposal-generator error:', e)
    return NextResponse.json({ error: 'Failed to generate trade proposals' }, { status: 500 })
  }
})
