import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { evaluateAction, logGuardianIntervention } from '@/lib/analytics/decision-guardian'
import type { TradeActionInput, DropActionInput, FaabActionInput } from '@/lib/analytics/decision-guardian'

const tradeSchema = z.object({
  actionType: z.literal('trade'),
  sideAPlayers: z.array(z.string()),
  sideBPlayers: z.array(z.string()),
  sideAValues: z.array(z.number()).optional(),
  sideBValues: z.array(z.number()).optional(),
  tradeGrade: z.string().optional(),
  verdict: z.string().optional(),
  fairnessScore: z.number().optional(),
  netDelta: z.number().optional(),
  winProbShift: z.number().optional(),
  confidenceRisk: z.any().optional(),
  format: z.enum(['redraft', 'dynasty']).optional(),
  totalAssets: z.number().int().min(0).optional(),
  acceptancePct: z.number().optional(),
  acceptanceDrivers: z.any().optional(),
  failureRiskLine: z.string().optional(),
  tier: z.string().optional(),
})

const dropSchema = z.object({
  actionType: z.literal('player_drop'),
  playerToDrop: z.string(),
  playerToAdd: z.string().optional(),
  dropPlayerValue: z.number().optional(),
  addPlayerValue: z.number().optional(),
  aiRecommendedDrop: z.string().optional(),
  aiRecommendedDropValue: z.number().optional(),
  rosterContext: z.object({
    positionDepth: z.record(z.string(), z.number()).optional(),
    totalRosterValue: z.number().optional(),
  }).optional(),
})

const faabSchema = z.object({
  actionType: z.literal('faab_bid'),
  playerName: z.string(),
  userBidAmount: z.number(),
  aiRecommendedBid: z.number().optional(),
  playerValue: z.number().optional(),
  remainingBudget: z.number().optional(),
  totalBudget: z.number().optional(),
  weekNumber: z.number().optional(),
})

const requestSchema = z.object({
  action: z.discriminatedUnion('actionType', [tradeSchema, dropSchema, faabSchema]),
  userId: z.string().optional(),
  leagueId: z.string().optional(),
  logIntervention: z.boolean().optional(),
})

type TradeTier = 'YOU_WIN' | 'EVEN' | 'THEY_WIN'
type GuardianMode = 'STRONG_WARN' | 'SOFT_WARN' | 'INFO'
type ConfidenceState = 'HIGH' | 'MODERATE' | 'LEARNING'

interface DriverEntry {
  key: string
  label: string
  delta: number
}

function determineTradeTier(action: z.infer<typeof tradeSchema>): TradeTier {
  const verdict = (action.verdict || '').toLowerCase()
  const netDelta = action.netDelta ?? 0
  const grade = action.tradeGrade || ''

  if (verdict.includes('strongly favors a') || verdict.includes('you win')) return 'YOU_WIN'
  if (verdict.includes('strongly favors b') || verdict.includes('they win')) return 'THEY_WIN'
  if (verdict.includes('favors a')) return 'YOU_WIN'
  if (verdict.includes('favors b')) return 'THEY_WIN'

  if (netDelta >= 1500) return 'YOU_WIN'
  if (netDelta <= -1500) return 'THEY_WIN'
  if (netDelta >= 500) return 'YOU_WIN'
  if (netDelta <= -500) return 'THEY_WIN'

  const gradeChar = grade.replace(/[+-]/g, '')[0]
  if (gradeChar === 'A') return 'YOU_WIN'
  if (gradeChar === 'D' || gradeChar === 'F') return 'THEY_WIN'

  return 'EVEN'
}

function computeAcceptancePct(
  tier: TradeTier,
  action: z.infer<typeof tradeSchema>
): { acceptancePct: number; drivers: DriverEntry[] } {
  const drivers: DriverEntry[] = []

  const tierRanges: Record<TradeTier, [number, number]> = {
    YOU_WIN: [47, 58],
    EVEN: [58, 70],
    THEY_WIN: [66, 80],
  }

  const [rangeMin, rangeMax] = tierRanges[tier]
  const rangeMid = Math.round((rangeMin + rangeMax) / 2)

  const fairness = action.fairnessScore ?? 50
  const fairnessNorm = (fairness - 50) / 50
  const baseNudge = Math.round(fairnessNorm * ((rangeMax - rangeMin) / 2))
  let base = Math.max(rangeMin, Math.min(rangeMax, rangeMid + baseNudge))

  const fairnessDelta = Math.round(fairnessNorm * 14)
  const clampedFairness = Math.max(-14, Math.min(14, fairnessDelta))
  if (clampedFairness !== 0) {
    drivers.push({ key: 'fairness', label: 'Trade Fairness', delta: clampedFairness })
    base += clampedFairness
  }

  const absNetDelta = Math.abs(action.netDelta ?? 0)
  let valueGapDelta = 0
  if (absNetDelta <= 250) {
    valueGapDelta = 4
  } else if (absNetDelta <= 750) {
    valueGapDelta = 1
  } else if (absNetDelta <= 1250) {
    valueGapDelta = -2
  } else if (absNetDelta <= 2000) {
    valueGapDelta = -5
  } else {
    valueGapDelta = -8
  }
  const clampedValueGap = Math.max(-10, Math.min(10, valueGapDelta))
  if (clampedValueGap !== 0) {
    drivers.push({ key: 'value_gap', label: 'Value Gap', delta: clampedValueGap })
    base += clampedValueGap
  }

  const winShift = action.winProbShift ?? 0
  const opponentWinShift = -winShift
  let winProbDelta = 0
  if (opponentWinShift > 6) {
    winProbDelta = 10
  } else if (opponentWinShift > 3) {
    winProbDelta = 7
  } else if (opponentWinShift > 0) {
    winProbDelta = 3
  } else if (opponentWinShift < -6) {
    winProbDelta = -12
  } else if (opponentWinShift < -3) {
    winProbDelta = -7
  } else if (opponentWinShift < -1) {
    winProbDelta = -3
  }
  const clampedWinProb = Math.max(-15, Math.min(15, winProbDelta))
  if (clampedWinProb !== 0) {
    drivers.push({ key: 'win_prob', label: 'Win Prob Impact', delta: clampedWinProb })
    base += clampedWinProb
  }

  const totalAssets = action.totalAssets ?? (action.sideAPlayers.length + action.sideBPlayers.length)
  let complexityDelta = 0
  if (totalAssets > 8) {
    complexityDelta = -8
  } else if (totalAssets > 6) {
    complexityDelta = -5
  } else if (totalAssets > 4) {
    complexityDelta = -2
  }
  const clampedComplexity = Math.max(-10, Math.min(0, complexityDelta))
  if (clampedComplexity !== 0) {
    drivers.push({ key: 'complexity', label: 'Trade Complexity', delta: clampedComplexity })
    base += clampedComplexity
  }

  const grade = action.tradeGrade || ''
  let cultureDelta = 0
  if (grade.startsWith('A')) cultureDelta = 3
  else if (grade.startsWith('D') || grade.startsWith('F')) cultureDelta = -5
  const clampedCulture = Math.max(-5, Math.min(5, cultureDelta))
  if (clampedCulture !== 0) {
    drivers.push({ key: 'league_culture', label: 'League Culture', delta: clampedCulture })
    base += clampedCulture
  }

  const acceptancePct = Math.max(35, Math.min(85, base))

  drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return { acceptancePct, drivers }
}

function deriveConfidenceState(acceptancePct: number): ConfidenceState {
  if (acceptancePct >= 80) return 'HIGH'
  if (acceptancePct >= 65) return 'MODERATE'
  return 'LEARNING'
}

function deriveGuardianMode(
  confidenceState: ConfidenceState,
  acceptancePct: number,
  tier: TradeTier
): GuardianMode {
  if (confidenceState === 'LEARNING') return 'INFO'

  if (confidenceState === 'HIGH' && acceptancePct < 55) return 'STRONG_WARN'
  if (acceptancePct < 45) return 'STRONG_WARN'

  if (tier === 'THEY_WIN') return 'SOFT_WARN'
  if (confidenceState === 'MODERATE' && acceptancePct < 60) return 'SOFT_WARN'
  if (acceptancePct < 55) return 'SOFT_WARN'

  return 'INFO'
}

function buildFailureRiskLine(tier: TradeTier, acceptancePct: number, drivers: DriverEntry[]): string {
  if (acceptancePct >= 75) return 'Strong chance of acceptance — both sides benefit.'
  if (acceptancePct >= 60) return 'Reasonable chance of acceptance, but some factors work against you.'

  const topNegative = drivers.find(d => d.delta < 0)
  if (topNegative) {
    return `Most likely rejection factor: ${topNegative.label} (${topNegative.delta > 0 ? '+' : ''}${topNegative.delta})`
  }

  if (tier === 'YOU_WIN') return 'The other manager may see this as lopsided in your favor.'
  return 'Low acceptance probability — consider adjusting the offer.'
}

function buildGuardianTitle(mode: GuardianMode, acceptancePct: number): string {
  switch (mode) {
    case 'STRONG_WARN': return 'This trade is unlikely to be accepted'
    case 'SOFT_WARN': return 'This trade has some acceptance concerns'
    case 'INFO': return 'Trade acceptance analysis'
  }
}

function buildGuardianBody(mode: GuardianMode, tier: TradeTier, acceptancePct: number, action: z.infer<typeof tradeSchema>): string {
  const sideAStr = action.sideAPlayers.join(', ')
  const sideBStr = action.sideBPlayers.join(', ')
  const grade = action.tradeGrade || ''

  if (mode === 'STRONG_WARN') {
    if (tier === 'YOU_WIN') return `This trade heavily favors your side. Sending ${sideBStr} for ${sideAStr} is a big ask — the other manager will likely see the imbalance and decline.`
    if (tier === 'THEY_WIN') return `You're giving up more than you're getting back. ${sideAStr} is worth more than ${sideBStr}${grade ? ` (graded ${grade})` : ''}. Consider adjusting your offer.`
    return 'Multiple factors suggest this trade has a low probability of being accepted. Consider adjusting your offer.'
  }
  if (mode === 'SOFT_WARN') {
    if (tier === 'THEY_WIN') return `This trade leans in the other team's favor. ${sideBStr} may not fully replace the value of ${sideAStr}${grade ? ` (graded ${grade})` : ''}. The other manager may accept, but it's not ideal for you.`
    if (tier === 'YOU_WIN') return `This trade favors your side, which may make the other manager hesitate. They might want more in return for ${sideBStr}.`
    return 'This trade has moderate acceptance probability. Some factors may cause the other manager to hesitate.'
  }
  return 'Here\'s how we project the other manager will evaluate this trade.'
}

function buildRecommendedAction(mode: GuardianMode): string {
  switch (mode) {
    case 'STRONG_WARN': return 'Adjust Trade'
    case 'SOFT_WARN': return 'Review Details'
    case 'INFO': return 'Proceed'
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/decision-guardian/evaluate", tool: "LegacyDecisionGuardianEvaluate" })(async (req: NextRequest) => {
  /*
   * The evaluation itself is a stateless computation over the action in the body, so it keeps
   * only the CSRF origin check. What was wrong was treating that check as authentication for
   * the WRITE below: `logIntervention` + `userId` recorded a GuardianIntervention under any
   * username the caller named, via `requireAuthOrOrigin` — which passes anonymous callers.
   */
  if (!validateRequestOrigin(req)) return forbiddenResponse('Invalid request origin')

  try {
    const body = await req.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { action, leagueId, logIntervention } = parsed.data

    // Logging writes a row owned by `userId` — that needs a real identity, and the named user
    // must be the caller. The caller's value is only compared, never used as the key.
    let userId: string | undefined
    if (logIntervention && parsed.data.userId) {
      const gate = await requireLegacySleeperIdentity(req, {
        allowGuest: true,
        requestedUsername: parsed.data.userId,
      })
      if (!gate.ok) return gate.response
      userId = gate.identity.sleeperUsername
    }

    const evaluation = evaluateAction(action as TradeActionInput | DropActionInput | FaabActionInput)

    let acceptancePct: number | undefined
    let confidenceState: ConfidenceState | undefined
    let mode: GuardianMode | undefined
    let driversTop3: DriverEntry[] | undefined
    let failureRiskLine: string | undefined
    let title: string | undefined
    let guardianBody: string | undefined
    let recommendedActionLabel: string | undefined

    if (action.actionType === 'trade') {
      const tier = determineTradeTier(action)
      const result = computeAcceptancePct(tier, action)
      acceptancePct = result.acceptancePct
      driversTop3 = (result.drivers ?? []).slice(0, 3)
      confidenceState = deriveConfidenceState(acceptancePct)
      mode = deriveGuardianMode(confidenceState, acceptancePct, tier)
      failureRiskLine = buildFailureRiskLine(tier, acceptancePct, result.drivers)
      title = buildGuardianTitle(mode, acceptancePct)
      guardianBody = buildGuardianBody(mode, tier, acceptancePct, action)
      recommendedActionLabel = buildRecommendedAction(mode)

      const sev = evaluation.severity
      const v = evaluation.verdict

      const severe = sev === 'high' || sev === 'critical'
      const strongVerdict = v === 'warn' || v === 'danger'
      const mediumPlus = sev === 'medium' || severe

      const acceptanceVeryLow = acceptancePct < 45
      const notLearning = confidenceState !== 'LEARNING'

      const shouldShowModal =
        evaluation.shouldIntervene &&
        (severe ||
          strongVerdict ||
          ((mode === 'SOFT_WARN' || mode === 'STRONG_WARN') && mediumPlus) ||
          (acceptanceVeryLow && notLearning))

      evaluation.shouldIntervene = shouldShowModal

      if (!evaluation.shouldIntervene) {
        mode = undefined
        title = undefined
        guardianBody = undefined
        recommendedActionLabel = undefined
      }
    }

    const showModal = evaluation.shouldIntervene

    let interventionId: string | null = null

    if (logIntervention && userId && showModal) {
      try {
        const intervention = await logGuardianIntervention({
          userId,
          leagueId,
          actionType: action.actionType,
          evaluation,
          userAction: action as unknown as Record<string, unknown>,
          aiRecommendation: {
            recommendation: evaluation.aiRecommendation,
            riskFactors: evaluation.riskFactors,
            expectedValueLoss: evaluation.expectedValueLoss,
          },
        })
        interventionId = intervention.id
      } catch (err) {
        console.error('[GUARDIAN] Failed to log intervention:', err)
      }
    }

    return NextResponse.json({
      success: true,
      showModal,
      evaluation: {
        ...evaluation,
        acceptancePct,
        confidenceState,
        mode,
        driversTop3,
        failureRiskLine,
        title,
        body: guardianBody,
        recommendedActionLabel,
      },
      interventionId,
    })
  } catch (err: any) {
    console.error('[GUARDIAN] Evaluate error:', err)
    return NextResponse.json(
      { error: 'Guardian evaluation failed' },
      { status: 500 }
    )
  }
})
