import { prisma } from '@/lib/prisma'
import type { ConfidenceRiskOutput, RiskTag } from '@/lib/analytics/confidence-risk-engine'

type GuardianActionType = 'trade' | 'player_drop' | 'faab_bid'
type GuardianSeverity = 'low' | 'medium' | 'high' | 'critical'
type GuardianVerdict = 'proceed' | 'caution' | 'warn' | 'danger'

export interface TradeActionInput {
  actionType: 'trade'
  sideAPlayers: string[]
  sideBPlayers: string[]
  sideAValues?: number[]
  sideBValues?: number[]
  tradeGrade?: string
  verdict?: string
  fairnessScore?: number
  netDelta?: number
  winProbShift?: number
  confidenceRisk?: ConfidenceRiskOutput
  format?: 'redraft' | 'dynasty'
}

export interface DropActionInput {
  actionType: 'player_drop'
  playerToDrop: string
  playerToAdd?: string
  dropPlayerValue?: number
  addPlayerValue?: number
  aiRecommendedDrop?: string
  aiRecommendedDropValue?: number
  rosterContext?: {
    positionDepth?: Record<string, number>
    totalRosterValue?: number
  }
}

export interface FaabActionInput {
  actionType: 'faab_bid'
  playerName: string
  userBidAmount: number
  aiRecommendedBid?: number
  playerValue?: number
  remainingBudget?: number
  totalBudget?: number
  weekNumber?: number
}

type GuardianActionInput = TradeActionInput | DropActionInput | FaabActionInput

interface GuardianEvaluation {
  shouldIntervene: boolean
  verdict: GuardianVerdict
  severity: GuardianSeverity
  deviationScore: number
  expectedValueLoss: number
  headline: string
  details: string[]
  riskFactors: string[]
  aiRecommendation: string
  userAction: string
  confidenceInWarning: number
}

const GRADE_VALUES: Record<string, number> = {
  'A+': 100, 'A': 95, 'A-': 90,
  'B+': 85, 'B': 80, 'B-': 75,
  'C+': 70, 'C': 65, 'C-': 60,
  'D': 45, 'F': 20,
}

function gradeToNumeric(grade: string): number {
  return GRADE_VALUES[grade] ?? 50
}

function computeTradeDeviation(input: TradeActionInput): {
  deviationScore: number
  expectedValueLoss: number
  riskFactors: string[]
  headline: string
  details: string[]
  aiRec: string
  userAct: string
  confidenceInWarning: number
} {
  const riskFactors: string[] = []
  const details: string[] = []
  let deviationScore = 0
  let expectedValueLoss = 0
  let confidenceInWarning = 70

  const grade = input.tradeGrade || ''
  const gradeNum = gradeToNumeric(grade)
  const verdict = (input.verdict || '').toLowerCase()
  const netDelta = input.netDelta ?? 0
  const fairness = input.fairnessScore ?? 50

  const sideAStr = input.sideAPlayers.join(', ')
  const sideBStr = input.sideBPlayers.join(', ')

  const youGiveUp = sideAStr || 'your players'
  const youReceive = sideBStr || 'their players'

  const favorsYou = verdict.includes('favors a') || verdict.includes('you win')
  const favorsThem = verdict.includes('favors b') || verdict.includes('they win')
  const stronglyFavors = verdict.includes('strongly')

  if (gradeNum <= 45) {
    deviationScore += 40
    riskFactors.push(`Trade graded ${grade} — significantly below fair value`)
    if (favorsThem) {
      details.push(`This trade received a ${grade} grade. You're giving up significantly more value (${youGiveUp}) than you're getting back (${youReceive}).`)
    } else {
      details.push(`This trade received a ${grade} grade, indicating a major value imbalance between the two sides.`)
    }
  } else if (gradeNum <= 60) {
    deviationScore += 20
    riskFactors.push(`Trade graded ${grade} — below average`)
    if (favorsThem) {
      details.push(`This trade received a ${grade} grade. The players you're sending out (${youGiveUp}) are worth more than what you'd receive (${youReceive}).`)
    } else {
      details.push(`This trade received a ${grade} grade, suggesting the value exchange isn't balanced in your favor.`)
    }
  }

  if (stronglyFavors) {
    deviationScore += 30
    if (favorsThem) {
      riskFactors.push(`Trade strongly favors the other team`)
      details.push(`AI analysis shows this trade heavily benefits the other team. ${youReceive} doesn't match the value of ${youGiveUp}.`)
    } else if (favorsYou) {
      riskFactors.push(`Trade strongly favors you — may be rejected`)
      details.push(`This trade is heavily in your favor, which means the other manager is unlikely to accept it.`)
    } else {
      riskFactors.push('Trade strongly favors one side')
      details.push('AI analysis shows this trade heavily benefits one team over the other.')
    }
    confidenceInWarning += 10
  } else if (verdict.includes('slightly favors')) {
    deviationScore += 10
  }

  if (Math.abs(netDelta) > 2000) {
    deviationScore += 25
    expectedValueLoss = Math.abs(netDelta)
    const direction = netDelta < 0 ? 'You\'re giving up' : 'You\'re gaining'
    riskFactors.push(`Large value gap: ${Math.abs(netDelta).toLocaleString()} points`)
    details.push(`${direction} ~${Math.abs(netDelta).toLocaleString()} points of trade value — this is a significant gap that makes the trade lopsided.`)
    confidenceInWarning += 5
  } else if (Math.abs(netDelta) > 1000) {
    deviationScore += 15
    expectedValueLoss = Math.abs(netDelta)
    const direction = netDelta < 0 ? 'against you' : 'in your favor'
    riskFactors.push(`Moderate value gap: ${Math.abs(netDelta).toLocaleString()} points ${direction}`)
  } else if (Math.abs(netDelta) > 500) {
    deviationScore += 8
    expectedValueLoss = Math.abs(netDelta)
  }

  if (fairness < 30) {
    deviationScore += 10
    riskFactors.push(`Low fairness score: ${fairness}/100`)
    details.push(`The fairness score of ${fairness}/100 indicates the trade is significantly unbalanced.`)
  } else if (fairness > 80) {
    deviationScore += 5
    riskFactors.push(`Fairness score: ${fairness}/100`)
  }

  if (input.winProbShift != null && input.winProbShift < -5) {
    deviationScore += 15
    riskFactors.push(`Win probability drops by ${Math.abs(input.winProbShift).toFixed(1)}%`)
    details.push(`Completing this trade is projected to lower your win probability by ${Math.abs(input.winProbShift).toFixed(1)}%. This means your team gets weaker overall.`)
    confidenceInWarning += 5
  } else if (input.winProbShift != null && input.winProbShift < -2) {
    deviationScore += 8
    details.push(`Your win probability drops by ${Math.abs(input.winProbShift).toFixed(1)}% with this trade.`)
  }

  if (input.confidenceRisk) {
    const cr = input.confidenceRisk
    if (cr.riskProfile === 'extreme') {
      deviationScore += 20
      riskFactors.push('Extreme risk profile detected')
      details.push('The players involved have extreme volatility — their values could swing dramatically.')
    } else if (cr.riskProfile === 'high') {
      deviationScore += 10
      riskFactors.push('High risk profile')
    }

    if (cr.riskTags && cr.riskTags.length > 0) {
      const criticalTags: RiskTag[] = ['injury_risk', 'rb_cliff', 'high_value_swing', 'negative_trend']
      const criticals = (cr.riskTags as RiskTag[]).filter(t => criticalTags.includes(t))
      if (criticals.length > 0) {
        deviationScore += criticals.length * 5
        const tagLabels: Record<string, string> = {
          injury_risk: 'injury concerns',
          rb_cliff: 'RB age cliff risk',
          high_value_swing: 'volatile value',
          negative_trend: 'declining performance trend',
        }
        const readable = criticals.map(t => tagLabels[t] || t).join(', ')
        riskFactors.push(`Risk flags: ${readable}`)
        details.push(`Key risk factors for players in this trade: ${readable}.`)
      }
    }
  }

  deviationScore = Math.min(100, deviationScore)
  confidenceInWarning = Math.min(98, confidenceInWarning)

  const headline = deviationScore >= 60
    ? favorsThem ? `You're giving up too much in this trade` : 'This trade carries significant risk'
    : deviationScore >= 35
    ? favorsThem ? `This trade may not be in your best interest` : 'This trade has some concerns'
    : 'Minor considerations to review'

  let aiRecText: string
  if (favorsThem && grade) {
    aiRecText = `AI grades this trade ${grade} for your side. You're sending away ${youGiveUp} and getting back ${youReceive}, which doesn't return equal value.`
    if (netDelta !== 0) {
      aiRecText += ` Net value gap: ${Math.abs(netDelta).toLocaleString()} points ${netDelta < 0 ? 'against you' : 'in your favor'}.`
    }
  } else if (favorsYou && grade) {
    aiRecText = `AI grades this trade ${grade}. This trade favors your side — ${youReceive} is worth more than ${youGiveUp}. The other manager may reject this.`
  } else if (grade) {
    aiRecText = `AI grades this trade ${grade}. The value exchange between ${youGiveUp} and ${youReceive} is ${gradeNum >= 75 ? 'reasonably balanced' : 'somewhat uneven'}.`
    if (netDelta !== 0) {
      aiRecText += ` Value gap: ${Math.abs(netDelta).toLocaleString()} points.`
    }
  } else {
    aiRecText = `Trading ${youGiveUp} for ${youReceive}. ${verdict || 'Analysis pending.'}`
  }

  return {
    deviationScore,
    expectedValueLoss,
    riskFactors,
    headline,
    details,
    aiRec: aiRecText,
    userAct: `Trading away ${sideAStr} to receive ${sideBStr}`,
    confidenceInWarning,
  }
}

function computeDropDeviation(input: DropActionInput): {
  deviationScore: number
  expectedValueLoss: number
  riskFactors: string[]
  headline: string
  details: string[]
  aiRec: string
  userAct: string
  confidenceInWarning: number
} {
  const riskFactors: string[] = []
  const details: string[] = []
  let deviationScore = 0
  let expectedValueLoss = 0
  let confidenceInWarning = 65

  const dropVal = input.dropPlayerValue ?? 0
  const addVal = input.addPlayerValue ?? 0
  const aiDropVal = input.aiRecommendedDropValue ?? 0

  if (dropVal > 3000) {
    deviationScore += 45
    expectedValueLoss = dropVal
    riskFactors.push(`Dropping a high-value player (${dropVal.toLocaleString()} value)`)
    details.push(`${input.playerToDrop} has significant trade value. Consider trading them instead of dropping.`)
    confidenceInWarning += 15
  } else if (dropVal > 1500) {
    deviationScore += 25
    expectedValueLoss = dropVal
    riskFactors.push(`Dropping a moderately valuable player (${dropVal.toLocaleString()} value)`)
    details.push(`${input.playerToDrop} has enough value that you might find a trade partner.`)
    confidenceInWarning += 5
  } else if (dropVal > 500) {
    deviationScore += 10
    expectedValueLoss = dropVal
  }

  if (input.aiRecommendedDrop && input.aiRecommendedDrop !== input.playerToDrop) {
    const valueDiff = dropVal - aiDropVal
    if (valueDiff > 1000) {
      deviationScore += 30
      expectedValueLoss = Math.max(expectedValueLoss, valueDiff)
      riskFactors.push(`AI suggested dropping ${input.aiRecommendedDrop} instead (${valueDiff.toLocaleString()} less valuable)`)
      details.push(`The AI recommended dropping ${input.aiRecommendedDrop} (value: ${aiDropVal.toLocaleString()}) instead of ${input.playerToDrop} (value: ${dropVal.toLocaleString()}).`)
      confidenceInWarning += 10
    } else if (valueDiff > 300) {
      deviationScore += 15
      riskFactors.push(`AI recommended a different drop candidate: ${input.aiRecommendedDrop}`)
    }
  }

  if (addVal > 0 && dropVal > addVal * 2) {
    deviationScore += 15
    riskFactors.push('Drop candidate is worth more than double the add target')
    details.push('The player being dropped is significantly more valuable than the player being added.')
  }

  if (input.rosterContext?.positionDepth) {
    const playerPos = Object.entries(input.rosterContext.positionDepth).find(([, count]) => count <= 2)
    if (playerPos) {
      deviationScore += 10
      riskFactors.push(`Thin at ${playerPos[0]} position (only ${playerPos[1]} rostered)`)
    }
  }

  deviationScore = Math.min(100, deviationScore)
  confidenceInWarning = Math.min(98, confidenceInWarning)

  const headline = deviationScore >= 50
    ? `Dropping ${input.playerToDrop} may be costly`
    : deviationScore >= 25
    ? `Consider alternatives before dropping ${input.playerToDrop}`
    : 'Minor drop concern'

  return {
    deviationScore,
    expectedValueLoss,
    riskFactors,
    headline,
    details,
    aiRec: input.aiRecommendedDrop
      ? `AI recommends dropping ${input.aiRecommendedDrop} (value: ${aiDropVal.toLocaleString()}) instead.`
      : `Player value at risk: ${dropVal.toLocaleString()}.`,
    userAct: `Dropping ${input.playerToDrop}${input.playerToAdd ? ` to add ${input.playerToAdd}` : ''}`,
    confidenceInWarning,
  }
}

function computeFaabDeviation(input: FaabActionInput): {
  deviationScore: number
  expectedValueLoss: number
  riskFactors: string[]
  headline: string
  details: string[]
  aiRec: string
  userAct: string
  confidenceInWarning: number
} {
  const riskFactors: string[] = []
  const details: string[] = []
  let deviationScore = 0
  let expectedValueLoss = 0
  let confidenceInWarning = 60

  const userBid = input.userBidAmount
  const aiBid = input.aiRecommendedBid ?? 0
  const budget = input.remainingBudget ?? input.totalBudget ?? 100
  const bidDiff = Math.abs(userBid - aiBid)
  const budgetPct = budget > 0 ? (userBid / budget) * 100 : 0

  if (aiBid > 0 && bidDiff > 0) {
    const deviationPct = (bidDiff / Math.max(aiBid, 1)) * 100

    if (deviationPct > 100) {
      deviationScore += 40
      riskFactors.push(`Bid is ${deviationPct.toFixed(0)}% above AI recommendation`)
      details.push(`You're bidding $${userBid} but AI suggests $${aiBid}. This is a significant overpay.`)
      expectedValueLoss = bidDiff
      confidenceInWarning += 15
    } else if (deviationPct > 50) {
      deviationScore += 25
      riskFactors.push(`Bid deviates ${deviationPct.toFixed(0)}% from AI recommendation`)
      details.push(`Your bid of $${userBid} is notably higher than the AI-recommended $${aiBid}.`)
      expectedValueLoss = bidDiff
      confidenceInWarning += 8
    } else if (deviationPct > 25) {
      deviationScore += 12
      expectedValueLoss = bidDiff
    }
  }

  if (budgetPct > 40) {
    deviationScore += 30
    riskFactors.push(`Using ${budgetPct.toFixed(0)}% of remaining FAAB budget`)
    details.push(`This bid represents a large portion of your remaining budget. Consider if this player is worth limiting future flexibility.`)
    confidenceInWarning += 10
  } else if (budgetPct > 25) {
    deviationScore += 15
    riskFactors.push(`Using ${budgetPct.toFixed(0)}% of remaining budget`)
  }

  if (input.weekNumber && input.weekNumber <= 3 && budgetPct > 20) {
    deviationScore += 10
    riskFactors.push('Early-season large bid — budget preservation is important')
    details.push('Spending heavily early in the season limits your ability to respond to later injuries and breakouts.')
  }

  if (input.playerValue && userBid > input.playerValue * 0.5) {
    deviationScore += 10
    riskFactors.push('Bid exceeds half the player\'s market value')
  }

  deviationScore = Math.min(100, deviationScore)
  confidenceInWarning = Math.min(98, confidenceInWarning)

  const headline = deviationScore >= 50
    ? `FAAB bid of $${userBid} may be an overpay`
    : deviationScore >= 25
    ? 'Review your FAAB bid amount'
    : 'Minor FAAB concern'

  return {
    deviationScore,
    expectedValueLoss,
    riskFactors,
    headline,
    details,
    aiRec: aiBid > 0
      ? `AI recommends a FAAB bid of $${aiBid} for ${input.playerName}.`
      : `Consider the player's value ($${(input.playerValue ?? 0).toLocaleString()}) relative to your bid.`,
    userAct: `Bidding $${userBid} FAAB on ${input.playerName}`,
    confidenceInWarning,
  }
}

function deriveSeverity(deviationScore: number): GuardianSeverity {
  if (deviationScore >= 70) return 'critical'
  if (deviationScore >= 45) return 'high'
  if (deviationScore >= 25) return 'medium'
  return 'low'
}

function deriveVerdict(deviationScore: number): GuardianVerdict {
  if (deviationScore >= 70) return 'danger'
  if (deviationScore >= 45) return 'warn'
  if (deviationScore >= 25) return 'caution'
  return 'proceed'
}

const INTERVENTION_THRESHOLD = 25

export function evaluateAction(input: GuardianActionInput): GuardianEvaluation {
  let result: {
    deviationScore: number
    expectedValueLoss: number
    riskFactors: string[]
    headline: string
    details: string[]
    aiRec: string
    userAct: string
    confidenceInWarning: number
  }

  switch (input.actionType) {
    case 'trade':
      result = computeTradeDeviation(input)
      break
    case 'player_drop':
      result = computeDropDeviation(input)
      break
    case 'faab_bid':
      result = computeFaabDeviation(input)
      break
    default:
      result = {
        deviationScore: 0,
        expectedValueLoss: 0,
        riskFactors: [],
        headline: 'No concerns detected',
        details: [],
        aiRec: '',
        userAct: '',
        confidenceInWarning: 50,
      }
  }

  const severity = deriveSeverity(result.deviationScore)
  const verdict = deriveVerdict(result.deviationScore)

  return {
    shouldIntervene: result.deviationScore >= INTERVENTION_THRESHOLD,
    verdict,
    severity,
    deviationScore: result.deviationScore,
    expectedValueLoss: result.expectedValueLoss,
    headline: result.headline,
    details: result.details,
    riskFactors: result.riskFactors,
    aiRecommendation: result.aiRec,
    userAction: result.userAct,
    confidenceInWarning: result.confidenceInWarning,
  }
}

export async function logGuardianIntervention(params: {
  userId: string
  leagueId?: string
  actionType: GuardianActionType
  evaluation: GuardianEvaluation
  userAction: Record<string, unknown>
  aiRecommendation: Record<string, unknown>
}) {
  return prisma.guardianIntervention.create({
    data: {
      userId: params.userId,
      leagueId: params.leagueId ?? null,
      actionType: params.actionType,
      severity: params.evaluation.severity,
      userAction: params.userAction as any,
      aiRecommendation: params.aiRecommendation as any,
      expectedValueLoss: params.evaluation.expectedValueLoss || null,
      deviationScore: params.evaluation.deviationScore,
      riskFactors: params.evaluation.riskFactors as any,
      confidenceScore: params.evaluation.confidenceInWarning,
    },
  })
}

export async function resolveGuardianIntervention(
  interventionId: string,
  userDecision: 'proceed' | 'cancel',
  overrideReason?: string
) {
  return prisma.guardianIntervention.update({
    where: { id: interventionId },
    data: {
      userDecision,
      overrideReason: overrideReason ?? null,
    },
  })
}

export async function getGuardianStats(userId: string, leagueId?: string) {
  const where: { userId: string; leagueId?: string } = { userId }
  if (leagueId) where.leagueId = leagueId

  const interventions = await prisma.guardianIntervention.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  type Intervention = (typeof interventions)[number]

  const total = interventions.length
  const proceeded = interventions.filter((i: Intervention) => i.userDecision === 'proceed').length
  const cancelled = interventions.filter((i: Intervention) => i.userDecision === 'cancel').length
  const pending = interventions.filter((i: Intervention) => !i.userDecision).length

  const bySeverity = {
    critical: interventions.filter((i: Intervention) => i.severity === 'critical').length,
    high: interventions.filter((i: Intervention) => i.severity === 'high').length,
    medium: interventions.filter((i: Intervention) => i.severity === 'medium').length,
    low: interventions.filter((i: Intervention) => i.severity === 'low').length,
  }

  const byType = {
    trade: interventions.filter((i: Intervention) => i.actionType === 'trade').length,
    player_drop: interventions.filter((i: Intervention) => i.actionType === 'player_drop').length,
    faab_bid: interventions.filter((i: Intervention) => i.actionType === 'faab_bid').length,
  }

  const avgDeviationScore = total > 0
    ? interventions.reduce((sum: number, i: Intervention) => sum + i.deviationScore, 0) / total
    : 0

  const totalEvLossPrevented = interventions
    .filter((i: Intervention) => i.userDecision === 'cancel' && i.expectedValueLoss)
    .reduce((sum: number, i: Intervention) => sum + (i.expectedValueLoss ?? 0), 0)

  const overrideRate = proceeded + cancelled > 0
    ? proceeded / (proceeded + cancelled)
    : 0

  return {
    total,
    proceeded,
    cancelled,
    pending,
    bySeverity,
    byType,
    avgDeviationScore: Math.round(avgDeviationScore),
    totalEvLossPrevented: Math.round(totalEvLossPrevented),
    overrideRate: Math.round(overrideRate * 100),
    recentInterventions: interventions.slice(0, 10).map((i: Intervention) => ({
      id: i.id,
      actionType: i.actionType,
      severity: i.severity,
      deviationScore: i.deviationScore,
      expectedValueLoss: i.expectedValueLoss,
      userDecision: i.userDecision,
      createdAt: i.createdAt.toISOString(),
    })),
  }
}
