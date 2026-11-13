/**
 * AI Upset / Chaos Detector Engine
 *
 * Identifies fragile favorites, live underdogs, volatility hotspots,
 * and high-chaos conditions. Separates real fragility from normal variance.
 *
 * Pure deterministic. <10ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ChaosModeEnum = z.enum([
  'matchup_watch', 'leaguewide_scan', 'favorite_fragility', 'underdog_paths',
  'playoff_chaos', 'player_volatility', 'weather_chaos', 'dfs_chaos',
])

interface ChaosPlayer {
  playerId: string
  playerName: string
  position: string
  projection: number
  floor: number
  ceiling: number
  volatility: number
  injuryStatus: string
  weatherImpact: number // 0-1 (1 = no impact)
}

interface ChaosMatchup {
  teamAName: string
  teamBName: string
  teamAProjection: number
  teamBProjection: number
  teamAPlayers: ChaosPlayer[]
  teamBPlayers: ChaosPlayer[]
  isPlayoff: boolean
}

export const ChaosDetectorInputSchema = z.object({
  sport: z.string().default('NFL'),
  chaosMode: ChaosModeEnum.default('matchup_watch'),
  weekOrSlate: z.number().default(1),
  matchups: z.array(z.object({
    teamAName: z.string(), teamBName: z.string(),
    teamAProjection: z.number(), teamBProjection: z.number(),
    teamAPlayers: z.array(z.object({
      playerId: z.string(), playerName: z.string(), position: z.string(),
      projection: z.number(), floor: z.number(), ceiling: z.number(),
      volatility: z.number().default(0.2), injuryStatus: z.string().default('healthy'),
      weatherImpact: z.number().default(1.0),
    })).default([]),
    teamBPlayers: z.array(z.object({
      playerId: z.string(), playerName: z.string(), position: z.string(),
      projection: z.number(), floor: z.number(), ceiling: z.number(),
      volatility: z.number().default(0.2), injuryStatus: z.string().default('healthy'),
      weatherImpact: z.number().default(1.0),
    })).default([]),
    isPlayoff: z.boolean().default(false),
  })).default([]),
})
type ChaosDetectorInput = z.infer<typeof ChaosDetectorInputSchema>

interface UpsetSpot {
  label: string
  upsetScore: number
  whyItMatters: string
  chaosDrivers: string[]
  strategyImplication: string
}

interface ChaosDetectorResult {
  chaosMode: string
  confidencePct: number
  chaosSummary: string
  chaosIndex: number
  topUpsetSpots: UpsetSpot[]
  fragileFavorites: string[]
  liveUnderdogs: string[]
  volatilityHotspots: string[]
  playerChaosFlags: string[]
  weatherChaosFlags: string[]
  injuryFragilityFlags: string[]
  leverageNotes: string[]
  strategyRecommendations: string[]
  summary: string
  generatedAt: string
  highestFragilityMatchup: string
  playoffShockRiskScore: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

function computeTeamFragility(players: ChaosPlayer[]): number {
  if (players.length === 0) return 50
  const total = players.reduce((s, p) => s + p.projection, 0)
  const topPlayer = [...players].sort((a, b) => b.projection - a.projection)[0]
  const concentration = topPlayer && total > 0 ? topPlayer.projection / total : 0
  const highVol = players.filter(p => p.volatility >= 0.3).length
  const injured = players.filter(p => p.injuryStatus !== 'healthy').length
  const weatherHit = players.filter(p => p.weatherImpact < 0.9).length
  return clamp(Math.round(concentration * 120 + highVol * 12 + injured * 15 + weatherHit * 10), 0, 100)
}

function computeUpsetScore(matchup: ChaosMatchup): number {
  const margin = Math.abs(matchup.teamAProjection - matchup.teamBProjection)
  const favPlayers = matchup.teamAProjection >= matchup.teamBProjection ? matchup.teamAPlayers : matchup.teamBPlayers
  const dogPlayers = matchup.teamAProjection >= matchup.teamBProjection ? matchup.teamBPlayers : matchup.teamAPlayers
  const favFragility = computeTeamFragility(favPlayers)
  const dogCeiling = dogPlayers.reduce((s, p) => s + p.ceiling, 0)
  const favFloor = favPlayers.reduce((s, p) => s + p.floor, 0)
  let score = 30
  if (margin < 5) score += 20
  else if (margin < 10) score += 10
  if (favFragility >= 50) score += 15
  if (dogCeiling > favFloor + 10) score += 15
  if (matchup.isPlayoff) score += 10
  return clamp(score, 0, 100)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function detectChaos(input: ChaosDetectorInput): ChaosDetectorResult {
  const upsetSpots: UpsetSpot[] = []
  const fragileFavorites: string[] = []
  const liveUnderdogs: string[] = []
  const volatilityHotspots: string[] = []
  const playerChaosFlags: string[] = []
  const weatherFlags: string[] = []
  const injuryFlags: string[] = []
  let totalChaosScore = 0

  for (const m of input.matchups) {
    const upsetScore = computeUpsetScore(m)
    totalChaosScore += upsetScore
    const favName = m.teamAProjection >= m.teamBProjection ? m.teamAName : m.teamBName
    const dogName = m.teamAProjection >= m.teamBProjection ? m.teamBName : m.teamAName
    const favPlayers = m.teamAProjection >= m.teamBProjection ? m.teamAPlayers : m.teamBPlayers
    const dogPlayers = m.teamAProjection >= m.teamBProjection ? m.teamBPlayers : m.teamAPlayers
    const favFragility = computeTeamFragility(favPlayers)
    const margin = Math.abs(m.teamAProjection - m.teamBProjection)
    const drivers: string[] = []
    if (margin < 5) drivers.push('Razor-thin margin')
    if (favFragility >= 50) drivers.push(`${favName} has fragile lineup (${favFragility}/100)`)
    const favInjured = favPlayers.filter(p => p.injuryStatus !== 'healthy')
    if (favInjured.length >= 2) drivers.push(`${favName} has ${favInjured.length} injury concerns`)
    const dogHighCeiling = dogPlayers.filter(p => p.ceiling >= 25)
    if (dogHighCeiling.length >= 2) drivers.push(`${dogName} has ${dogHighCeiling.length} boom-capable players`)

    if (upsetScore >= 50) {
      upsetSpots.push({
        label: `${dogName} vs ${favName}`,
        upsetScore,
        whyItMatters: m.isPlayoff ? 'Playoff upset would be season-defining' : `${dogName} has a real path to the upset`,
        chaosDrivers: drivers,
        strategyImplication: upsetScore >= 70 ? `Play safe if you are ${favName} — this is not the lock it looks like` : `Watch for ${dogName} to surprise — consider upside plays if you are the underdog`,
      })
    }

    if (favFragility >= 55) fragileFavorites.push(`${favName} — fragility ${favFragility}/100, projected margin only ${margin.toFixed(1)}`)
    if (upsetScore >= 45) liveUnderdogs.push(`${dogName} — upset score ${upsetScore}/100`)

    for (const p of [...favPlayers, ...dogPlayers]) {
      if (p.volatility >= 0.35) playerChaosFlags.push(`${p.playerName} — extreme volatility (${(p.volatility * 100).toFixed(0)}%)`)
      if (p.weatherImpact < 0.85) weatherFlags.push(`${p.playerName} — weather impact (${Math.round((1 - p.weatherImpact) * 100)}% reduction)`)
      if (p.injuryStatus !== 'healthy' && p.projection >= 10) injuryFlags.push(`${p.playerName} (${p.injuryStatus}) — ${p.projection.toFixed(1)} projected pts at risk`)
    }

    if (favPlayers.some(p => p.volatility >= 0.3) || dogPlayers.some(p => p.volatility >= 0.3)) {
      volatilityHotspots.push(`${m.teamAName} vs ${m.teamBName} — high-variance matchup`)
    }
  }

  upsetSpots.sort((a, b) => b.upsetScore - a.upsetScore)
  const chaosIndex = input.matchups.length > 0 ? clamp(Math.round(totalChaosScore / input.matchups.length), 0, 100) : 0
  const highestFragility = fragileFavorites[0] ?? 'No fragile favorites detected'

  const strategyRecs: string[] = []
  if (chaosIndex >= 60) strategyRecs.push('High chaos week — underdogs should play for ceiling, favorites should protect floor')
  if (chaosIndex >= 40) strategyRecs.push('Moderate chaos — look for leverage in volatile spots')
  if (fragileFavorites.length >= 2) strategyRecs.push('Multiple fragile favorites — bet against the consensus where data supports it')

  const playoffShockRisk = input.matchups.filter(m => m.isPlayoff).length > 0
    ? clamp(Math.round(upsetSpots.filter(u => input.matchups.find(m => m.isPlayoff && u.label.includes(m.teamAName))?.isPlayoff).reduce((s, u) => s + u.upsetScore, 0) / Math.max(1, input.matchups.filter(m => m.isPlayoff).length)), 0, 100)
    : 0

  return {
    chaosMode: input.chaosMode, confidencePct: clamp(50 + (input.matchups.length >= 4 ? 15 : 0) + (upsetSpots.length >= 2 ? 10 : 0), 30, 85),
    chaosSummary: `Week ${input.weekOrSlate}: Chaos index ${chaosIndex}/100. ${upsetSpots.length} upset spots, ${fragileFavorites.length} fragile favorites, ${liveUnderdogs.length} live underdogs.`,
    chaosIndex, topUpsetSpots: upsetSpots.slice(0, 5),
    fragileFavorites: fragileFavorites.slice(0, 4), liveUnderdogs: liveUnderdogs.slice(0, 4),
    volatilityHotspots: volatilityHotspots.slice(0, 4), playerChaosFlags: [...new Set(playerChaosFlags)].slice(0, 5),
    weatherChaosFlags: [...new Set(weatherFlags)].slice(0, 3), injuryFragilityFlags: [...new Set(injuryFlags)].slice(0, 4),
    leverageNotes: upsetSpots.slice(0, 2).map(u => `Leverage: ${u.strategyImplication}`),
    strategyRecommendations: strategyRecs,
    summary: `Chaos index: ${chaosIndex}/100 | ${upsetSpots.length} upset spots | ${fragileFavorites.length} fragile favorites | ${liveUnderdogs.length} live underdogs`,
    generatedAt: new Date().toISOString(),
    highestFragilityMatchup: highestFragility, playoffShockRiskScore: playoffShockRisk,
  }
}
