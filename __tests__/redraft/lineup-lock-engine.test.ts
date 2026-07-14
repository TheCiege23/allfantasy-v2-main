/**
 * Lineup Lock Engine (G1) — pure contract tests.
 *
 * Proves the lock decision answers the real fantasy edge cases: per-player vs
 * first-game-of-week vs manual modes, Thursday/London/holiday kickoffs (just
 * different UTC timestamps), bye weeks (no game → never locks), and emergency
 * commissioner unlocks (always win). The DB join (`hydrateRedraftLineupLocks`,
 * `buildWeekKickoffMap`) is exercised end-to-end against staging by the engine
 * E2E; here we lock the pure decision + settings parsing + team normalization.
 */
import { describe, expect, it } from 'vitest'
import {
  computeLineupLock,
  resolveLineupLockMode,
  readLineupLockSettings,
  normalizeNflTeam,
} from '@/lib/redraft/lineupLock'

const T = (iso: string) => new Date(iso)

describe('resolveLineupLockMode', () => {
  it('defaults to per_player_kickoff and recognizes the named modes', () => {
    expect(resolveLineupLockMode(undefined)).toBe('per_player_kickoff')
    expect(resolveLineupLockMode('per_player_kickoff')).toBe('per_player_kickoff')
    expect(resolveLineupLockMode('first_game_of_week')).toBe('first_game_of_week')
    expect(resolveLineupLockMode('manual')).toBe('manual')
    expect(resolveLineupLockMode('commissioner')).toBe('manual')
    expect(resolveLineupLockMode('garbage')).toBe('per_player_kickoff')
  })
})

describe('computeLineupLock — per_player_kickoff (NFL default)', () => {
  const mode = 'per_player_kickoff' as const

  it('locks a player only once their own kickoff has passed', () => {
    const kickoff = T('2026-09-13T17:00:00Z')
    expect(computeLineupLock({ mode, now: T('2026-09-13T16:59:00Z'), playerKickoffUtc: kickoff })).toBe(false)
    expect(computeLineupLock({ mode, now: T('2026-09-13T17:00:00Z'), playerKickoffUtc: kickoff })).toBe(true)
    expect(computeLineupLock({ mode, now: T('2026-09-13T20:00:00Z'), playerKickoffUtc: kickoff })).toBe(true)
  })

  it('Thursday player locks while Sunday players stay movable', () => {
    const thu = T('2026-09-10T00:20:00Z') // TNF
    const sun = T('2026-09-13T17:00:00Z')
    const now = T('2026-09-11T12:00:00Z') // Friday
    expect(computeLineupLock({ mode, now, playerKickoffUtc: thu })).toBe(true)
    expect(computeLineupLock({ mode, now, playerKickoffUtc: sun })).toBe(false)
  })

  it('handles London / international early kickoffs purely by timestamp', () => {
    const london = T('2026-10-04T13:30:00Z') // 9:30am ET
    expect(computeLineupLock({ mode, now: T('2026-10-04T13:29:00Z'), playerKickoffUtc: london })).toBe(false)
    expect(computeLineupLock({ mode, now: T('2026-10-04T13:30:00Z'), playerKickoffUtc: london })).toBe(true)
  })

  it('never locks a player on bye / with no game (null kickoff, fail-open)', () => {
    expect(computeLineupLock({ mode, now: T('2026-12-25T23:00:00Z'), playerKickoffUtc: null })).toBe(false)
  })
})

describe('computeLineupLock — first_game_of_week', () => {
  const mode = 'first_game_of_week' as const
  it("locks the whole lineup at the week's first kickoff (Thursday locks everyone)", () => {
    const first = T('2026-09-10T00:20:00Z') // TNF is first game
    expect(computeLineupLock({ mode, now: T('2026-09-09T00:00:00Z'), firstKickoffUtc: first, playerKickoffUtc: T('2026-09-13T17:00:00Z') })).toBe(false)
    // After the Thursday kickoff, a Sunday player is also locked in this mode.
    expect(computeLineupLock({ mode, now: T('2026-09-10T00:20:00Z'), firstKickoffUtc: first, playerKickoffUtc: T('2026-09-13T17:00:00Z') })).toBe(true)
  })
})

describe('computeLineupLock — manual + emergency unlock', () => {
  it('manual mode locks only when the commissioner has locked the week', () => {
    const kickedOff = { mode: 'manual' as const, now: T('2026-09-13T20:00:00Z'), playerKickoffUtc: T('2026-09-13T17:00:00Z') }
    expect(computeLineupLock({ ...kickedOff, manualLocked: false })).toBe(false) // kickoff irrelevant in manual mode
    expect(computeLineupLock({ ...kickedOff, manualLocked: true })).toBe(true)
  })

  it('emergency commissioner unlock always wins, even after kickoff', () => {
    const afterKickoff = {
      mode: 'per_player_kickoff' as const,
      now: T('2026-09-13T20:00:00Z'),
      playerKickoffUtc: T('2026-09-13T17:00:00Z'),
    }
    expect(computeLineupLock(afterKickoff)).toBe(true)
    expect(computeLineupLock({ ...afterKickoff, emergencyUnlocked: true })).toBe(false)
  })
})

describe('readLineupLockSettings', () => {
  it('reads mode, manual-locked weeks, and overrides from sportConfig', () => {
    const s = readLineupLockSettings({
      sportConfig: {
        lineupLockType: 'first_game_of_week',
        lineupLockManualWeeks: [3, 5],
        lineupLockOverrides: [{ week: 4, rosterId: 'r1' }],
      },
    })
    expect(s.mode).toBe('first_game_of_week')
    expect([...s.manualLockedWeeks]).toEqual([3, 5])
    expect(s.overrides).toEqual([{ week: 4, rosterId: 'r1' }])
  })

  it('defaults safely when settings are empty', () => {
    const s = readLineupLockSettings(null)
    expect(s.mode).toBe('per_player_kickoff')
    expect(s.manualLockedWeeks.size).toBe(0)
    expect(s.overrides).toEqual([])
  })
})

describe('normalizeNflTeam', () => {
  it('canonicalizes abbreviation variants so player.team matches the schedule', () => {
    expect(normalizeNflTeam('JAC')).toBe('JAX')
    expect(normalizeNflTeam('wsh')).toBe('WAS')
    expect(normalizeNflTeam('LA')).toBe('LAR')
    expect(normalizeNflTeam('SD')).toBe('LAC')
    expect(normalizeNflTeam('OAK')).toBe('LV')
    expect(normalizeNflTeam('KC')).toBe('KC') // already canonical
    expect(normalizeNflTeam(null)).toBe('')
  })
})
