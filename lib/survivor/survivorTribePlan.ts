/**
 * The commissioner's PRE-DRAFT tribe plan (native league handoff §5.4, TribeSetup.png): who goes in
 * which tribe, by Random (seeded, re-rollable), Balanced by AF (snake by AF strength) or Manual
 * (move a manager), plus three announce toggles. Pure — no database, no provider, no React.
 *
 * Locking the plan writes it through the EXISTING assignment path (`assignSurvivorTribes` in
 * commissioner_manual mode with this mapping), so the post-draft bootstrap finds tribes already
 * assigned and keeps them (its `alreadyAssigned` branch). Nothing here changes how tribes are stored.
 */

import { computeTribeAssignment } from './survivorTribeAssignmentEngine'

export type TribePlanMode = 'random' | 'balanced' | 'manual'

export type SurvivorTribePlan = {
  mode: TribePlanMode
  /** Random mode's seed; re-rolling picks a new one. */
  seed: number
  /** userId -> tribe slot index (0-based). */
  mapping: Record<string, number>
  showOnBoard: boolean
  tribeChatDuringDraft: boolean
  announceInChat: boolean
}

export type PlanParticipant = { userId: string; displayName: string; /** 0–100, null = no AF data. */ strength: number | null }

/**
 * Tribes are equal shares of the cast (owner's call, 2026-10-20: 12–24 managers in 2, 3 or 4
 * tribes). The capacities already carry that split; the floor only stops a degenerate plan.
 */
export const TRIBE_MIN_MANAGERS = 3
export const TRIBE_MAX_MANAGERS = 12

export const DEFAULT_TRIBE_PLAN: Omit<SurvivorTribePlan, 'seed' | 'mapping'> = {
  mode: 'random',
  showOnBoard: true,
  tribeChatDuringDraft: true,
  announceInChat: true,
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

/** Read a stored plan defensively; anything malformed falls back to defaults. */
export function normalizeTribePlan(raw: unknown): SurvivorTribePlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const mode: TribePlanMode = r.mode === 'balanced' || r.mode === 'manual' ? r.mode : 'random'
  const seed = typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.floor(Math.abs(r.seed)) % 2_147_483_647 : 1
  const mapping: Record<string, number> = {}
  if (r.mapping && typeof r.mapping === 'object' && !Array.isArray(r.mapping)) {
    for (const [k, v] of Object.entries(r.mapping as Record<string, unknown>)) {
      if (typeof k === 'string' && k && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 8) mapping[k] = v as number
    }
  }
  return {
    mode,
    seed,
    mapping,
    showOnBoard: bool(r.showOnBoard, DEFAULT_TRIBE_PLAN.showOnBoard),
    tribeChatDuringDraft: bool(r.tribeChatDuringDraft, DEFAULT_TRIBE_PLAN.tribeChatDuringDraft),
    announceInChat: bool(r.announceInChat, DEFAULT_TRIBE_PLAN.announceInChat),
  }
}

export type StoredTribePlan = SurvivorTribePlan & { lockedAt?: string | null; lockedBy?: string | null }

/** The plan saved in league settings (`survivorTribePlan`), with its lock stamp when locked. */
export function readStoredTribePlan(settings: unknown): StoredTribePlan | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const raw = s.survivorTribePlan
  const plan = normalizeTribePlan(raw)
  if (!plan) return null
  const r = raw as Record<string, unknown>
  return { ...plan, lockedAt: typeof r.lockedAt === 'string' ? r.lockedAt : null, lockedBy: typeof r.lockedBy === 'string' ? r.lockedBy : null }
}

/** The mapping `initializeSurvivorPhase2` assigns from after the draft, or null when no plan is locked. */
export function readLockedTribePlanMapping(settings: unknown): Record<string, number> | null {
  const plan = readStoredTribePlan(settings)
  return plan?.lockedAt && Object.keys(plan.mapping).length > 0 ? plan.mapping : null
}

function toMapping(tribes: Array<{ slotIndex: number; memberUserIds: string[] }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of tribes) for (const u of t.memberUserIds) out[u] = t.slotIndex
  return out
}

/** Random, seeded — the engine's own shuffle, so a re-roll and the audit row agree. */
export function planRandom(participants: readonly PlanParticipant[], capacities: readonly number[], seed: number): Record<string, number> | null {
  const sorted = [...participants].sort((a, b) => a.userId.localeCompare(b.userId))
  const result = computeTribeAssignment({
    participants: sorted.map(p => ({ userId: p.userId, rosterId: p.userId, displayName: p.displayName })),
    tribeCount: capacities.length,
    capacities: [...capacities],
    mode: 'random',
    seed,
  })
  return result.ok ? toMapping(result.tribes) : null
}

/**
 * Balanced by AF: strongest first, snaked across tribes (1→N, N→1, …) and skipping a tribe that is
 * full. Managers with no AF data go last, alphabetically, so the order is stable.
 */
export function planBalanced(participants: readonly PlanParticipant[], capacities: readonly number[]): Record<string, number> | null {
  const n = capacities.length
  if (n < 2 || capacities.reduce((a, b) => a + b, 0) !== participants.length) return null
  const order = [...participants].sort((a, b) => {
    if (a.strength == null && b.strength == null) return a.displayName.localeCompare(b.displayName)
    if (a.strength == null) return 1
    if (b.strength == null) return -1
    return b.strength - a.strength || a.displayName.localeCompare(b.displayName)
  })
  const sizes = new Array<number>(n).fill(0)
  const mapping: Record<string, number> = {}
  let round = 0
  let i = 0
  for (const p of order) {
    // Next slot in snake order with room left.
    for (let guard = 0; guard < n * 2; guard++) {
      const slot = round % 2 === 0 ? i : n - 1 - i
      i += 1
      if (i === n) { i = 0; round += 1 }
      if (sizes[slot] < capacities[slot]) {
        mapping[p.userId] = slot
        sizes[slot] += 1
        break
      }
    }
  }
  return Object.keys(mapping).length === participants.length ? mapping : null
}

export type TribeStrength = { slot: number; size: number; average: number | null }

export function tribeStrengths(mapping: Readonly<Record<string, number>>, participants: readonly PlanParticipant[], tribeCount: number): { tribes: TribeStrength[]; spread: number | null } {
  const tribes: TribeStrength[] = Array.from({ length: tribeCount }, (_, slot) => {
    const members = participants.filter(p => mapping[p.userId] === slot)
    const scored = members.map(p => p.strength).filter((s): s is number => s != null)
    return { slot, size: members.length, average: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null }
  })
  const avgs = tribes.map(t => t.average).filter((a): a is number => a != null)
  return { tribes, spread: avgs.length === tribeCount && avgs.length > 0 ? Math.max(...avgs) - Math.min(...avgs) : null }
}

/** Null when the plan can be locked; otherwise the first reason it cannot. */
export function validateTribePlan(mapping: Readonly<Record<string, number>>, participants: readonly PlanParticipant[], capacities: readonly number[]): string | null {
  const tribeCount = capacities.length
  if (participants.length === 0) return 'No managers have joined yet.'
  const missing = participants.filter(p => { const slot = mapping[p.userId]; return !Number.isInteger(slot) || slot! < 0 || slot! >= tribeCount })
  if (missing.length) return `${missing.length} manager${missing.length === 1 ? '' : 's'} not in a tribe yet.`
  const known = new Set(participants.map(p => p.userId))
  if (Object.keys(mapping).some(u => !known.has(u))) return 'The plan names a manager who is no longer in the league.'
  const sizes = new Array<number>(tribeCount).fill(0)
  for (const p of participants) sizes[mapping[p.userId]!]! += 1
  for (let s = 0; s < tribeCount; s++) {
    if (sizes[s]! < TRIBE_MIN_MANAGERS || sizes[s]! > TRIBE_MAX_MANAGERS) return `Every tribe needs ${TRIBE_MIN_MANAGERS}–${TRIBE_MAX_MANAGERS} managers (tribe ${s + 1} has ${sizes[s]}). Tribes are equal shares of the cast.`
    if (sizes[s] !== capacities[s]) return `Tribe ${s + 1} has ${sizes[s]} managers but its capacity is ${capacities[s]}. Move a manager or change the capacities.`
  }
  return null
}

/**
 * AF strength from DB-first ADP: each rostered player is worth max(0, 250 − ADP), summed per manager,
 * scaled so the strongest roster reads 100. A manager with no rostered player with ADP gets null —
 * never a guess. (Pre-draft redraft rosters are empty, so Balanced by AF waits for real rosters.)
 */
export function strengthsFromAdp(adpsByUser: ReadonlyMap<string, readonly number[]>): Map<string, number | null> {
  const raw = new Map<string, number | null>()
  for (const [userId, adps] of adpsByUser) {
    const vals = adps.filter(a => Number.isFinite(a) && a > 0)
    raw.set(userId, vals.length ? vals.reduce((sum, a) => sum + Math.max(0, 250 - a), 0) : null)
  }
  const max = Math.max(0, ...[...raw.values()].filter((v): v is number => v != null))
  const out = new Map<string, number | null>()
  for (const [userId, v] of raw) out.set(userId, v == null || max <= 0 ? null : Math.round((v / max) * 100))
  return out
}

/** The league-chat announcement when tribes lock. Plain text; names come from the plan. */
export function tribeAnnouncementText(tribes: ReadonlyArray<{ name: string; members: readonly string[] }>): string {
  const lines = tribes.map(t => `${t.name}: ${t.members.join(', ')}`)
  return `Tribes are set. The draft order stays random — your tribemates are below.\n${lines.join('\n')}`
}
