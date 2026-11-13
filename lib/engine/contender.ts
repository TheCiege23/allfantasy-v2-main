import type { EngineManagerProfile, EngineLeagueContext, TeamPhase } from './types'

export interface ContenderClassification {
  phase: TeamPhase
  score: number
  confidence: number
  signals: string[]
}

export function classifyTeamPhase(
  manager: EngineManagerProfile,
  league: EngineLeagueContext,
  leagueAvgPointsFor?: number
): ContenderClassification {
  const signals: string[] = []
  let score = 50

  const { wins, losses } = manager.record
  const totalGames = wins + losses
  const winPct = totalGames > 0 ? wins / totalGames : 0.5

  if (winPct >= 0.65) {
    score += 20
    signals.push('Strong winning record')
  } else if (winPct >= 0.5) {
    score += 5
  } else if (winPct <= 0.35) {
    score -= 20
    signals.push('Poor record')
  } else if (winPct <= 0.45) {
    score -= 10
  }

  if (leagueAvgPointsFor && leagueAvgPointsFor > 0) {
    const ptsRatio = manager.pointsFor / leagueAvgPointsFor
    if (ptsRatio >= 1.1) {
      score += 15
      signals.push('Above-average scoring')
    } else if (ptsRatio <= 0.85) {
      score -= 15
      signals.push('Below-average scoring')
    }
  }

  const starterAssets = manager.assets.filter(a =>
    a.type === 'player' && a.player && a.player.usage.role === 'starter'
  )
  const youngAssets = manager.assets.filter(a =>
    a.type === 'player' && a.player && a.player.age !== null && a.player.age <= 25
  )
  const pickAssets = manager.assets.filter(a => a.type === 'pick')

  const youthRatio = manager.assets.length > 0 ? youngAssets.length / manager.assets.length : 0
  const pickCount = pickAssets.length

  if (youthRatio > 0.6) {
    score -= 10
    signals.push('Youth-heavy roster')
  }
  if (pickCount >= 6) {
    score -= 15
    signals.push('Stockpiling picks (rebuild signal)')
  }
  if (starterAssets.length >= 5) {
    score += 10
    signals.push('Strong starter depth')
  }

  if (manager.standingsRank > 0 && manager.standingsRank <= 3) {
    score += 10
    signals.push(`Top-${manager.standingsRank} in standings`)
  } else if (manager.standingsRank > league.numTeams - 3) {
    score -= 10
    signals.push('Bottom of standings')
  }

  let phase: TeamPhase
  if (score >= 75) phase = 'contender'
  else if (score >= 55) phase = 'competitor'
  else if (score >= 40) phase = 'middle'
  else phase = 'rebuild'

  const confidence = totalGames >= 6 ? 0.85 : totalGames >= 3 ? 0.6 : 0.4

  return { phase, score, confidence, signals }
}

export function classifyAllTeams(
  managers: Record<number, EngineManagerProfile>,
  league: EngineLeagueContext
): Record<number, ContenderClassification> {
  const allPointsFor = Object.values(managers).map(m => m.pointsFor)
  const avgPF = allPointsFor.length > 0
    ? allPointsFor.reduce((a, b) => a + b, 0) / allPointsFor.length
    : undefined

  const result: Record<number, ContenderClassification> = {}
  for (const [id, mgr] of Object.entries(managers)) {
    result[Number(id)] = classifyTeamPhase(mgr, league, avgPF)
  }
  return result
}

