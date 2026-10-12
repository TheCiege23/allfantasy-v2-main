/**
 * SURVIVOR IDOL SEEDING ENGINE — pure, deterministic. No DB, no AI, no fabrication.
 *
 * Phase 2 canonical idol power catalog + the seed plan. Only the Vote Shield idol is
 * auto-seeded at start, at COUNT = rosterSpots + tribeCount (e.g. 15 + 4 = 19). Idols are
 * hidden and randomly distributed across active participants; MULTIPLE idols per user are
 * allowed (the same user may receive more than one). A deterministic `seed` makes the
 * distribution reproducible for tests/audit. The engine never invents participants.
 */

export type SurvivorIdolPowerType = 'vote_shield' | 'extra_vote' | 'skip_tribal' | 'auto_waiver_pickup' | 'triple_steal' | 'island_raid'

export interface SurvivorIdolPowerSpec {
  powerType: SurvivorIdolPowerType
  label: string
  description: string
  category: 'protection' | 'voting' | 'roster'
  oneTimeUse: boolean
  /** Phase 2 resolution status — Vote Shield / Extra Vote / Council Pass vs scaffold-only. */
  resolution: 'phase2' | 'scaffold_only'
  /** Expiry boundary by remaining active players (idol invalid once this many remain - 1). */
  expiresAtRemainingPlayers: number
}

/** Canonical Phase 2 idol catalog. */
export const SURVIVOR_IDOL_CATALOG: Record<SurvivorIdolPowerType, SurvivorIdolPowerSpec> = {
  vote_shield: {
    powerType: 'vote_shield',
    label: 'Vote Shield Idol',
    description: 'When played at Elimination Council, votes cast against the holder do not count. One-time use.',
    category: 'protection',
    oneTimeUse: true,
    resolution: 'phase2',
    expiresAtRemainingPlayers: 5,
  },
  extra_vote: {
    powerType: 'extra_vote',
    label: 'Extra Vote',
    description: 'Adds one extra ballot at Elimination Council. One-time use.',
    category: 'voting',
    oneTimeUse: true,
    resolution: 'phase2',
    expiresAtRemainingPlayers: 5,
  },
  skip_tribal: {
    powerType: 'skip_tribal',
    label: 'Council Pass',
    description: 'Protects the holder from vote exposure this round (may forfeit voting right per settings). One-time use.',
    category: 'voting',
    oneTimeUse: true,
    resolution: 'phase2',
    expiresAtRemainingPlayers: 5,
  },
  auto_waiver_pickup: {
    powerType: 'auto_waiver_pickup',
    label: 'Auto Waiver Pickup',
    description: 'Guarantees a waiver claim. Inventory only in Phase 2; resolution arrives with the roster-movement engine.',
    category: 'roster',
    oneTimeUse: true,
    resolution: 'scaffold_only',
    expiresAtRemainingPlayers: 5,
  },
  triple_steal: {
    powerType: 'triple_steal',
    label: 'Triple Raid',
    description: 'Choose exactly three players from one opposing team. Unavailable until roster transfers, capacity and player locks are enforced.',
    category: 'roster',
    oneTimeUse: true,
    resolution: 'scaffold_only',
    expiresAtRemainingPlayers: 5,
  },
  island_raid: {
    powerType: 'island_raid', label: 'Island Raid',
    description: 'Choose exactly three players across opposing teams. Unavailable until roster transfers, capacity and player locks are enforced.',
    category: 'roster', oneTimeUse: true, resolution: 'scaffold_only', expiresAtRemainingPlayers: 5,
  },
}

export interface IdolSeedParticipant {
  userId: string
  rosterId: string
}

export interface IdolSeedAssignment {
  ownerUserId: string
  rosterId: string
  powerType: SurvivorIdolPowerType
  expiresAtRemainingPlayers: number
}

export type IdolSeedPlanResult =
  | { ok: true; assignments: IdolSeedAssignment[]; voteShieldCount: number; seed: number }
  | { ok: false; code: 'no_participants' | 'invalid_count'; error: string }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ComputeIdolSeedInput {
  participants: IdolSeedParticipant[]
  /** Number of roster spots in the league (e.g. 15). */
  rosterSpots: number
  tribeCount: number
  seed?: number | null
}

/**
 * Vote Shield seed plan. Count = rosterSpots + tribeCount. Idols are distributed by a
 * deterministic shuffle-with-replacement so multiple idols can land on the same user while
 * staying balanced overall. Returns a hidden assignment plan; persistence is the service's job.
 */
export function computeIdolSeedPlan(input: ComputeIdolSeedInput): IdolSeedPlanResult {
  const participants = input.participants.filter((p, i, arr) => p.userId && arr.findIndex((q) => q.userId === p.userId) === i)
  if (participants.length === 0) return { ok: false, code: 'no_participants', error: 'No active participants to seed idols to.' }

  const rosterSpots = Math.floor(input.rosterSpots)
  const tribeCount = Math.floor(input.tribeCount)
  if (!Number.isFinite(rosterSpots) || rosterSpots < 1 || !Number.isFinite(tribeCount) || tribeCount < 1) {
    return { ok: false, code: 'invalid_count', error: 'rosterSpots and tribeCount must be positive integers.' }
  }
  const voteShieldCount = rosterSpots + tribeCount
  const seed = Number.isFinite(input.seed as number) ? (input.seed as number) : Math.floor(Math.random() * 2_147_483_647)
  const rand = mulberry32(seed)
  const spec = SURVIVOR_IDOL_CATALOG.vote_shield

  // Balanced random distribution: shuffle a repeated participant pool, take the first N.
  // This keeps per-user counts within one while still allowing multiples.
  const pool: IdolSeedParticipant[] = []
  while (pool.length < voteShieldCount) {
    const round = [...participants]
    for (let i = round.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[round[i], round[j]] = [round[j], round[i]]
    }
    for (const p of round) {
      if (pool.length >= voteShieldCount) break
      pool.push(p)
    }
  }

  const assignments: IdolSeedAssignment[] = pool.map((p) => ({
    ownerUserId: p.userId,
    rosterId: p.rosterId,
    powerType: 'vote_shield',
    expiresAtRemainingPlayers: spec.expiresAtRemainingPlayers,
  }))

  return { ok: true, assignments, voteShieldCount, seed }
}
