/**
 * SURVIVOR TRIBE ASSIGNMENT ENGINE — pure, deterministic. No DB, no AI, no fabrication.
 *
 * Computes a balanced tribe assignment from the ACTIVE participant list under one of three
 * modes (random / commissioner_manual / draft_pattern). It never invents participants and
 * never assigns eliminated/exiled/jury or non-participating users (the caller filters those).
 * A deterministic `seed` makes random assignment reproducible for tests/audit.
 */

import { SURVIVOR_TRIBE_CATALOG } from './survivorTribeIdentity'
import { balancedSizes, experienceSplitOrder } from './survivorExperience'

export type TribeAssignmentMode = 'random' | 'commissioner_manual' | 'draft_pattern'

export interface AssignmentParticipant {
  userId: string
  rosterId: string
  displayName: string
}

export interface AssignmentTribe {
  slotIndex: number
  memberUserIds: string[]
}

export type TribeAssignmentResult =
  | { ok: true; mode: TribeAssignmentMode; tribes: AssignmentTribe[]; seed: number | null }
  | { ok: false; code: 'no_participants' | 'invalid_tribe_count' | 'manual_invalid' | 'limited_data'; error: string }

export interface ComputeTribeAssignmentInput {
  participants: AssignmentParticipant[]
  tribeCount: number
  mode: TribeAssignmentMode
  capacities?: number[] | null
  /** Deterministic seed for random mode (audit/repro). */
  seed?: number | null
  /** Manual mode: userId -> tribe slotIndex (0-based). */
  manualMapping?: Record<string, number> | null
  /** Draft-pattern mode: ordered userIds (draft order). Missing → limited-data. */
  draftOrder?: string[] | null
  /**
   * Random mode, Rooks vs Vets: userId -> rookie/veteran. Rookies fill the first tribes and veterans
   * the last, in blocks, so with two tribes it is rookies against veterans; uneven counts share the
   * boundary tribe. Omitted: the ordinary balanced random draw.
   */
  experience?: Record<string, 'rookie' | 'veteran'> | null
}

/** Deterministic PRNG (mulberry32) so seeded random assignment is reproducible. */
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

function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function emptyTribes(tribeCount: number): AssignmentTribe[] {
  return Array.from({ length: tribeCount }, (_, slotIndex) => ({ slotIndex, memberUserIds: [] }))
}

/** Round-robin distribute (over the given order) so tribe sizes differ by at most one. */
function distributeBalanced(orderedUserIds: string[], tribeCount: number, capacities?: number[] | null): AssignmentTribe[] {
  const tribes = emptyTribes(tribeCount)
  let next = 0
  for (const userId of orderedUserIds) {
    while (capacities && tribes[next % tribeCount].memberUserIds.length >= capacities[next % tribeCount]) next++
    tribes[next % tribeCount].memberUserIds.push(userId)
    next++
  }
  return tribes
}

/** Fill each tribe to its size in turn, so neighbours in the order share a tribe. */
function distributeInBlocks(orderedUserIds: string[], sizes: number[]): AssignmentTribe[] {
  const tribes = emptyTribes(sizes.length)
  let slot = 0
  for (const userId of orderedUserIds) {
    while (slot < sizes.length - 1 && tribes[slot].memberUserIds.length >= sizes[slot]) slot++
    tribes[slot].memberUserIds.push(userId)
  }
  return tribes
}

export function computeTribeAssignment(input: ComputeTribeAssignmentInput): TribeAssignmentResult {
  const tribeCount = Math.floor(input.tribeCount)
  if (!Number.isFinite(tribeCount) || tribeCount < 2) {
    return { ok: false, code: 'invalid_tribe_count', error: 'Tribe count must be at least 2.' }
  }
  // De-dup participants by userId (defensive).
  const seen = new Set<string>()
  const participants = input.participants.filter((p) => {
    if (!p.userId || seen.has(p.userId)) return false
    seen.add(p.userId)
    return true
  })
  if (participants.length === 0) {
    return { ok: false, code: 'no_participants', error: 'No active participants to assign.' }
  }
  if (participants.length < tribeCount) {
    return { ok: false, code: 'invalid_tribe_count', error: `Only ${participants.length} participants for ${tribeCount} tribes.` }
  }

  const capacities = input.capacities
  if (capacities && (capacities.length !== tribeCount || capacities.some(n => !Number.isInteger(n) || n < 1) || capacities.reduce((a, b) => a + b, 0) !== participants.length)) {
    return { ok: false, code: 'manual_invalid', error: 'Tribe capacities must be positive whole numbers totaling the active manager count.' }
  }
  const userIds = participants.map((p) => p.userId)

  if (input.mode === 'commissioner_manual') {
    const mapping = input.manualMapping ?? {}
    const assignedUsers = Object.keys(mapping)
    const participantSet = new Set(userIds)
    const missing = userIds.filter((u) => !(u in mapping))
    const unknown = assignedUsers.filter((u) => !participantSet.has(u))
    if (missing.length > 0) return { ok: false, code: 'manual_invalid', error: `Unassigned participants: ${missing.length}.` }
    if (unknown.length > 0) return { ok: false, code: 'manual_invalid', error: `Mapping has ${unknown.length} unknown/non-participant user(s).` }
    const tribes = emptyTribes(tribeCount)
    for (const userId of userIds) {
      const slot = mapping[userId]
      if (!Number.isInteger(slot) || slot < 0 || slot >= tribeCount) {
        return { ok: false, code: 'manual_invalid', error: `Invalid tribe index for a participant (must be 0..${tribeCount - 1}).` }
      }
      tribes[slot].memberUserIds.push(userId)
    }
    // Balance check: sizes within one of each other.
    const sizes = tribes.map((t) => t.memberUserIds.length)
    if (capacities ? sizes.some((size, i) => size !== capacities[i]) : Math.max(...sizes) - Math.min(...sizes) > 1) {
      return { ok: false, code: 'manual_invalid', error: 'Manual tribes must match the configured capacities (or be balanced when none are configured).' }
    }
    return { ok: true, mode: 'commissioner_manual', tribes, seed: null }
  }

  if (input.mode === 'draft_pattern') {
    const order = [...new Set(input.draftOrder?.filter((u) => seen.has(u)) ?? [])]
    // Need complete draft coverage of every participant, else this is limited-data (no fake).
    if (order.length === 0 || new Set(order).size < participants.length) {
      return { ok: false, code: 'limited_data', error: 'Draft order/picks unavailable for every participant — cannot build a draft-pattern assignment.' }
    }
    return { ok: true, mode: 'draft_pattern', tribes: distributeBalanced(order, tribeCount, capacities), seed: null }
  }

  // random (default)
  const seed = Number.isFinite(input.seed as number) ? (input.seed as number) : Math.floor(Math.random() * 2_147_483_647)
  const shuffled = deterministicShuffle(userIds, seed)
  if (input.experience) {
    const order = experienceSplitOrder(shuffled, input.experience)
    return { ok: true, mode: 'random', tribes: distributeInBlocks(order, capacities ?? balancedSizes(order.length, tribeCount)), seed }
  }
  return { ok: true, mode: 'random', tribes: distributeBalanced(shuffled, tribeCount, capacities), seed }
}

/** Default unique tribe names (themed) — caller may override per slot. */
const DEFAULT_TRIBE_NAMES = SURVIVOR_TRIBE_CATALOG.map(tribe => tribe.name)
const DEFAULT_TRIBE_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ec4899', '#14b8a6', '#f97316']

export function defaultTribeName(slotIndex: number): string {
  return DEFAULT_TRIBE_NAMES[slotIndex] ?? `Tribe ${slotIndex + 1}`
}
export function defaultTribeColor(slotIndex: number): string {
  return DEFAULT_TRIBE_COLORS[slotIndex % DEFAULT_TRIBE_COLORS.length]
}
