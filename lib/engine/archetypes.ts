import type { EngineManagerProfile, ArchetypeId, TeamPhase } from './types'

export interface ArchetypeClassification {
  archetype: ArchetypeId
  confidence: number
  signals: string[]
  negotiationTips: string[]
}

interface ArchetypeRules {
  id: ArchetypeId
  label: string
  test: (m: EngineManagerProfile) => { match: boolean; confidence: number; signals: string[] }
  tips: string[]
}

const ARCHETYPE_RULES: ArchetypeRules[] = [
  {
    id: 'shark',
    label: 'Shark',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.behavior.tradeAggression === 'high') { score += 30; signals.push('High trade aggression') }
      if (m.behavior.avgTradesPerSeason >= 8) { score += 25; signals.push(`${m.behavior.avgTradesPerSeason} trades/season`) }
      if (m.behavior.riskTolerance === 'high') { score += 15; signals.push('High risk tolerance') }
      if (m.phase === 'contender') { score += 10; signals.push('Contender status') }
      return { match: score >= 40, confidence: Math.min(0.95, score / 80), signals }
    },
    tips: [
      'Will try to extract maximum value — hold firm on fair offers',
      'Responds well to time pressure (deadline leverage)',
      'Often willing to overpay slightly for the "right" piece',
    ],
  },
  {
    id: 'gambler',
    label: 'Gambler',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.behavior.riskTolerance === 'high') { score += 30; signals.push('High risk tolerance') }
      if (m.behavior.prefersYouth) { score += 15; signals.push('Prefers youth') }
      if (m.behavior.tradeAggression === 'high' || m.behavior.tradeAggression === 'medium') { score += 10 }
      const devyAssets = m.assets.filter(a => a.player?.isDevy)
      if (devyAssets.length >= 3) { score += 20; signals.push(`${devyAssets.length} devy assets`) }
      return { match: score >= 40, confidence: Math.min(0.95, score / 75), signals }
    },
    tips: [
      'Attracted to upside players and draft picks',
      'May accept lower floor for higher ceiling',
      'Good target for selling aging veterans at premium',
    ],
  },
  {
    id: 'fair_dealer',
    label: 'Fair Dealer',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.behavior.tradeAggression === 'medium') { score += 25; signals.push('Moderate trade activity') }
      if (m.behavior.riskTolerance === 'medium') { score += 20; signals.push('Balanced risk approach') }
      if (m.behavior.avgTradesPerSeason >= 3 && m.behavior.avgTradesPerSeason <= 7) { score += 15; signals.push('Consistent trading') }
      return { match: score >= 35, confidence: Math.min(0.90, score / 60), signals }
    },
    tips: [
      'Values fair value exchanges — overpays rarely accepted',
      'Responds to well-reasoned trade rationale',
      'Good target for win-win proposals',
    ],
  },
  {
    id: 'hoarder',
    label: 'Hoarder',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.behavior.tradeAggression === 'low') { score += 25; signals.push('Low trade activity') }
      if (m.behavior.prefersPicks) { score += 20; signals.push('Prefers accumulating picks') }
      const pickCount = m.assets.filter(a => a.type === 'pick').length
      if (pickCount >= 8) { score += 25; signals.push(`${pickCount} draft picks hoarded`) }
      if (m.behavior.avgTradesPerSeason < 3) { score += 15; signals.push('Rarely trades') }
      return { match: score >= 40, confidence: Math.min(0.90, score / 70), signals }
    },
    tips: [
      'Hard to pry assets from — needs strong overpay incentive',
      'Respond to "you have too many picks to use" framing',
      'May only engage if they feel they are clearly winning the trade',
    ],
  },
  {
    id: 'rebuilder',
    label: 'Rebuilder',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.phase === 'rebuild') { score += 35; signals.push('Rebuild phase') }
      if (m.behavior.prefersYouth) { score += 15; signals.push('Youth preference') }
      if (m.behavior.prefersPicks) { score += 15; signals.push('Pick preference') }
      const youngRatio = m.assets.filter(a => a.player && a.player.age !== null && a.player.age <= 25).length / Math.max(1, m.assets.length)
      if (youngRatio > 0.5) { score += 15; signals.push('Mostly young roster') }
      return { match: score >= 40, confidence: Math.min(0.90, score / 70), signals }
    },
    tips: [
      'Sell veterans at reasonable prices — they want future assets',
      'Bundle veteran + pick for young player',
      'Draft picks are currency — offer multiple late picks for their vet',
    ],
  },
  {
    id: 'win_now',
    label: 'Win-Now',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.phase === 'contender' || m.phase === 'competitor') { score += 30; signals.push('Contender phase') }
      if (!m.behavior.prefersPicks) { score += 10 }
      if (m.behavior.prefersConsolidation) { score += 15; signals.push('Prefers consolidation') }
      const veteranCount = m.assets.filter(a => a.player && a.player.age !== null && a.player.age >= 27).length
      if (veteranCount >= 5) { score += 15; signals.push('Heavy veteran roster') }
      return { match: score >= 40, confidence: Math.min(0.90, score / 70), signals }
    },
    tips: [
      'Willing to sacrifice future for present — offer picks to get their attention',
      'Target their weak positions with your depth pieces',
      'Time-sensitive — more desperate as season progresses',
    ],
  },
  {
    id: 'passive',
    label: 'Passive',
    test: (m) => {
      const signals: string[] = []
      let score = 0
      if (m.behavior.tradeAggression === 'low') { score += 30; signals.push('Low engagement') }
      if (m.behavior.avgTradesPerSeason < 2) { score += 30; signals.push('Almost never trades') }
      if (m.behavior.riskTolerance === 'low') { score += 10 }
      return { match: score >= 40, confidence: Math.min(0.85, score / 60), signals }
    },
    tips: [
      'Unlikely to initiate — you must approach them',
      'Needs obvious value tilt in their favor to engage',
      'Keep proposals simple (2-for-1 max)',
    ],
  },
]

function classifyArchetype(manager: EngineManagerProfile): ArchetypeClassification {
  let best: ArchetypeClassification = {
    archetype: 'unknown',
    confidence: 0,
    signals: [],
    negotiationTips: [],
  }

  for (const rule of ARCHETYPE_RULES) {
    const { match, confidence, signals } = rule.test(manager)
    if (match && confidence > best.confidence) {
      best = {
        archetype: rule.id,
        confidence,
        signals,
        negotiationTips: rule.tips,
      }
    }
  }

  return best
}

export function classifyAllArchetypes(
  managers: Record<number, EngineManagerProfile>
): Record<number, ArchetypeClassification> {
  const result: Record<number, ArchetypeClassification> = {}
  for (const [id, mgr] of Object.entries(managers)) {
    result[Number(id)] = classifyArchetype(mgr)
  }
  return result
}

export function archetypeAcceptanceModifier(
  senderArchetype: ArchetypeId,
  receiverArchetype: ArchetypeId
): number {
  if (receiverArchetype === 'passive') return -0.15
  if (receiverArchetype === 'hoarder') return -0.10
  if (receiverArchetype === 'shark' && senderArchetype === 'fair_dealer') return -0.05
  if (receiverArchetype === 'gambler') return 0.05
  if (receiverArchetype === 'rebuilder' && senderArchetype === 'win_now') return 0.08
  if (receiverArchetype === 'win_now' && senderArchetype === 'rebuilder') return 0.05
  return 0
}
