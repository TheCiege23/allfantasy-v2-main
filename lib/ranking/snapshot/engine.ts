/**
 * Phase 2C — Ranking Snapshot Engine
 *
 * Pure composition. Given imported-history per source + per-league
 * difficulty ratings, produces a `RankingSnapshot` (shape in `lib/ranking/types`).
 *
 * Hard rules:
 *   - No I/O. Persisting snapshots arrives in Batch 2.
 *   - No magic numbers — all constants in `./weights.ts`.
 *   - Safe with empty / missing inputs.
 *   - Output rating fields are always finite and clamped.
 */

import type {
  AFUserRating,
  ImportedHistoryScore,
  LeagueDifficultyRating,
  RankingSnapshot,
  RankingSource,
  RankingSport,
  SportRating,
} from "@/lib/ranking/types"
import {
  BASE_RATING,
  COMPONENT_CAPS,
  COMPONENT_CONTRIB,
  RATING_RANGE,
  SOURCE_WEIGHT,
  SPORT_BLEND_WEIGHT,
} from "@/lib/ranking/snapshot/weights"

type SnapshotInput = {
  userId: string
  /** History grouped by source (Sleeper, Yahoo, …). Empty allowed. */
  importedHistory: ImportedHistoryScore[]
  /**
   * Per-league difficulty ratings the user participated in. Empty allowed.
   * Used to derive the difficulty-component bump.
   */
  leagueDifficulties: LeagueDifficultyRating[]
  /**
   * Optional sport bucketing: which sports the user actively played and
   * the per-sport rollups. When empty, engine returns a single neutral
   * `SportRating` for NFL.
   */
  sportHistory?: Array<{
    sport: RankingSport
    wins: number
    losses: number
    ties: number
    championships: number
    playoffAppearances: number
    seasons: number
  }>
  capturedAt?: string
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function winRateBump(wins: number, losses: number, ties: number): number {
  const total = wins + losses + ties
  if (total <= 0) return 0
  const wr = (wins + ties * 0.5) / total
  const pctAbove500 = (wr - 0.5) * 100
  const raw = pctAbove500 * COMPONENT_CONTRIB.winRatePer1Pct
  return clamp(raw, -COMPONENT_CAPS.winRate, COMPONENT_CAPS.winRate)
}

function championshipsBump(count: number): number {
  return clamp(count * COMPONENT_CONTRIB.perChampionship, 0, COMPONENT_CAPS.championships)
}

function playoffBump(count: number): number {
  return clamp(count * COMPONENT_CONTRIB.perPlayoffAppearance, 0, COMPONENT_CAPS.playoffAppearances)
}

function seasonsBump(count: number): number {
  return clamp(count * COMPONENT_CONTRIB.perSeason, 0, COMPONENT_CAPS.seasons)
}

function difficultyBump(leagueDifficulties: LeagueDifficultyRating[]): number {
  if (leagueDifficulties.length === 0) return 0
  const avg =
    leagueDifficulties.reduce((sum, d) => sum + (Number.isFinite(d.effective) ? d.effective : 0), 0) /
    leagueDifficulties.length
  const above5k = (avg - 5000) / 1000
  return clamp(above5k * COMPONENT_CONTRIB.perDifficultyAbove5kK, -COMPONENT_CAPS.difficulty, COMPONENT_CAPS.difficulty)
}

function buildSportRating(
  sport: RankingSport,
  bucket: {
    wins: number
    losses: number
    ties: number
    championships: number
    playoffAppearances: number
    seasons: number
  },
  difficultyAverageBump: number
): SportRating {
  const winRate = winRateBump(bucket.wins, bucket.losses, bucket.ties)
  const champs = championshipsBump(bucket.championships)
  const playoffs = playoffBump(bucket.playoffAppearances)
  const seasonsC = seasonsBump(bucket.seasons)
  const raw = BASE_RATING + winRate + champs + playoffs + seasonsC + difficultyAverageBump
  const rating = clamp(raw, RATING_RANGE.min, RATING_RANGE.max)
  return {
    sport,
    rating: Math.round(rating),
    components: {
      winRate: Math.round(winRate),
      championships: Math.round(champs),
      playoffAppearances: Math.round(playoffs),
      activityScore: Math.round(seasonsC),
      leagueDifficulty: Math.round(difficultyAverageBump),
    },
  }
}

function uniqSources(history: ImportedHistoryScore[]): RankingSource[] {
  const set = new Set<RankingSource>()
  for (const h of history) set.add(h.source)
  return Array.from(set)
}

function overallFromSports(sports: SportRating[]): number {
  if (sports.length === 0) return BASE_RATING
  let weightSum = 0
  let weighted = 0
  for (const sr of sports) {
    const w = SPORT_BLEND_WEIGHT[sr.sport] ?? 1
    const sourceBoost = 1 // reserved for future multi-source confidence
    const eff = w * sourceBoost
    weighted += sr.rating * eff
    weightSum += eff
  }
  if (weightSum <= 0) return BASE_RATING
  return clamp(weighted / weightSum, RATING_RANGE.min, RATING_RANGE.max)
}

/**
 * Roll a single imported-history bucket into a synthetic sport bucket so
 * callers without sport-typed history still get a usable `SportRating`.
 */
function defaultSportBucketFromHistory(
  history: ImportedHistoryScore[]
): { wins: number; losses: number; ties: number; championships: number; playoffAppearances: number; seasons: number } {
  const acc = { wins: 0, losses: 0, ties: 0, championships: 0, playoffAppearances: 0, seasons: 0 }
  for (const h of history) {
    const w = SOURCE_WEIGHT[h.source] ?? 1
    acc.wins += (h.wins ?? 0) * w
    acc.losses += (h.losses ?? 0) * w
    acc.ties += (h.ties ?? 0) * w
    acc.championships += (h.championships ?? 0) * w
    acc.playoffAppearances += (h.playoffAppearances ?? 0) * w
    acc.seasons = Math.max(acc.seasons, h.seasons ?? 0)
  }
  return acc
}

export function composeRankingSnapshot(input: SnapshotInput): RankingSnapshot {
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  const difficultyAverageBump = difficultyBump(input.leagueDifficulties)

  const sportRatings: SportRating[] = []
  if (input.sportHistory && input.sportHistory.length > 0) {
    for (const bucket of input.sportHistory) {
      sportRatings.push(buildSportRating(bucket.sport, bucket, difficultyAverageBump))
    }
  } else {
    const bucket = defaultSportBucketFromHistory(input.importedHistory)
    sportRatings.push(buildSportRating("NFL", bucket, difficultyAverageBump))
  }

  const overall = Math.round(overallFromSports(sportRatings))

  const rating: AFUserRating = {
    userId: input.userId,
    overall,
    sports: sportRatings,
    importedHistory: input.importedHistory,
    capturedAt,
  }

  return {
    userId: input.userId,
    capturedAt,
    rating,
    leagueDifficulties: input.leagueDifficulties,
    sources: uniqSources(input.importedHistory),
  }
}

export function neutralRankingSnapshot(userId: string): RankingSnapshot {
  const capturedAt = new Date().toISOString()
  return {
    userId,
    capturedAt,
    rating: {
      userId,
      overall: BASE_RATING,
      sports: [
        {
          sport: "NFL",
          rating: BASE_RATING,
          components: {
            winRate: 0,
            championships: 0,
            playoffAppearances: 0,
            activityScore: 0,
            leagueDifficulty: 0,
          },
        },
      ],
      importedHistory: [],
      capturedAt,
    },
    leagueDifficulties: [],
    sources: [],
  }
}
