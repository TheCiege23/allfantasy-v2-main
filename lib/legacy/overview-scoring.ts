type LeagueClass = 'dynasty' | 'redraft' | 'specialty'

export interface LeagueRecord {
  league_id: string
  type: string
  scoring: string
  specialty_format?: string
  is_sf?: boolean
  is_tep?: boolean
  team_count: number
  wins: number
  losses: number
  ties?: number
  is_champion: boolean
  made_playoffs: boolean
}

export interface LaneStats {
  label: string
  leagueClass: LeagueClass
  leagues: number
  wins: number
  losses: number
  ties: number
  winRate: number
  playoffRate: number
  championshipRate: number
  championships: number
  difficultyScore: number
  adjustedWinRate: number
  topStrength: string
  nextEdge: string
}

export interface StrengthTag {
  label: string
  color: 'amber' | 'cyan' | 'emerald' | 'purple' | 'rose'
}

export interface SubGrade {
  label: string
  grade: string
  score: number
}

export interface CompositeProfile {
  legacyScore: number
  strengthTags: StrengthTag[]
  subGrades: SubGrade[]
  lanes: LaneStats[]
  rawWinRate: number
  adjustedWinRate: number
  difficultyMultiplier: number
}

function classifyLeague(league: LeagueRecord): LeagueClass {
  const sfmt = (league.specialty_format ?? '').toLowerCase()
  if (sfmt && sfmt !== 'standard' && sfmt !== 'none') return 'specialty'
  const lt = (league.type ?? '').toLowerCase()
  if (lt.includes('dyn') || lt === 'keeper' || lt.includes('keep')) return 'dynasty'
  return 'redraft'
}

function computeDifficultyMultiplier(league: LeagueRecord): number {
  let mult = 1.0
  if (league.is_sf) mult += 0.15
  if (league.is_tep) mult += 0.10
  if (league.team_count >= 14) mult += 0.10
  const cls = classifyLeague(league)
  if (cls === 'specialty') mult += 0.10
  if (cls === 'dynasty') mult += 0.05
  return mult
}

function computeLaneStats(leagues: LeagueRecord[], label: string, leagueClass: LeagueClass): LaneStats {
  const n = leagues.length
  const wins = leagues.reduce((s, l) => s + l.wins, 0)
  const losses = leagues.reduce((s, l) => s + l.losses, 0)
  const ties = leagues.reduce((s, l) => s + (l.ties ?? 0), 0)
  const totalGames = wins + losses + ties
  const winRate = totalGames > 0 ? (wins / totalGames) * 100 : 0

  const playoffCount = leagues.filter(l => l.made_playoffs).length
  const playoffRate = n > 0 ? (playoffCount / n) * 100 : 0

  const championships = leagues.filter(l => l.is_champion).length
  const championshipRate = n > 0 ? (championships / n) * 100 : 0

  const avgDifficulty = n > 0
    ? leagues.reduce((s, l) => s + computeDifficultyMultiplier(l), 0) / n
    : 1.0

  const difficultyBonus = (avgDifficulty - 1.0) * 100
  const adjustedWinRate = Math.min(100, winRate + difficultyBonus * 0.5)

  const { topStrength, nextEdge } = deriveLaneInsights({
    winRate, playoffRate, championshipRate, n, championships
  })

  return {
    label,
    leagueClass,
    leagues: n,
    wins,
    losses,
    ties,
    winRate: Math.round(winRate * 10) / 10,
    playoffRate: Math.round(playoffRate * 10) / 10,
    championshipRate: Math.round(championshipRate * 10) / 10,
    championships,
    difficultyScore: Math.round(avgDifficulty * 100) / 100,
    adjustedWinRate: Math.round(adjustedWinRate * 10) / 10,
    topStrength,
    nextEdge,
  }
}

function deriveLaneInsights(x: {
  winRate: number
  playoffRate: number
  championshipRate: number
  n: number
  championships: number
}): { topStrength: string; nextEdge: string } {
  const strengths: { label: string; score: number }[] = [
    { label: 'Consistent winner with a strong regular season foundation', score: x.winRate },
    { label: 'Reliable playoff contender who consistently reaches the postseason', score: x.playoffRate },
    { label: 'Championship closer who converts playoff runs into titles', score: x.championshipRate * 3 },
    { label: 'High-volume competitor with extensive league experience', score: Math.min(100, x.n * 2) },
  ]
  strengths.sort((a, b) => b.score - a.score)

  const edges: { label: string; score: number }[] = [
    { label: 'Your next edge: locking in regular season wins to secure a higher playoff seed', score: 100 - x.winRate },
    { label: 'Your next edge: using late-season waiver moves to push into the playoffs', score: 100 - x.playoffRate },
    { label: 'Your next edge: converting your playoff runs into championship finishes', score: x.playoffRate > 0 ? 100 - (x.championshipRate / Math.max(1, x.playoffRate) * 100) : 0 },
  ]
  edges.sort((a, b) => b.score - a.score)

  return {
    topStrength: strengths[0].label,
    nextEdge: edges[0].label,
  }
}

function deriveStrengthTags(
  stats: { winRate: number; playoffRate: number; championships: number; leagues: number; adjustedWinRate: number },
): StrengthTag[] {
  const tags: StrengthTag[] = []

  if (stats.playoffRate >= 50) tags.push({ label: 'Playoff Regular', color: 'cyan' })
  if (stats.championships >= 3) tags.push({ label: 'Closer', color: 'amber' })
  if (stats.leagues >= 50) tags.push({ label: 'Volume Grinder', color: 'purple' })
  if (stats.winRate >= 55) tags.push({ label: 'Winning Machine', color: 'emerald' })
  if (stats.adjustedWinRate - stats.winRate >= 3) tags.push({ label: 'Difficulty Hunter', color: 'rose' })
  if (stats.championships >= 1 && stats.winRate < 50) tags.push({ label: 'High Variance Hunter', color: 'rose' })
  if (stats.playoffRate >= 60 && stats.championships >= 2) tags.push({ label: 'Elite Contender', color: 'amber' })

  if (tags.length === 0) {
    tags.push({ label: 'Rising Competitor', color: 'cyan' })
  }

  return tags.slice(0, 4)
}

function computeSubGrades(
  lanes: LaneStats[],
  totalStats: { winRate: number; playoffRate: number; championships: number; leagues: number },
): SubGrade[] {
  const rosterScore = Math.min(100,
    totalStats.winRate * 0.4 +
    totalStats.playoffRate * 0.4 +
    Math.min(30, totalStats.championships * 5) * 0.2 +
    20
  )

  const tradeScore = Math.min(100,
    totalStats.winRate * 0.3 +
    totalStats.playoffRate * 0.3 +
    Math.min(20, totalStats.leagues * 0.5) +
    15
  )

  const waiverScore = Math.min(100,
    totalStats.winRate * 0.35 +
    totalStats.playoffRate * 0.35 +
    Math.min(15, totalStats.leagues * 0.3) +
    15
  )

  return [
    { label: 'Roster Build', grade: scoreToGrade(rosterScore), score: Math.round(rosterScore) },
    { label: 'Trade Skill', grade: scoreToGrade(tradeScore), score: Math.round(tradeScore) },
    { label: 'Waiver Skill', grade: scoreToGrade(waiverScore), score: Math.round(waiverScore) },
  ]
}

function scoreToGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  if (score >= 67) return 'D+'
  if (score >= 63) return 'D'
  if (score >= 60) return 'D-'
  return 'F'
}

function computeLegacyScore(
  totalStats: { winRate: number; playoffRate: number; championships: number; leagues: number },
  adjustedWinRate: number,
  avgDifficulty: number,
): number {
  const winComponent = adjustedWinRate * 0.30
  const playoffComponent = totalStats.playoffRate * 0.25
  const chipComponent = Math.min(25, totalStats.championships * 2.5)
  const volumeComponent = Math.min(10, totalStats.leagues * 0.1)
  const difficultyBonus = Math.min(10, (avgDifficulty - 1.0) * 25)

  const raw = winComponent + playoffComponent + chipComponent + volumeComponent + difficultyBonus
  return Math.max(0, Math.min(100, Math.round(raw)))
}

export function computeCompositeProfile(leagues: LeagueRecord[]): CompositeProfile {
  const dynastyLeagues = leagues.filter(l => classifyLeague(l) === 'dynasty')
  const redraftLeagues = leagues.filter(l => classifyLeague(l) === 'redraft')
  const specialtyLeagues = leagues.filter(l => classifyLeague(l) === 'specialty')

  const lanes: LaneStats[] = []
  if (dynastyLeagues.length > 0) lanes.push(computeLaneStats(dynastyLeagues, 'Dynasty Career', 'dynasty'))
  if (redraftLeagues.length > 0) lanes.push(computeLaneStats(redraftLeagues, 'Redraft Career', 'redraft'))
  if (specialtyLeagues.length > 0) lanes.push(computeLaneStats(specialtyLeagues, 'Specialty Formats', 'specialty'))

  const totalWins = leagues.reduce((s, l) => s + l.wins, 0)
  const totalLosses = leagues.reduce((s, l) => s + l.losses, 0)
  const totalTies = leagues.reduce((s, l) => s + (l.ties ?? 0), 0)
  const totalGames = totalWins + totalLosses + totalTies
  const rawWinRate = totalGames > 0 ? (totalWins / totalGames) * 100 : 0

  const avgDifficulty = leagues.length > 0
    ? leagues.reduce((s, l) => s + computeDifficultyMultiplier(l), 0) / leagues.length
    : 1.0

  const difficultyBonus = (avgDifficulty - 1.0) * 100
  const adjustedWinRate = Math.min(100, rawWinRate + difficultyBonus * 0.5)

  const totalChampionships = leagues.filter(l => l.is_champion).length
  const playoffCount = leagues.filter(l => l.made_playoffs).length
  const playoffRate = leagues.length > 0 ? (playoffCount / leagues.length) * 100 : 0

  const totalStats = {
    winRate: rawWinRate,
    playoffRate,
    championships: totalChampionships,
    leagues: leagues.length,
  }

  const legacyScore = computeLegacyScore(totalStats, adjustedWinRate, avgDifficulty)

  const strengthTags = deriveStrengthTags({
    winRate: rawWinRate,
    playoffRate,
    championships: totalChampionships,
    leagues: leagues.length,
    adjustedWinRate,
  })

  const subGrades = computeSubGrades(lanes, totalStats)

  return {
    legacyScore,
    strengthTags,
    subGrades,
    lanes,
    rawWinRate: Math.round(rawWinRate * 10) / 10,
    adjustedWinRate: Math.round(adjustedWinRate * 10) / 10,
    difficultyMultiplier: Math.round(avgDifficulty * 100) / 100,
  }
}

export function generateLaneInsight(lane: LaneStats): {
  strengths: string[]
  nextEdge: string
  nextAction: { label: string; tab: string }
} {
  const strengths: string[] = []

  if (lane.winRate >= 55) {
    strengths.push(`${lane.winRate}% win rate in ${lane.label.toLowerCase()} leagues shows strong roster management`)
  } else if (lane.winRate >= 45) {
    strengths.push(`Sustaining ${lane.winRate}% across ${lane.leagues} ${lane.label.toLowerCase()} leagues demonstrates competitive depth`)
  }

  if (lane.playoffRate >= 50) {
    strengths.push(`${lane.playoffRate}% playoff rate means you're consistently building contending rosters`)
  }

  if (lane.championships >= 2) {
    strengths.push(`${lane.championships} championships prove you know how to close when it matters`)
  } else if (lane.championships === 1) {
    strengths.push(`Your championship shows you can peak at the right time`)
  }

  if (lane.difficultyScore >= 1.15) {
    strengths.push(`Competing in tougher formats (difficulty ${lane.difficultyScore}x) makes your results even more impressive`)
  }

  if (strengths.length === 0) {
    strengths.push(`You're building experience across ${lane.leagues} ${lane.label.toLowerCase()} leagues`)
  }

  const nextEdge = lane.nextEdge
  let nextAction: { label: string; tab: string }

  if (lane.playoffRate < 40) {
    nextAction = { label: 'Open Waiver AI', tab: 'waiver' }
  } else if (lane.championshipRate < 10 && lane.playoffRate >= 40) {
    nextAction = { label: 'Open Trade Hub', tab: 'trade' }
  } else {
    nextAction = { label: 'Open Rankings', tab: 'rankings' }
  }

  if (lane.difficultyScore >= 1.15) {
    strengths.push(`Playing in ${lane.difficultyScore}x difficulty formats means your stats understate your skill`)
  }

  return {
    strengths: strengths.slice(0, 3),
    nextEdge,
    nextAction,
  }
}
