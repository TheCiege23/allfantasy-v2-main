/**
 * Phase 2C Batch 4 Sub-batch C — Roster intelligence helpers.
 *
 * Pure (no DB / no I/O) helpers that turn a roster lineup + per-player
 * projection into:
 *   - positional totals + depth counts
 *   - weakness / strength signal tags
 *   - a (still-`unknown`) team identity hint
 *
 * Rules:
 *   - Never throws.
 *   - Every threshold lives in `WEAKNESS_TUNABLES` so tuning is one edit.
 *   - Team identity formula NOT finalized — always returns `"unknown"`.
 *   - Floor / ceiling / volatility are read-only inputs; we surface signals
 *     when provided but never invent them here.
 */

import {
  positionProjectionFallback,
  resolveProjectedPoints,
} from "@/lib/chimmy-context/intel/projection"

type TeamIdentityHint =
  | "contender"
  | "rebuild"
  | "boom_bust"
  | "depth_heavy"
  | "injury_prone"
  | "youth_focused"
  | "unknown"

export type RosterIntelPlayer = {
  playerId: string
  position: string | null
  isStarter: boolean
  /** Pre-resolved projection; if null we fall back to positional baseline. */
  projection?: number | null
  /** Optional injury flag string (e.g. "Q", "D", "OUT"). */
  injuryStatus?: string | null
  /** Optional bye week number. */
  byeWeek?: number | null
}

type RosterIntelInput = {
  players: RosterIntelPlayer[]
  /** Currently active fantasy week, used for bye-conflict detection. */
  currentWeek?: number | null
  /**
   * Optional roster volatility (std dev across recent weeks). When provided,
   * `volatility_high` signals fire above the tunable threshold.
   */
  rosterVolatility?: number | null
}

type RosterIntelOutput = {
  starterProjectedTotal: number
  /** Per-position starter projected totals (rounded to 2 decimals). */
  byPosition: Record<string, number>
  /** Per-position depth counts (starters + bench). */
  depthByPosition: Record<string, { starters: number; bench: number }>
  /** Tags like `shallow_depth:RB`, `weak_position:WR`, `bye_conflict:RB`. */
  weaknessSignals: string[]
  /** Tags like `deep_position:RB`, `elite_position:QB`. */
  strengthSignals: string[]
  /**
   * Probabilistic team identity scores (each 0-100, NOT normalized).
   * Tuned via `IDENTITY_TUNABLES`.
   */
  teamIdentityScores: Record<TeamIdentityHint, number>
  /**
   * Highest-scoring identity hint above `minConfidence`, else `"unknown"`.
   * Formula NOT finalized — weights live in `IDENTITY_TUNABLES`.
   */
  teamIdentityHint: TeamIdentityHint
  /** Human-readable rationale lines (debug only). */
  notes: string[]
  inputs: { currentWeek: number | null; rosterVolatility: number | null }
}

/**
 * All thresholds live here so future tuning is one edit. Values are
 * intentionally conservative scaffolds — NOT final.
 */
const WEAKNESS_TUNABLES = {
  /** Minimum bench depth per position before we flag `shallow_depth`. */
  minBenchByPosition: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    K: 0,
    DST: 0,
    DEF: 0,
  } as Record<string, number>,
  /** Default min bench for any position not in `minBenchByPosition`. */
  defaultMinBench: 1,
  /** Bench count at which a position is considered "deep". */
  deepBenchByPosition: {
    QB: 2,
    RB: 4,
    WR: 4,
    TE: 2,
    K: 1,
    DST: 1,
    DEF: 1,
  } as Record<string, number>,
  defaultDeepBench: 3,
  /** Projection multiple of the positional fallback to count as "elite". */
  elitePositionMultiplier: 1.4,
  /** Projection multiple of the positional fallback to count as "weak". */
  weakPositionMultiplier: 0.85,
  /** A single position owning >this share of total projection → imbalance. */
  projectionImbalanceMaxShare: 0.45,
  /** Roster volatility threshold (std dev) → `volatility_high`. */
  volatilityHighThreshold: 25,
  /** Injury flag count threshold → `injury_exposure`. */
  injuryExposureMinCount: 2,
} as const

/**
 * First real (still-tunable) team-identity weights. Each entry maps a
 * signal/feature to points contributed to that identity. The final hint is
 * the identity with the highest score above `minConfidence`.
 */
const IDENTITY_TUNABLES = {
  minConfidence: 30,
  /** Starter projected total threshold for the contender bonus. */
  contenderProjectionThreshold: 110,
  weights: {
    contender: {
      perEliteSignal: 18,
      perDeepSignal: 8,
      projectionThresholdBonus: 20,
    },
    rebuild: {
      perWeakSignal: 18,
      perShallowSignal: 8,
    },
    boom_bust: {
      imbalance: 25,
      volatility: 25,
    },
    depth_heavy: {
      perDeepSignal: 15,
    },
    injury_prone: {
      injuryFlag: 40,
    },
    youth_focused: {
      // Reserved — needs avg draft year input (future sub-batch).
    },
  } as const,
} as const

const INJURY_FLAG_RE = /^(Q|D|O|OUT|IR|DOUBTFUL|QUESTIONABLE|SUSPENDED)/i

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function pos(p: string | null | undefined): string {
  return (p ?? "UNK").toUpperCase()
}

function resolveStarterProjection(player: RosterIntelPlayer): number {
  if (player.projection != null && Number.isFinite(player.projection)) {
    return player.projection
  }
  // No projection: fall back to positional neutral via resolveProjectedPoints
  // (0 actual + no statLine → positional fallback).
  return resolveProjectedPoints(0, null, player.position ?? null)
}

export function computeRosterIntel(input: RosterIntelInput): RosterIntelOutput {
  const players = Array.isArray(input.players) ? input.players : []
  const byPosition: Record<string, number> = {}
  const depthByPosition: Record<string, { starters: number; bench: number }> = {}
  let starterProjectedTotal = 0
  const byeBuckets: Record<string, number> = {}
  let injuryFlagCount = 0

  for (const player of players) {
    if (!player) continue
    const key = pos(player.position)
    if (!depthByPosition[key]) depthByPosition[key] = { starters: 0, bench: 0 }
    if (player.isStarter) {
      depthByPosition[key].starters += 1
      const projection = resolveStarterProjection(player)
      const safe = Number.isFinite(projection) ? projection : 0
      starterProjectedTotal += safe
      byPosition[key] = round2((byPosition[key] ?? 0) + safe)
      if (
        player.byeWeek != null &&
        input.currentWeek != null &&
        player.byeWeek === input.currentWeek
      ) {
        const bk = `${key}@${player.byeWeek}`
        byeBuckets[bk] = (byeBuckets[bk] ?? 0) + 1
      }
    } else {
      depthByPosition[key].bench += 1
    }
    if (player.injuryStatus && INJURY_FLAG_RE.test(player.injuryStatus)) {
      injuryFlagCount += 1
    }
  }

  starterProjectedTotal = round2(starterProjectedTotal)

  const weaknessSignals: string[] = []
  const strengthSignals: string[] = []
  const notes: string[] = []

  // Depth signals.
  for (const [position, depth] of Object.entries(depthByPosition)) {
    if (depth.starters === 0) continue
    const minBench =
      WEAKNESS_TUNABLES.minBenchByPosition[position] ??
      WEAKNESS_TUNABLES.defaultMinBench
    const deepBench =
      WEAKNESS_TUNABLES.deepBenchByPosition[position] ??
      WEAKNESS_TUNABLES.defaultDeepBench
    if (depth.bench < minBench) {
      weaknessSignals.push(`shallow_depth:${position}`)
      notes.push(`${position} bench=${depth.bench} < min ${minBench}`)
    } else if (depth.bench >= deepBench) {
      strengthSignals.push(`deep_position:${position}`)
    }
  }

  // Positional projection strength / weakness.
  for (const [position, totalProj] of Object.entries(byPosition)) {
    const starters = depthByPosition[position]?.starters ?? 0
    if (starters === 0) continue
    const baseline = positionProjectionFallback(position) * starters
    if (baseline <= 0) continue
    const ratio = totalProj / baseline
    if (ratio <= WEAKNESS_TUNABLES.weakPositionMultiplier) {
      weaknessSignals.push(`weak_position:${position}`)
      notes.push(
        `${position} proj=${totalProj} vs baseline=${round2(baseline)} (ratio=${round2(
          ratio
        )})`
      )
    } else if (ratio >= WEAKNESS_TUNABLES.elitePositionMultiplier) {
      strengthSignals.push(`elite_position:${position}`)
    }
  }

  // Bye conflicts.
  for (const [bucket, count] of Object.entries(byeBuckets)) {
    if (count >= 2) {
      const [position] = bucket.split("@")
      weaknessSignals.push(`bye_conflict:${position}`)
    }
  }

  // Injury exposure.
  if (injuryFlagCount >= WEAKNESS_TUNABLES.injuryExposureMinCount) {
    weaknessSignals.push("injury_exposure")
    notes.push(`injuryFlagCount=${injuryFlagCount}`)
  }

  // Projection imbalance.
  if (starterProjectedTotal > 0) {
    let maxShare = 0
    let maxPos: string | null = null
    for (const [position, total] of Object.entries(byPosition)) {
      const share = total / starterProjectedTotal
      if (share > maxShare) {
        maxShare = share
        maxPos = position
      }
    }
    if (maxPos && maxShare > WEAKNESS_TUNABLES.projectionImbalanceMaxShare) {
      weaknessSignals.push(`projection_imbalance:${maxPos}`)
    }
  }

  // Volatility (only fires when caller supplies a value).
  if (
    input.rosterVolatility != null &&
    Number.isFinite(input.rosterVolatility) &&
    input.rosterVolatility >= WEAKNESS_TUNABLES.volatilityHighThreshold
  ) {
    weaknessSignals.push("volatility_high")
  }

  // ---- Team identity scoring (first real pass) -----------------------------
  const eliteCount = strengthSignals.filter((s) =>
    s.startsWith("elite_position:")
  ).length
  const deepCount = strengthSignals.filter((s) =>
    s.startsWith("deep_position:")
  ).length
  const weakCount = weaknessSignals.filter((s) =>
    s.startsWith("weak_position:")
  ).length
  const shallowCount = weaknessSignals.filter((s) =>
    s.startsWith("shallow_depth:")
  ).length
  const hasInjury = weaknessSignals.includes("injury_exposure")
  const hasImbalance = weaknessSignals.some((s) =>
    s.startsWith("projection_imbalance:")
  )
  const hasVolatility = weaknessSignals.includes("volatility_high")
  const W = IDENTITY_TUNABLES.weights
  const teamIdentityScores: Record<TeamIdentityHint, number> = {
    contender:
      eliteCount * W.contender.perEliteSignal +
      deepCount * W.contender.perDeepSignal +
      (starterProjectedTotal >= IDENTITY_TUNABLES.contenderProjectionThreshold
        ? W.contender.projectionThresholdBonus
        : 0),
    rebuild:
      weakCount * W.rebuild.perWeakSignal +
      shallowCount * W.rebuild.perShallowSignal,
    boom_bust:
      (hasImbalance ? W.boom_bust.imbalance : 0) +
      (hasVolatility ? W.boom_bust.volatility : 0),
    depth_heavy: deepCount * W.depth_heavy.perDeepSignal,
    injury_prone: hasInjury ? W.injury_prone.injuryFlag : 0,
    youth_focused: 0,
    unknown: 0,
  }
  let teamIdentityHint: TeamIdentityHint = "unknown"
  let bestScore = IDENTITY_TUNABLES.minConfidence - 1
  for (const [hint, score] of Object.entries(teamIdentityScores) as Array<
    [TeamIdentityHint, number]
  >) {
    if (hint === "unknown") continue
    if (score > bestScore) {
      bestScore = score
      teamIdentityHint = hint
    }
  }

  return {
    starterProjectedTotal,
    byPosition,
    depthByPosition,
    weaknessSignals,
    strengthSignals,
    teamIdentityScores,
    teamIdentityHint,
    notes,
    inputs: {
      currentWeek: input.currentWeek ?? null,
      rosterVolatility: input.rosterVolatility ?? null,
    },
  }
}
