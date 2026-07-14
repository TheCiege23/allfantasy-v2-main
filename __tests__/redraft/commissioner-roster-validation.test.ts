/**
 * Commissioner Roster Validation (G10) — pure tests.
 *
 * Proves lineup/roster validation is driven by the COMMISSIONER'S configured
 * roster (`League.settings.roster.config.sections[].slots`) rather than a static
 * starter assumption: the resolver reads the real settings shape, and
 * validateRedraftLineup honors the resolved slots, flex/superflex eligibility,
 * DEF/K restrictions, and bench/IR/taxi limits.
 */
import { describe, expect, it } from 'vitest'
import { resolveRedraftRosterConfig, type ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { validateRedraftLineup, type RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'

/** Build a resolved config from a commissioner slots map (real settings shape). */
function cfg(slots: Record<string, number>): ResolvedRosterConfig {
  return resolveRedraftRosterConfig('NFL', { roster: { config: { sections: [{ slots }] } } })
}

const STD = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 6, IR: 1 }
const p = (playerId: string, position: string, slotType: string): RedraftLineupPlayer => ({ playerId, playerName: playerId, position, sport: 'NFL', slotType })

const validate = (rosterConfig: ResolvedRosterConfig, players: RedraftLineupPlayer[]) =>
  validateRedraftLineup({ sport: 'NFL', week: 1, players, rosterConfig })
const codes = (r: ReturnType<typeof validate>) => r.issues.map((i) => i.code)

describe('G10 resolver — reads commissioner roster from settings', () => {
  it('parses the real settings.roster.config.sections[].slots shape', () => {
    const r = cfg(STD)
    expect(r.source).toBe('commissioner')
    expect(r.starterCapacities.get('QB')).toBe(1)
    expect(r.starterCapacities.get('RB')).toBe(2)
    expect(r.starterCapacities.get('FLX')).toBe(1) // FLEX normalized → FLX
    expect(r.starterCapacities.get('DEF')).toBe(1)
    expect(r.starterCapacities.get('K')).toBe(1)
    expect(r.benchSlots).toBe(6)
    expect(r.irSlots).toBe(1)
    expect(r.taxiSlots).toBe(0)
    expect(r.maxRosterSize).toBe(9 + 6 + 1) // 9 starters (QB+RB2+WR2+TE+FLX+DEF+K) + 6 bench + 1 IR
  })
  it('normalizes SUPER_FLEX → SF and supports custom counts', () => {
    const r = cfg({ QB: 1, RB: 2, WR: 3, TE: 1, SUPER_FLEX: 1, DEF: 1, BN: 5 })
    expect(r.starterCapacities.get('SF')).toBe(1)
    expect(r.starterCapacities.get('WR')).toBe(3)
  })
  it('falls back to sport-config defaults when settings carry no roster', () => {
    const r = resolveRedraftRosterConfig('NFL', null)
    expect(r.source).toBe('defaults')
    expect(r.starterCapacities.get('QB')).toBe(1)
  })
})

describe('G10 lineup validation — driven by commissioner slots', () => {
  const std = cfg(STD)

  it('accepts a valid standard lineup', () => {
    const r = validate(std, [
      p('qb', 'QB', 'QB'), p('rb1', 'RB', 'RB'), p('rb2', 'RB', 'RB'),
      p('wr1', 'WR', 'WR'), p('wr2', 'WR', 'WR'), p('te', 'TE', 'TE'),
      p('flx', 'RB', 'FLEX'), p('def', 'DEF', 'DEF'), p('k', 'K', 'K'),
    ])
    expect(r.ok).toBe(true)
  })

  it('flags a missing starter (no K)', () => {
    const r = validate(std, [
      p('qb', 'QB', 'QB'), p('rb1', 'RB', 'RB'), p('rb2', 'RB', 'RB'),
      p('wr1', 'WR', 'WR'), p('wr2', 'WR', 'WR'), p('te', 'TE', 'TE'),
      p('flx', 'RB', 'FLEX'), p('def', 'DEF', 'DEF'),
    ])
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain('missing_starter_slot')
  })

  it('rejects an ineligible FLEX player (QB in FLEX)', () => {
    const r = validate(std, [p('qb', 'QB', 'FLEX')])
    expect(codes(r)).toContain('starter_position_ineligible')
  })

  it('SUPERFLEX accepts a QB; regular FLEX rejects a QB', () => {
    const sf = cfg({ QB: 1, SF: 1, RB: 2, WR: 2, TE: 1, DEF: 1, K: 1, BN: 6 })
    expect(validate(sf, [p('qb2', 'QB', 'SF')]).issues.map((i) => i.code)).not.toContain('starter_position_ineligible')
    expect(validate(std, [p('qb2', 'QB', 'FLEX')]).issues.map((i) => i.code)).toContain('starter_position_ineligible')
  })

  it('DEF slot only accepts DEF; K slot only accepts K', () => {
    expect(codes(validate(std, [p('wr', 'WR', 'DEF')]))).toContain('starter_position_ineligible')
    expect(codes(validate(std, [p('wr', 'WR', 'K')]))).toContain('starter_position_ineligible')
    expect(validate(std, [p('def', 'DST', 'DEF')]).issues.map((i) => i.code)).not.toContain('starter_position_ineligible')
  })

  it('enforces the bench slot limit', () => {
    const r = cfg({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1, K: 1, BN: 2, IR: 1 })
    const bench = [p('b1', 'RB', 'BN'), p('b2', 'WR', 'BN'), p('b3', 'TE', 'BN')]
    expect(codes(validate(r, bench))).toContain('bench_slot_overflow')
  })

  it('enforces the IR slot limit', () => {
    const r = cfg({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1, K: 1, BN: 6, IR: 1 })
    expect(codes(validate(r, [p('i1', 'RB', 'IR'), p('i2', 'WR', 'IR')]))).toContain('ir_slot_overflow')
  })

  it('rejects taxi players when taxi is not enabled (redraft default)', () => {
    expect(codes(validate(std, [p('t1', 'RB', 'TAXI')]))).toContain('taxi_not_enabled')
  })

  it('an over-capacity lineup is rejected (so it can never persist or score)', () => {
    // WR:2 configured; a 3rd WR starter overflows → ok=false → API returns 422 →
    // never saved → never scored as a valid starter line.
    const r = validate(std, [p('wr1', 'WR', 'WR'), p('wr2', 'WR', 'WR'), p('wr3', 'WR', 'WR')])
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain('starter_slot_overflow')
  })
})

describe('G10 backward-compat — no rosterConfig falls back to static defaults', () => {
  it('still validates the default lineup when no config is supplied', () => {
    const r = validateRedraftLineup({
      sport: 'NFL',
      week: 1,
      players: [
        p('qb', 'QB', 'QB'), p('rb', 'RB', 'RB'), p('wr1', 'WR', 'WR'),
        p('wr2', 'WR', 'WR'), p('te', 'TE', 'TE'), p('def', 'DST', 'DEF'),
      ],
    })
    expect(r.ok).toBe(true) // matches the pre-G10 static QB/RB/WR/WR/TE/DEF default
  })
})
