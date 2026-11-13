/**
 * Multi-year franchise planning — deterministic roster + pick capital heuristics.
 * LLM can narrate; numbers stay explainable.
 */

import type { CoachingPlanResponse, StrategyLens } from '@/lib/ai/coaching/coachingPlanTypes'

type FranchisePlanMode = 'contend' | 'retool' | 'rebuild'

type FranchisePlan = {
  mode: FranchisePlanMode
  timelineYears: number
  priorityActions: string[]
  rosterStrengths: string[]
  rosterWeaknesses: string[]
  marketStrategy: string[]
  draftStrategy: string[]
  tradeStrategy: string[]
  confidence: number
}

type FranchisePlannerInput = {
  isDynasty: boolean
  isDevy?: boolean
  isC2c?: boolean
  /** 0–100 youth concentration */
  youthScore: number
  /** 0–100 win-now pieces */
  winNowScore: number
  /** 0–100 pick capital */
  pickCapitalScore: number
  /** positional depth shortfall counts */
  positionalStress?: Record<string, number>
}

function buildFranchisePlan(input: FranchisePlannerInput): FranchisePlan {
  const { youthScore, winNowScore, pickCapitalScore, positionalStress = {}, isDynasty, isDevy, isC2c } = input

  let mode: FranchisePlanMode = 'retool'
  if (winNowScore > 65 && pickCapitalScore > 35) mode = 'contend'
  if (winNowScore < 40 && youthScore > 55) mode = 'rebuild'
  if (winNowScore < 45 && pickCapitalScore > 60) mode = 'rebuild'

  const timelineYears =
    mode === 'contend' ? 1 : mode === 'retool' ? 2 : Math.min(5, 2 + Math.round((100 - winNowScore) / 25))

  const rosterStrengths: string[] = []
  const rosterWeaknesses: string[] = []
  if (winNowScore > 60) rosterStrengths.push('Top-line starters support a playoff push.')
  if (youthScore > 60) rosterStrengths.push('Youth pipeline reduces cliff risk.')
  if (pickCapitalScore > 60) rosterStrengths.push('Pick capital offers trade flexibility.')

  for (const [pos, stress] of Object.entries(positionalStress)) {
    if (stress > 0.35) rosterWeaknesses.push(`Thin at ${pos} relative to league starters.`)
  }
  if (winNowScore < 45) rosterWeaknesses.push('Win-now density is below contention threshold.')

  const priorityActions: string[] = []
  if (mode === 'contend') priorityActions.push('Consolidate bench into starters or FAAB for injury insurance.')
  if (mode === 'retool') priorityActions.push('Target 1–2 premium pieces while preserving rookie/pick upside.')
  if (mode === 'rebuild') priorityActions.push('Sell depreciating vets for picks or young ascenders.')

  const marketStrategy: string[] = []
  if (isDynasty) marketStrategy.push('Track contender windows — sell vets into playoff pushes.')
  if (isDevy || isC2c) marketStrategy.push('Weight devy/C2C rounds against NFL readiness timeline.')

  const draftStrategy: string[] = [
    mode === 'rebuild' ? 'Prioritize ceiling rookies and early QB in SF if needed.' : 'Balance floor veterans with upside rookies.',
  ]
  const tradeStrategy: string[] = [
    mode === 'contend' ? 'Package mid picks for proven weekly starters.' : 'Accumulate picks when aging roster pieces peak in market.',
  ]

  const confidence = Math.round(
    Math.min(
      95,
      45 + (Math.abs(winNowScore - 50) + Math.abs(youthScore - 50) + Math.abs(pickCapitalScore - 50)) / 3,
    ),
  )

  return {
    mode,
    timelineYears,
    priorityActions,
    rosterStrengths,
    rosterWeaknesses,
    marketStrategy,
    draftStrategy,
    tradeStrategy,
    confidence,
  }
}

const DEFAULT_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

/**
 * Deterministic dashboard payload when live LTC analysis is unavailable.
 */
export function buildFallbackCoachingPlan(input: {
  timelineYears: number
  strategyLens: StrategyLens
  leagueName?: string
}): CoachingPlanResponse {
  const lensBoost =
    input.strategyLens === 'win_now' ? { win: 62, youth: 42, pick: 48 } :
    input.strategyLens === 'future_focused' ? { win: 42, youth: 62, pick: 58 } :
    { win: 50, youth: 50, pick: 50 }

  const fp = buildFranchisePlan({
    isDynasty: true,
    isDevy: true,
    isC2c: true,
    youthScore: lensBoost.youth,
    winNowScore: lensBoost.win,
    pickCapitalScore: lensBoost.pick,
  })

  const y = Math.min(5, Math.max(2, Math.round(input.timelineYears)))

  return {
    mode: fp.mode,
    timelineYears: y,
    confidence: fp.confidence,
    summary: `Live coaching sync did not complete — showing a neutral heuristic plan for ${input.leagueName ?? 'this league'}. Refresh or ask Chimmy with your roster context.`,
    priorityActions: fp.priorityActions,
    rosterStrengths: fp.rosterStrengths,
    rosterWeaknesses: fp.rosterWeaknesses,
    marketStrategy: [...fp.marketStrategy, `Strategy lens: ${input.strategyLens.replace(/_/g, ' ')}.`],
    draftStrategy: fp.draftStrategy,
    tradeStrategy: fp.tradeStrategy,
    waiverStrategy: ['Re-sync league data for FAAB targets tailored to your scoring.'],
    devyStrategy: ['When college pipeline data is present, devy stash lines will populate here.'],
    windowToWin: {
      label: 'Window estimate unavailable offline',
      risk: 'medium',
      explanation:
        'Fallback uses balanced roster assumptions. Retry analysis or use Chimmy for a roster-specific read.',
    },
    positionHealth: DEFAULT_POSITIONS.map((position, i) => ({
      position,
      strengthScore: 48 + (i * 3) % 12,
      depthScore: 50,
      ageScore: 52,
      outlook: 'average' as const,
    })),
    futureCapital: {
      summary: 'Pick inventory not loaded in fallback — preserve early capital until data syncs.',
      picksByYear: {},
    },
    coreAssets: [],
    timelinePlan: Array.from({ length: y }, (_, idx) => ({
      year: new Date().getFullYear() + idx + 1,
      title: `Year ${idx + 1} — provisional focus`,
      actions: ['Refresh the coaching plan when the league connection is healthy.', 'Ask Chimmy to stress-test moves against your league rules.'],
    })),
    dataSparse: true,
    formatBadges: ['Dynasty-style'],
  }
}
