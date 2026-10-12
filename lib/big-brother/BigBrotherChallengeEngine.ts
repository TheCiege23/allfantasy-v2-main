/**
 * [NEW] lib/big-brother/BigBrotherChallengeEngine.ts
 * Deterministic HOH and Veto challenge resolution. AI may theme/narrate; outcome is NEVER AI-decided.
 * Modes: score-based, seeded random, hybrid (AI theme + deterministic outcome). PROMPT 3.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getBigBrotherSeasonPoints as getSeasonPointsFromRosterPerformance } from './BigBrotherScores'
import type { ChallengeMode } from './types'

/** Seeded RNG for deterministic random winner. */
function seededPick<T>(arr: T[], seed: number): T {
  if (arr.length === 0) throw new Error('Cannot pick from empty array')
  const idx = Math.abs(seed) % arr.length
  return arr[idx]
}

/** Hash string to number (deterministic). */
function hashSeed(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1
}

export interface ChallengeInput {
  leagueId: string
  configId: string
  week: number
  /** Participant roster IDs (e.g. HOH eligible or veto competitors) */
  participantRosterIds: string[]
  /** Challenge type for audit */
  challengeType: 'hoh' | 'veto'
}

export interface ScoreBasedInput extends ChallengeInput {
  /** Per-roster score for this challenge (e.g. weekly fantasy points, bench points, efficiency). Higher wins unless reverse. */
  scores: Record<string, number>
  /** If true, lowest score wins (e.g. "closest to X without going over") */
  lowestWins?: boolean
}

/**
 * Resolve winner by score: highest score wins (or lowest if lowestWins).
 * Ties: use season points through week as tiebreaker (higher season points wins for HOH; config could invert).
 */
export async function resolveChallengeByScore(input: ScoreBasedInput): Promise<string | null> {
  const { participantRosterIds, scores, lowestWins } = input
  if (participantRosterIds.length === 0) return null
  const withScores = participantRosterIds
    .filter((id) => Number.isFinite(scores[id]))
    .map((id) => ({ rosterId: id, score: scores[id] as number }))
  if (withScores.length !== participantRosterIds.length) return null

  const best = lowestWins
    ? Math.min(...withScores.map((s) => s.score))
    : Math.max(...withScores.map((s) => s.score))
  const tied = withScores.filter((s) => s.score === best).map((s) => s.rosterId).sort()
  if (tied.length === 1) return tied[0]

  const seasonPoints: Record<string, number> = {}
  for (const rosterId of tied) {
    seasonPoints[rosterId] = await getSeasonPointsFromRosterPerformance(
      input.leagueId,
      rosterId,
      input.week
    )
  }
  const tiebreakBest = Math.max(...Object.values(seasonPoints))
  const winner = tied.find((id) => seasonPoints[id] === tiebreakBest)
  return winner ?? tied[0]
}

/**
 * Resolve winner by seeded random (auditable). Same seed always yields same winner.
 */
export function resolveChallengeBySeededRandom(input: ChallengeInput, seedOverride?: number): string | null {
  const { leagueId, configId, week, challengeType } = input
  const participantRosterIds = [...input.participantRosterIds].sort()
  if (participantRosterIds.length === 0) return null
  const seed =
    seedOverride ??
    hashSeed(`${leagueId}:${configId}:${week}:${challengeType}:${participantRosterIds.sort().join(',')}`)
  return seededPick(participantRosterIds, seed)
}

/**
 * Hybrid: theme/prompt can be AI-generated; outcome is deterministic.
 * Uses score-based resolution with provided scores, or falls back to seeded random if no scores.
 */
export async function resolveChallengeHybrid(
  input: ChallengeInput,
  scores?: Record<string, number>,
  lowestWins?: boolean
): Promise<string | null> {
  if (scores && Object.keys(scores).length > 0) {
    return resolveChallengeByScore({
      ...input,
      scores,
      lowestWins,
    })
  }
  return resolveChallengeBySeededRandom(input)
}

/**
 * Resolve HOH winner based on config challenge mode.
 * Caller provides scores when mode is score-based or hybrid; otherwise seeded random.
 */
export async function resolveHOHWinner(
  input: ChallengeInput,
  options?: { scores?: Record<string, number>; lowestWins?: boolean; seedOverride?: number }
): Promise<string | null> {
  const config = await getBigBrotherConfig(input.leagueId)
  if (!config) return null

  const mode = config.challengeMode as ChallengeMode
  if (mode === 'deterministic_score') {
    return resolveChallengeByScore({ ...input, scores: options?.scores ?? {}, lowestWins: options?.lowestWins })
  }
  if (mode === 'ai_theme') {
    return resolveChallengeBySeededRandom(input, options?.seedOverride)
  }
  return resolveChallengeHybrid(input, options?.scores, options?.lowestWins)
}

/**
 * Resolve Veto winner (same modes as HOH).
 */
export async function resolveVetoWinner(
  input: ChallengeInput,
  options?: { scores?: Record<string, number>; lowestWins?: boolean; seedOverride?: number }
): Promise<string | null> {
  return resolveHOHWinner(input, options)
}
