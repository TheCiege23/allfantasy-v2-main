import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { fetchFantasyCalcValues, findPlayerByName, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { pricePlayer, pricePick, compositeScore, compositeTotal, type ValuationContext, type PricedAsset } from '@/lib/hybrid-valuation'
import { computeValueFairness } from '@/lib/lineup-optimizer'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import { buildInstantNegotiationToolkit } from '@/lib/trade-engine/negotiation-builder'
import { buildNegotiationGptContract, buildNegotiationGptUserPrompt, validateNegotiationGptOutput, shouldSkipNegotiationGpt, NEGOTIATION_GPT_SYSTEM_PROMPT } from '@/lib/trade-engine/negotiation-gpt-contract'
import { buildGptInputContract, buildGptUserPrompt, validateGptNarrativeOutput, shouldSkipGpt, AI_OUTPUT_INVALID_FALLBACK, GPT_NARRATIVE_SYSTEM_PROMPT } from '@/lib/trade-engine/gpt-input-contract'
import type { Asset } from '@/lib/trade-engine/types'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { sendMetaCAPIEvent } from '@/lib/meta-capi'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'
import { logNarrativeValidation } from '@/lib/trade-engine/narrative-validation-logger'

const PICK_PATTERN = /(\d{4})\s*(1st|2nd|3rd|4th|first|second|third|fourth)/i
const ROUND_MAP: Record<string, number> = {
  '1st': 1, 'first': 1,
  '2nd': 2, 'second': 2,
  '3rd': 3, 'third': 3,
  '4th': 4, 'fourth': 4,
}

interface ParsedSide {
  players: string[]
  picks: { year: number; round: number }[]
}

function parseTradeSide(text: string, fcPlayers: FantasyCalcPlayer[]): ParsedSide {
  const players: string[] = []
  const picks: { year: number; round: number }[] = []

  const parts = text
    .split(/[,+&]/)
    .map(s => s.trim())
    .filter(Boolean)

  for (const part of parts) {
    const pickMatch = part.match(PICK_PATTERN)
    if (pickMatch) {
      const year = parseInt(pickMatch[1])
      const roundStr = pickMatch[2].toLowerCase()
      const round = ROUND_MAP[roundStr]
      if (round && year >= 2024 && year <= 2030) {
        picks.push({ year, round })
        continue
      }
    }

    const cleaned = part.replace(/^\d+\.\s*/, '').trim()
    if (cleaned.length >= 3) {
      const found = findPlayerByName(fcPlayers, cleaned)
      players.push(found ? found.player.name : cleaned)
    }
  }

  return { players, picks }
}

function parseTradeText(text: string, fcPlayers: FantasyCalcPlayer[]): { sideA: ParsedSide; sideB: ParsedSide } | null {
  const normalized = text.replace(/\n/g, ' ').trim()

  const primarySeparators = [
    /\bI\s+get\s*:\s*/i,
    /\bI\s+receive\s*:\s*/i,
    /\|/,
    /\bvs\.?\b/i,
  ]

  const forSeparator = /\s+for\s+/i

  const givePatterns = [
    /\bI\s+give\s*:\s*/i,
    /\bI\s+send\s*:\s*/i,
    /\bI\s+trade\s*:\s*/i,
    /\bSide\s*A\s*:\s*/i,
    /\bTeam\s*A\s*:\s*/i,
  ]

  let giveText = ''
  let getText = ''

  for (const givePattern of givePatterns) {
    const giveMatch = normalized.match(givePattern)
    if (giveMatch) {
      const afterGive = normalized.slice(giveMatch.index! + giveMatch[0].length)

      for (const sep of primarySeparators) {
        const sepMatch = afterGive.match(sep)
        if (sepMatch) {
          giveText = afterGive.slice(0, sepMatch.index!).trim()
          getText = afterGive.slice(sepMatch.index! + sepMatch[0].length).trim()
          break
        }
      }

      if (!giveText || !getText) {
        const forMatch = afterGive.match(forSeparator)
        if (forMatch && forMatch.index! > 2) {
          const beforeFor = afterGive.slice(0, forMatch.index!).trim()
          const playerCheck = findPlayerByName(fcPlayers, beforeFor.split(/[,+&]/)[0].trim())
          if (playerCheck || beforeFor.match(PICK_PATTERN)) {
            giveText = beforeFor
            getText = afterGive.slice(forMatch.index! + forMatch[0].length).trim()
          }
        }
      }

      if (giveText && getText) break
    }
  }

  if (!giveText || !getText) {
    for (const sep of primarySeparators) {
      const sepMatch = normalized.match(sep)
      if (sepMatch && sepMatch.index! > 2) {
        giveText = normalized.slice(0, sepMatch.index!).trim()
        getText = normalized.slice(sepMatch.index! + sepMatch[0].length).trim()
        break
      }
    }
  }

  if (!giveText || !getText) {
    const forMatch = normalized.match(forSeparator)
    if (forMatch && forMatch.index! > 2) {
      const beforeFor = normalized.slice(0, forMatch.index!).trim()
      const firstAsset = beforeFor.split(/[,+&]/)[0].trim()
      const playerCheck = findPlayerByName(fcPlayers, firstAsset)
      if (playerCheck || firstAsset.match(PICK_PATTERN)) {
        giveText = beforeFor
        getText = normalized.slice(forMatch.index! + forMatch[0].length).trim()
      }
    }
  }

  if (!giveText || !getText) return null

  giveText = giveText.replace(/^(I\s+give|I\s+send|I\s+trade|Side\s*A|Team\s*A)\s*:?\s*/i, '').trim()
  getText = getText.replace(/^(I\s+get|I\s+receive|Side\s*B|Team\s*B)\s*:?\s*/i, '').trim()

  const sideA = parseTradeSide(giveText, fcPlayers)
  const sideB = parseTradeSide(getText, fcPlayers)

  if (sideA.players.length + sideA.picks.length === 0) return null
  if (sideB.players.length + sideB.picks.length === 0) return null

  return { sideA, sideB }
}

function detectLeagueSize(text: string): number | null {
  const match = text.match(/\b(8|10|12|14|16|32)\s*[-]?\s*(team|tm|teams|league)\b/i)
  return match ? Number(match[1]) : null
}


function pricedToAsset(pa: PricedAsset, pickInfo?: { year: number; round: number }): Asset {
  return {
    id: pa.name,
    type: pa.type === 'pick' ? 'PICK' : 'PLAYER',
    value: pa.value,
    marketValue: pa.assetValue.marketValue,
    impactValue: pa.assetValue.impactValue,
    vorpValue: pa.assetValue.vorpValue,
    volatility: pa.assetValue.volatility,
    name: pa.name,
    pos: pa.position,
    age: pa.age,
    round: pickInfo?.round as any,
  }
}

export const POST = withApiUsage({ endpoint: "/api/instant/trade", tool: "InstantTrade" })(async (req: Request) => {
  try {
    const ip = getClientIp(req as any) || 'unknown'
    const rl = rateLimit(`instant-trade:${ip}`, 10, 60_000)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a minute and try again.' },
        { status: 429 }
      )
    }

    const { tradeText, leagueSize: passedLeagueSize, tePremium, isSuperFlex, eventId, fbp, fbc } = await req.json()

    if (!tradeText || typeof tradeText !== 'string' || tradeText.trim().length < 5) {
      return NextResponse.json({ error: 'Please enter a trade to analyze.' }, { status: 400 })
    }

    if (tradeText.length > 1000) {
      return NextResponse.json({ error: 'Trade text is too long.' }, { status: 400 })
    }

    const VALID_LEAGUE_SIZES = [8, 10, 12, 14, 16, 32]
    const detectedLeagueSize = detectLeagueSize(tradeText)
    const leagueSize = detectedLeagueSize
      ?? (VALID_LEAGUE_SIZES.includes(Number(passedLeagueSize)) ? Number(passedLeagueSize) : 12)

    const fcPlayers = await fetchFantasyCalcValues({
      isDynasty: true,
      numQbs: isSuperFlex ? 2 : 1,
      numTeams: leagueSize,
      ppr: 1,
    })

    const parsed = parseTradeText(tradeText, fcPlayers)

    if (!parsed) {
      return NextResponse.json({
        error: 'Could not parse the trade. Try a format like: "I give: A.J. Brown + 2025 2nd | I get: CeeDee Lamb"',
      }, { status: 400 })
    }

    const ctx: ValuationContext = {
      asOfDate: new Date().toISOString().slice(0, 10),
      isSuperFlex: !!isSuperFlex,
      fantasyCalcPlayers: fcPlayers,
      numTeams: leagueSize,
    }

    const [sideAPlayerValuesRaw, sideBPlayerValuesRaw, sideAPickValues, sideBPickValues] = await Promise.all([
      Promise.all(parsed.sideA.players.map(name => pricePlayer(name, ctx))),
      Promise.all(parsed.sideB.players.map(name => pricePlayer(name, ctx))),
      Promise.all(parsed.sideA.picks.map(p => pricePick(p, ctx))),
      Promise.all(parsed.sideB.picks.map(p => pricePick(p, ctx))),
    ])

    const applyTepBoost = (assets: PricedAsset[]): PricedAsset[] => {
      if (!tePremium) return assets
      const TEP_MULTIPLIER = 1.15
      return assets.map(a => {
        if (a.position?.toUpperCase() === 'TE') {
          const boostedValue = Math.round(a.value * TEP_MULTIPLIER)
          return {
            ...a,
            value: boostedValue,
            assetValue: {
              ...a.assetValue,
              marketValue: Math.round(a.assetValue.marketValue * TEP_MULTIPLIER),
              impactValue: Math.round(a.assetValue.impactValue * TEP_MULTIPLIER),
              vorpValue: Math.round(a.assetValue.vorpValue * TEP_MULTIPLIER),
              volatility: a.assetValue.volatility,
            },
          }
        }
        return a
      })
    }

    const sideAPlayerValues = applyTepBoost(sideAPlayerValuesRaw)
    const sideBPlayerValues = applyTepBoost(sideBPlayerValuesRaw)

    const sideAAssets = [...sideAPlayerValues, ...sideAPickValues]
    const sideBAssets = [...sideBPlayerValues, ...sideBPickValues]

    const sideAComposite = compositeTotal(sideAAssets)
    const sideBComposite = compositeTotal(sideBAssets)

    const sideAMarket = sideAAssets.reduce((sum, a) => sum + a.assetValue.marketValue, 0)
    const sideBMarket = sideBAssets.reduce((sum, a) => sum + a.assetValue.marketValue, 0)

    const fairnessScore = computeValueFairness(sideBComposite, sideAComposite)

    const percentDiff = sideAComposite > 0 ? Math.round(((sideBComposite - sideAComposite) / Math.max(sideAComposite, sideBComposite, 1)) * 100) : 0

    const giveAssets: Asset[] = [
      ...sideAPlayerValues.map(pa => pricedToAsset(pa)),
      ...sideAPickValues.map((pa, i) => pricedToAsset(pa, parsed.sideA.picks[i])),
    ]
    const receiveAssets: Asset[] = [
      ...sideBPlayerValues.map(pa => pricedToAsset(pa)),
      ...sideBPickValues.map((pa, i) => pricedToAsset(pa, parsed.sideB.picks[i])),
    ]
    const calWeights = await getCalibratedWeights()
    let drivers: ReturnType<typeof computeTradeDrivers>
    try {
      drivers = computeTradeDrivers(giveAssets, receiveAssets, null, null, false, false, undefined, undefined, undefined, undefined, undefined, calWeights)
    } catch (e) {
      console.warn('[instant-trade] computeTradeDrivers failed:', e)
      return NextResponse.json({ error: 'Unable to evaluate trade. Please try again.' }, { status: 500 })
    }

    const verdict = drivers.verdict
    const lean = drivers.lean
    const rawConfidence = drivers.confidenceRating
    const confidence = rawConfidence === 'HIGH' ? 'MEDIUM' as const : rawConfidence

    const valuationSummary = {
      youGive: sideAAssets.map(a => `${a.name} (composite: ${compositeScore(a.assetValue)}, market: ${a.assetValue.marketValue})`).join(', '),
      youGet: sideBAssets.map(a => `${a.name} (composite: ${compositeScore(a.assetValue)}, market: ${a.assetValue.marketValue})`).join(', '),
      youGiveTotal: sideAComposite,
      youGetTotal: sideBComposite,
    }

    const bullets = drivers.acceptBullets
    const sensitivity = drivers.sensitivitySentence

    const driverPayload = {
      scoringMode: drivers.scoringMode,
      dominantDriver: drivers.dominantDriver,
      scores: {
        lineupImpact: Math.round(drivers.lineupImpactScore * 100) / 100,
        vorp: Math.round(drivers.vorpScore * 100) / 100,
        market: Math.round(drivers.marketScore * 100) / 100,
        behavior: Math.round(drivers.behaviorScore * 100) / 100,
      },
      hasBehaviorData: drivers.hasBehaviorData,
      derived: {
        totalScore: drivers.totalScore,
        fairnessDelta: drivers.fairnessDelta,
        acceptProbability: drivers.acceptProbability,
        confidenceScore: Math.min(drivers.confidenceScore, 65),
        confidenceRating: confidence,
      },
      verdict: drivers.verdict,
      lean: drivers.lean,
      labels: drivers.labels,
      lineupDelta: drivers.lineupDelta ?? null,
      marketDeltaPct: drivers.marketDeltaPct,
      vorpDelta: drivers.vorpDelta,
      confidenceFactors: drivers.confidenceFactors,
      starterLikelihoodDelta: drivers.starterLikelihoodDelta,
      volatilityAdj: Math.round(drivers.volatilityAdj * 100) / 100,
      consolidationPenalty: drivers.consolidationPenalty,
      positionScarcity: drivers.positionScarcity,
      riskFlags: drivers.riskFlags,
      driverNarrative: drivers.driverNarrative,
      confidenceDrivers: drivers.confidenceDrivers,
    }

    const gptContract = buildGptInputContract('INSTANT', drivers)
    const sfContext = isSuperFlex ? `\n\nLeague Format: Superflex (SF) — QBs are significantly more valuable in SF leagues (often 2-3x 1QB value). Factor this into your analysis; highlight QB premium for any QBs involved.` : ''
    const tepContext = tePremium ? `\n\nLeague Format: TEP (Tight End Premium) — TE values are boosted ~15%. Factor this into your analysis; mention TEP advantage for any TEs involved.` : ''
    let aiNarrative: { bullets: Array<{ text: string; driverId: string }>; sensitivity: { text: string; driverId: string } } | null = null

    const skipCheck = shouldSkipGpt(gptContract)
    if (skipCheck !== 'ok') {
      console.warn(`[instant-trade] Skipping GPT: ${skipCheck}`)
    } else {
      try {
        const aiResult = await openaiChatJson({
          messages: [
            {
              role: 'system',
              content: GPT_NARRATIVE_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: buildGptUserPrompt(gptContract) + sfContext + tepContext,
            },
          ],
          temperature: 0.2,
          maxTokens: 400,
        })

        if (aiResult.ok) {
          const parsed = parseJsonContentFromChatCompletion(aiResult.json)
          if (parsed) {
            const validation = validateGptNarrativeOutput(parsed, gptContract)
            logNarrativeValidation({ mode: 'INSTANT', contractType: 'narrative', valid: validation.valid, violations: validation.violations }).catch(() => {})
            if (validation.violations.length > 0) {
              console.warn('[instant-trade] GPT narrative violations:', validation.violations)
            }
            if (validation.valid && validation.cleaned) {
              aiNarrative = validation.cleaned
            } else {
              console.warn('[instant-trade] GPT narrative rejected — fail-closed')
            }
          }
        }
      } catch (aiErr) {
        console.warn('[instant-trade] AI enrichment failed, using deterministic fallback')
      }
    }

    if (eventId) {
      sendMetaCAPIEvent({
        eventName: 'ViewContent',
        eventId,
        email: '',
        clientIp: ip !== 'unknown' ? ip : undefined,
        clientUserAgent: (req.headers as any).get?.('user-agent') || undefined,
        eventSourceUrl: (req.headers as any).get?.('referer') || 'https://allfantasy.ai/',
        fbp,
        fbc,
        customData: {
          content_name: 'Trade Analysis',
          content_category: 'Fantasy Football',
          value: 0,
          currency: 'USD',
        },
      }).catch(() => {})
    }

    const acceptProbData = {
      probability: drivers.acceptProbability,
      percentDisplay: `${Math.round(drivers.acceptProbability * 100)}%`,
      drivers: drivers.acceptDrivers,
      scores: driverPayload.scores,
      verdict: drivers.verdict,
      lean: drivers.lean,
      fairnessDelta: drivers.fairnessDelta,
      noRosterContext: true,
    }

    let negotiationToolkit = null
    try {
      negotiationToolkit = buildInstantNegotiationToolkit(drivers, giveAssets, receiveAssets)
    } catch (e) {
      console.warn('[instant-trade] negotiation toolkit build failed:', e)
    }

    const negContract = buildNegotiationGptContract(drivers)
    const negSkip = shouldSkipNegotiationGpt(negContract)
    let negotiationGpt: { opener: string; rationale: string; fallback: string; counters: Array<{ description: string; driverIds: string[] }> } | null = null

    if (negSkip !== 'ok') {
      console.warn(`[instant-trade] Skipping negotiation GPT: ${negSkip}`)
    } else {
      try {
        const negResult = await openaiChatJson({
          messages: [
            { role: 'system', content: NEGOTIATION_GPT_SYSTEM_PROMPT },
            { role: 'user', content: buildNegotiationGptUserPrompt(negContract) + `\n\nTrade Context: ${valuationSummary.youGive} → ${valuationSummary.youGet}` + sfContext + tepContext },
          ],
          temperature: 0.3,
          maxTokens: 500,
        })

        if (negResult.ok) {
          const negParsed = parseJsonContentFromChatCompletion(negResult.json)
          if (negParsed) {
            const negValidation = validateNegotiationGptOutput(negParsed, negContract)
            logNarrativeValidation({ mode: 'INSTANT', contractType: 'negotiation', valid: negValidation.valid, violations: negValidation.violations }).catch(() => {})
            if (negValidation.violations.length > 0) {
              console.warn('[instant-trade] Negotiation GPT violations:', negValidation.violations)
            }
            if (negValidation.valid && negValidation.cleaned) {
              negotiationGpt = negValidation.cleaned
            } else {
              console.warn('[instant-trade] Negotiation GPT rejected — fail-closed')
            }
          }
        }
      } catch (negErr) {
        console.warn('[instant-trade] Negotiation GPT failed, using deterministic fallback')
      }
    }

    if (negotiationToolkit && negotiationGpt) {
      if (negotiationGpt.opener || negotiationGpt.rationale || negotiationGpt.fallback) {
        negotiationToolkit.dmMessages = {
          opener: negotiationGpt.opener || negotiationToolkit.dmMessages.opener,
          rationale: negotiationGpt.rationale || negotiationToolkit.dmMessages.rationale,
          fallback: negotiationGpt.fallback || negotiationToolkit.dmMessages.fallback,
        }
      }

      if (negotiationGpt.counters.length > 0) {
        for (const gc of negotiationGpt.counters) {
          const matchingCounter = negotiationToolkit.counters.find(c =>
            c.expected.driverChanges.some(dc => gc.driverIds.includes(dc.driverId))
          )
          if (matchingCounter) {
            matchingCounter.description = gc.description.replace(/\s*\([a-z_]+\)\s*$/, '')
          }
        }
      }
    }

    const evaluation = aiNarrative
      ? { analysis: aiNarrative.bullets, sensitivity: aiNarrative.sensitivity }
      : AI_OUTPUT_INVALID_FALLBACK

    logTradeOfferEvent({
      assetsGiven: sideAAssets.map(a => ({ name: a.name, value: compositeScore(a.assetValue), type: a.source })),
      assetsReceived: sideBAssets.map(a => ({ name: a.name, value: compositeScore(a.assetValue), type: a.source })),
      features: {
        lineupImpact: drivers.lineupImpactScore,
        vorp: drivers.vorpScore,
        market: drivers.marketScore,
        behavior: drivers.behaviorScore,
        weights: [0.40, 0.25, 0.20, 0.15],
      },
      acceptProb: drivers.acceptProbability,
      verdict: drivers.verdict,
      confidenceScore: drivers.confidenceScore,
      driverSet: drivers.acceptDrivers.map(d => ({ id: d.id, evidence: typeof d.evidence === 'string' ? d.evidence : JSON.stringify(d.evidence) })),
      mode: 'INSTANT',
    }).catch(() => {})

    return NextResponse.json({
      verdict,
      lean,
      confidence,
      fairnessScore,
      bullets: aiNarrative ? aiNarrative.bullets.map(b => b.text) : bullets,
      sensitivity: aiNarrative ? aiNarrative.sensitivity.text : sensitivity,
      evaluation,
      drivers: driverPayload,
      acceptProbability: acceptProbData,
      negotiationToolkit,
      detectedLeagueSize: detectedLeagueSize ?? null,
      leagueSize,
      tePremium: !!tePremium,
      isSuperFlex: !!isSuperFlex,
      values: {
        youGive: sideAAssets.map(a => ({
          name: a.name,
          value: compositeScore(a.assetValue),
          assetValue: a.assetValue,
          source: a.source,
        })),
        youGet: sideBAssets.map(a => ({
          name: a.name,
          value: compositeScore(a.assetValue),
          assetValue: a.assetValue,
          source: a.source,
        })),
        youGiveTotal: sideAComposite,
        youGetTotal: sideBComposite,
        youGiveMarket: sideAMarket,
        youGetMarket: sideBMarket,
        percentDiff,
        fairnessScore,
      },
    })
  } catch (err: any) {
    console.error('[instant-trade] Error:', err?.message || err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
})
