/**
 * AI Rivalry Engine
 *
 * Detects, scores, and tracks rivalries from league history. Generates
 * rivalry context for matchups, stories, alerts, and commissioner engagement.
 *
 * Pure deterministic. <15ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const RivalryModeEnum = z.enum([
  'automatic_detection', 'matchup_focus', 'leaguewide_report',
  'playoff_history', 'story_generation', 'commissioner_highlight',
])

export type RivalryType =
  | 'head_to_head' | 'division' | 'playoff_revenge' | 'championship_rematch'
  | 'trade_driven' | 'commissioner_challenger' | 'dynasty_long_arc'
  | 'cross_season_grudge' | 'social_cluster'

export const RivalryInputSchema = z.object({
  leagueId: z.string(),
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  rivalryMode: RivalryModeEnum.default('automatic_detection'),
  historicalMatchups: z.array(z.object({
    managerA: z.string(), managerB: z.string(), season: z.number(),
    week: z.number(), scoreA: z.number(), scoreB: z.number(),
    isPlayoff: z.boolean().default(false), isChampionship: z.boolean().default(false),
  })).default([]),
  tradeInteractions: z.array(z.object({
    managerA: z.string(), managerB: z.string(), season: z.number(),
    wasBlocked: z.boolean().default(false), wasControversial: z.boolean().default(false),
  })).default([]),
  playoffEliminations: z.array(z.object({
    eliminator: z.string(), eliminated: z.string(), season: z.number(), round: z.string(),
  })).default([]),
  championshipHistory: z.array(z.object({
    winner: z.string(), runnerUp: z.string(), season: z.number(),
  })).default([]),
  focusManagerA: z.string().optional(),
  focusManagerB: z.string().optional(),
})
export type RivalryInput = z.infer<typeof RivalryInputSchema>

export interface RivalryPair {
  rivalryId: string
  managerA: string
  managerB: string
  intensityScore: number
  rivalryType: RivalryType
  rivalryLabel: string
  originStory: string
  currentStatus: string
  keyMoments: string[]
  recentFuel: string[]
  stakesNow: string
  nextChapterHook: string
}

export interface RivalryResult {
  rivalryMode: string
  rivalryPairs: RivalryPair[]
  topRivalryHeadline: string
  leagueRivalrySummary: string
  featuredRivalries: string[]
  emergingRivalries: string[]
  fadingRivalries: string[]
  commissionerOpportunities: string[]
  storyHooks: string[]
  summary: string
  generatedAt: string
  rivalryHeatTrend: 'rising' | 'stable' | 'cooling'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::')
}

// ---------------------------------------------------------------------------
// Rivalry Detection
// ---------------------------------------------------------------------------

function detectRivalries(input: RivalryInput): RivalryPair[] {
  const pairScores = new Map<string, {
    managerA: string; managerB: string
    matchupCount: number; closeGames: number; upsets: number
    playoffMeetings: number; championshipMeetings: number
    eliminationCount: number; tradeConflicts: number
    recentSeasons: Set<number>; keyMoments: string[]
  }>()

  // Initialize helper
  function getOrCreate(a: string, b: string) {
    const key = pairKey(a, b)
    if (!pairScores.has(key)) {
      pairScores.set(key, {
        managerA: a, managerB: b, matchupCount: 0, closeGames: 0, upsets: 0,
        playoffMeetings: 0, championshipMeetings: 0, eliminationCount: 0,
        tradeConflicts: 0, recentSeasons: new Set(), keyMoments: [],
      })
    }
    return pairScores.get(key)!
  }

  // Process matchups
  for (const m of input.historicalMatchups) {
    const pair = getOrCreate(m.managerA, m.managerB)
    pair.matchupCount++
    pair.recentSeasons.add(m.season)
    const margin = Math.abs(m.scoreA - m.scoreB)
    if (margin <= 5) { pair.closeGames++; pair.keyMoments.push(`Close game in S${m.season}W${m.week} (${margin.toFixed(1)} pt margin)`) }
    if (m.isPlayoff) { pair.playoffMeetings++; pair.keyMoments.push(`Playoff matchup S${m.season}`) }
    if (m.isChampionship) { pair.championshipMeetings++; pair.keyMoments.push(`Championship matchup S${m.season}`) }
  }

  // Process playoff eliminations
  for (const e of input.playoffEliminations) {
    const pair = getOrCreate(e.eliminator, e.eliminated)
    pair.eliminationCount++
    pair.keyMoments.push(`${e.eliminator} eliminated ${e.eliminated} in ${e.round} (S${e.season})`)
  }

  // Process championship history
  for (const c of input.championshipHistory) {
    const pair = getOrCreate(c.winner, c.runnerUp)
    pair.championshipMeetings++
    pair.keyMoments.push(`${c.winner} defeated ${c.runnerUp} in the championship (S${c.season})`)
  }

  // Process trade interactions
  for (const t of input.tradeInteractions) {
    if (t.wasBlocked || t.wasControversial) {
      const pair = getOrCreate(t.managerA, t.managerB)
      pair.tradeConflicts++
      pair.keyMoments.push(`${t.wasBlocked ? 'Blocked' : 'Controversial'} trade between them (S${t.season})`)
    }
  }

  // Score and classify each pair
  const rivalries: RivalryPair[] = []
  for (const [key, pair] of pairScores) {
    let intensity = 0
    intensity += Math.min(20, pair.matchupCount * 3)
    intensity += pair.closeGames * 8
    intensity += pair.playoffMeetings * 12
    intensity += pair.championshipMeetings * 20
    intensity += pair.eliminationCount * 15
    intensity += pair.tradeConflicts * 10
    intensity += pair.recentSeasons.size >= 3 ? 10 : 0
    intensity = clamp(intensity, 0, 100)

    if (intensity < 20) continue // not a real rivalry

    // Classify type
    let rivalryType: RivalryType = 'head_to_head'
    if (pair.championshipMeetings >= 1) rivalryType = 'championship_rematch'
    else if (pair.eliminationCount >= 1) rivalryType = 'playoff_revenge'
    else if (pair.tradeConflicts >= 2) rivalryType = 'trade_driven'
    else if (pair.recentSeasons.size >= 4) rivalryType = 'cross_season_grudge'
    else if (input.leagueType === 'dynasty' && pair.matchupCount >= 6) rivalryType = 'dynasty_long_arc'

    // Label
    const label = intensity >= 75 ? 'Heated Rivalry' : intensity >= 50 ? 'Growing Rivalry' : 'Budding Rivalry'

    // Origin story
    const earliest = pair.keyMoments[0] ?? 'Multiple close matchups over time'
    const originStory = pair.championshipMeetings >= 1
      ? `Born in the championship — ${pair.managerA} and ${pair.managerB} have met on the biggest stage.`
      : pair.eliminationCount >= 1
        ? `Started when ${pair.keyMoments.find(m => m.includes('eliminated')) ?? 'one eliminated the other in the playoffs'}.`
        : `Built through ${pair.matchupCount} matchups and ${pair.closeGames} close games.`

    // Current status
    const currentStatus = intensity >= 70 ? 'Active and heated — every matchup matters'
      : intensity >= 45 ? 'Building momentum — pay attention when they play'
      : 'Simmering — could ignite with the right matchup'

    // Stakes
    const stakesNow = pair.playoffMeetings >= 1 ? 'Playoff history adds extra weight to every meeting'
      : pair.closeGames >= 3 ? 'Historically close — expect another nail-biter'
      : 'Pride and bragging rights on the line'

    // Next chapter hook
    const nextChapterHook = pair.championshipMeetings >= 1
      ? 'Will they meet in the championship again? The potential rematch looms.'
      : pair.eliminationCount >= 1
        ? 'Revenge is in the air. The eliminated party wants payback.'
        : 'The next matchup between these two will tell us if this rivalry is real.'

    rivalries.push({
      rivalryId: key,
      managerA: pair.managerA,
      managerB: pair.managerB,
      intensityScore: intensity,
      rivalryType,
      rivalryLabel: label,
      originStory,
      currentStatus,
      keyMoments: pair.keyMoments.slice(-5),
      recentFuel: pair.keyMoments.slice(-2),
      stakesNow,
      nextChapterHook,
    })
  }

  rivalries.sort((a, b) => b.intensityScore - a.intensityScore)
  return rivalries
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeRivalries(input: RivalryInput): RivalryResult {
  let rivalries = detectRivalries(input)

  // Focus mode filtering
  if (input.rivalryMode === 'matchup_focus' && input.focusManagerA && input.focusManagerB) {
    rivalries = rivalries.filter(r =>
      (r.managerA === input.focusManagerA && r.managerB === input.focusManagerB) ||
      (r.managerA === input.focusManagerB && r.managerB === input.focusManagerA),
    )
  }

  const featured = rivalries.filter(r => r.intensityScore >= 60).map(r => `${r.managerA} vs ${r.managerB} (${r.rivalryLabel})`)
  const emerging = rivalries.filter(r => r.intensityScore >= 30 && r.intensityScore < 60).map(r => `${r.managerA} vs ${r.managerB}`)
  const fading = rivalries.filter(r => r.intensityScore < 30).map(r => `${r.managerA} vs ${r.managerB}`)

  const topRivalry = rivalries[0]
  const topHeadline = topRivalry
    ? `${topRivalry.managerA} vs ${topRivalry.managerB}: ${topRivalry.rivalryLabel} (${topRivalry.intensityScore}/100)`
    : 'No significant rivalries detected yet'

  const commOpps: string[] = []
  if (featured.length >= 2) commOpps.push('Feature the top rivalries in weekly power rankings or recap posts')
  if (rivalries.some(r => r.rivalryType === 'championship_rematch')) commOpps.push('Highlight championship rematch potential in league messaging')
  if (emerging.length >= 3) commOpps.push('Multiple emerging rivalries — create "Rivalry Week" content')

  const storyHooks = rivalries.slice(0, 3).map(r => r.nextChapterHook)

  const avgIntensity = rivalries.length > 0
    ? rivalries.reduce((s, r) => s + r.intensityScore, 0) / rivalries.length
    : 0
  const heatTrend: RivalryResult['rivalryHeatTrend'] = avgIntensity >= 55 ? 'rising' : avgIntensity >= 35 ? 'stable' : 'cooling'

  return {
    rivalryMode: input.rivalryMode,
    rivalryPairs: rivalries.slice(0, 10),
    topRivalryHeadline: topHeadline,
    leagueRivalrySummary: `${rivalries.length} total rivalries detected: ${featured.length} featured, ${emerging.length} emerging, ${fading.length} fading.`,
    featuredRivalries: featured.slice(0, 5),
    emergingRivalries: emerging.slice(0, 5),
    fadingRivalries: fading.slice(0, 3),
    commissionerOpportunities: commOpps,
    storyHooks,
    summary: `${rivalries.length} rivalries detected. Top: ${topHeadline}. Heat trend: ${heatTrend}.`,
    generatedAt: new Date().toISOString(),
    rivalryHeatTrend: heatTrend,
  }
}
