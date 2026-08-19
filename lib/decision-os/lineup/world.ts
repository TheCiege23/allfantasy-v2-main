/**
 * Decision OS — World Resolution for `manager.lineup.set` (Slice 1).
 *
 * READ-ONLY. Resolves "the world" for a lineup decision by wrapping EXISTING sources:
 *   - roster config       → lib/redraft/rosterConfigResolver (resolveRedraftRosterConfig)
 *   - lineup lock timing  → lib/league/lineup-lock (evaluateLineupLock)  [sport logic stays INSIDE
 *                            that adapter; the core only reads a neutral lock_state fact]
 *
 * No writes. No prisma. Sport-specific timing never lives here — it is read as a neutral fact, so
 * the Decision OS core stays domain-agnostic (Constitution: specificity only in adapters).
 */
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { evaluateLineupLock } from '@/lib/league/lineup-lock'

/** Neutral lock fact — the sport-branched policy lives in the wrapped legacy adapter. */
export interface LockState {
  locked: boolean
  policy: string
  reason: string | null
  /** The lock is an ET-based approximation (no per-player schedules) — surfaced honestly. */
  provenance: 'derived_approximate'
  uncertainty: string | null
}

/** A tiny slice of Configuration Intelligence (interpreted, not raw settings). */
export interface LineupConfigIntel {
  starterSlots: number
  benchSlots: number
  irSlots: number
  taxiSlots: number
  rosterCompression: 'low' | 'medium' | 'high'
}

export interface LineupWorld {
  sport: string
  week: number
  facts: { rosterConfig: ResolvedRosterConfig; scoringKnown: boolean }
  derived: LineupConfigIntel
  lock_state: LockState
}

export interface LineupWorldInput {
  sport: string
  leagueSettings: unknown
  leagueWeek: number
  editingWeek: number
  scoringKnown?: boolean
}

export interface LineupWorldDeps {
  resolveRosterConfig: (sport: string, settings: unknown) => ResolvedRosterConfig
  evaluateLock: (args: { sport: string; now: Date; leagueWeek: number; editingWeek: number }) => {
    locked: boolean
    reason?: string
    policy: string
  }
  now: () => Date
}

export const defaultLineupWorldDeps: LineupWorldDeps = {
  resolveRosterConfig: resolveRedraftRosterConfig,
  evaluateLock: evaluateLineupLock,
  now: () => new Date(),
}

function interpretCompression(cfg: ResolvedRosterConfig): 'low' | 'medium' | 'high' {
  const starters = cfg.starterCapacities ? Array.from(cfg.starterCapacities.values()).reduce((a, b) => a + b, 0) : 0
  const bench = cfg.benchSlots ?? 0
  if (starters === 0) return 'low'
  const ratio = bench / starters
  return ratio <= 0.4 ? 'high' : ratio <= 0.9 ? 'medium' : 'low'
}

/** Pure, read-only World Resolution. */
export function resolveLineupWorld(input: LineupWorldInput, deps: LineupWorldDeps = defaultLineupWorldDeps): LineupWorld {
  const cfg = deps.resolveRosterConfig(input.sport, input.leagueSettings)
  const lock = deps.evaluateLock({ sport: input.sport, now: deps.now(), leagueWeek: input.leagueWeek, editingWeek: input.editingWeek })
  const lock_state: LockState = {
    locked: lock.locked,
    policy: lock.policy,
    reason: lock.reason ?? null,
    provenance: 'derived_approximate',
    uncertainty: 'Lock timing is an ET-based approximation without per-player schedules.',
  }
  return {
    sport: input.sport,
    week: input.editingWeek,
    facts: { rosterConfig: cfg, scoringKnown: input.scoringKnown ?? true },
    derived: {
      starterSlots: cfg.starterCapacities ? Array.from(cfg.starterCapacities.values()).reduce((a, b) => a + b, 0) : 0,
      benchSlots: cfg.benchSlots ?? 0,
      irSlots: cfg.irSlots ?? 0,
      taxiSlots: cfg.taxiSlots ?? 0,
      rosterCompression: interpretCompression(cfg),
    },
    lock_state,
  }
}
