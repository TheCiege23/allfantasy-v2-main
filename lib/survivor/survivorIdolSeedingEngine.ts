/**
 * SURVIVOR IDOL SEEDING ENGINE — pure, deterministic. No DB, no AI, no fabrication.
 *
 * Pure seed plans. The native NBA draft uses computePlayerBoundIdolSeedPlan to assign
 * configured idols to distinct drafted players. computeIdolSeedPlan remains for older
 * league paths. A deterministic seed makes either plan reproducible for audit.
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

export interface PlayerBoundIdolCandidate {
  ownerUserId: string
  rosterId: string
  playerId: string
  playerName?: string
}

export interface PlayerBoundIdolAssignment extends IdolSeedAssignment {
  playerId: string
  playerName?: string
}

/**
 * NBA pilot inventory: choose actual drafted players. The first third of the cast
 * gets one random holder each; commissioner-added idols may land on those holders
 * again. No owner, power or player assignment is exposed to a playing commissioner.
 */
export function computePlayerBoundIdolSeedPlan(input: {
  candidates: PlayerBoundIdolCandidate[]
  idolCount: number
  powerPool?: SurvivorIdolPowerType[]
  seed: number
}): { ok: true; assignments: PlayerBoundIdolAssignment[]; seed: number } | { ok: false; code: string; error: string } {
  const { candidates, idolCount, seed } = input
  if (!Number.isInteger(idolCount) || idolCount < 1 || idolCount > candidates.length) {
    return { ok: false, code: 'invalid_count', error: 'Idol count must be positive and cannot exceed drafted player count.' }
  }
  if (new Set(candidates.map(candidate => candidate.playerId)).size !== candidates.length ||
      candidates.some(candidate => !candidate.playerId || !candidate.rosterId || !candidate.ownerUserId)) {
    return { ok: false, code: 'invalid_draft_players', error: 'Draft picks need distinct stable player IDs and roster owners before idols can be seeded.' }
  }
  const powerPool = input.powerPool?.length ? input.powerPool : ['vote_shield', 'extra_vote', 'skip_tribal'] as SurvivorIdolPowerType[]
  if (powerPool.some(power => SURVIVOR_IDOL_CATALOG[power]?.resolution !== 'phase2')) {
    return { ok: false, code: 'unavailable_power', error: 'The selected idol pool contains a power whose roster or vote effect is not implemented.' }
  }
  const rand = mulberry32(seed)
  const shuffled = <T>(values: T[]) => {
    const result = [...values]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
  const byOwner = new Map<string, PlayerBoundIdolCandidate[]>()
  for (const candidate of candidates) byOwner.set(candidate.ownerUserId, [...(byOwner.get(candidate.ownerUserId) ?? []), candidate])
  const owners = shuffled([...byOwner.keys()])
  const firstWave = owners.slice(0, Math.min(idolCount, Math.ceil(owners.length / 3)))
  const selected: PlayerBoundIdolCandidate[] = firstWave.map(owner => shuffled(byOwner.get(owner)!)[0])
  const used = new Set(selected.map(candidate => candidate.playerId))
  selected.push(...shuffled(candidates.filter(candidate => !used.has(candidate.playerId))).slice(0, idolCount - selected.length))
  const powerOrder = shuffled(Array.from({ length: idolCount }, (_, index) => powerPool[index % powerPool.length]))
  return { ok: true, seed, assignments: selected.map((candidate, index) => ({
    ...candidate,
    powerType: powerOrder[index],
    expiresAtRemainingPlayers: SURVIVOR_IDOL_CATALOG[powerOrder[index]].expiresAtRemainingPlayers,
  })) }
}
