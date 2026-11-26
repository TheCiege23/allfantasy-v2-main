import { describe, expect, it, vi } from 'vitest'

/*
 * Devy college scoring (owner's decision, 2026-11-24): a devy league works like C2C. Its college lineup
 * (default QB, RB, WR, WR, TE, FLEX) scores as its own college season. New NFL devy leagues start with it
 * on; a league made before keeps stash-only devy. Also: the create wizard stores C2C and devy leagues by
 * `leagueType` with no variant, which a variant-only check missed.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({
  getC2CConfig: vi.fn(async () => ({ collegeActiveLineupSlots: { QB: 1 }, standingsModel: 'separate' })),
}))

import { campusSport } from '@/lib/c2c/campusLineup'
import {
  collegeLineupSport,
  DEVY_COLLEGE_LINEUP_DEFAULT,
  devyCollegeLineupSlots,
  isScoringDevyLeague,
} from '@/lib/c2c/collegeLineupLeague'
import { checkCampusSave } from '@/lib/c2c/campusLineupCheck'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'

const devy = (over: Record<string, unknown> = {}) => ({ id: 'L1', platform: 'af', sport: 'NFL', leagueVariant: null, leagueType: 'devy', settings: { devy_college_scoring: true }, ...over })

describe('which leagues have a scoring college lineup', () => {
  it('a wizard-made NFL C2C league (league type, no variant) is football C2C; NBA stays variant-only', () => {
    expect(campusSport({ sport: 'NFL', leagueVariant: null, leagueType: 'c2c' })).toBe('football')
    expect(campusSport({ sport: 'NBA', leagueVariant: null, leagueType: 'c2c' })).toBeNull()
    expect(campusSport({ sport: 'NBA', leagueVariant: 'c2c' })).toBe('basketball')
    expect(campusSport({ sport: 'NFL', leagueVariant: null, leagueType: 'dynasty' })).toBeNull()
  })

  it('an NFL devy league scores its college lineup only with college scoring on', () => {
    expect(collegeLineupSport(devy())).toBe('football')
    expect(collegeLineupSport(devy({ leagueType: null, leagueVariant: 'devy_dynasty' }))).toBe('football')
    expect(collegeLineupSport(devy({ settings: {} }))).toBeNull() // a league made before: stash-only
    expect(collegeLineupSport(devy({ sport: 'NBA' }))).toBeNull()
    expect(isScoringDevyLeague(devy({ platform: 'sleeper' }))).toBe(false)
  })

  it('devy seats default to QB, RB, WR, WR, TE, FLEX and follow the commissioner', () => {
    expect(devyCollegeLineupSlots({})).toEqual(DEVY_COLLEGE_LINEUP_DEFAULT)
    expect(devyCollegeLineupSlots({ devy_college_lineup_slots: { qb: 1, wr: 3, flex: 2 } })).toEqual({ QB: 1, WR: 3, FLEX: 2 })
    expect(devyCollegeLineupSlots({ devy_college_lineup_slots: { QB: 99 } })).toEqual(DEVY_COLLEGE_LINEUP_DEFAULT)
  })
})

describe('checkCampusSave in a devy league', () => {
  const db = {
    redraftRosterPlayer: { findMany: vi.fn(async () => [
      { playerId: 'q', position: 'QB', playerName: 'College QB' },
      { playerId: 'w1', position: 'WR', playerName: 'College WR1' },
      { playerId: 'w2', position: 'WR', playerName: 'College WR2' },
      { playerId: 'w3', position: 'WR', playerName: 'College WR3' },
    ]) },
    // No college week counts in the NFL week named, so the kickoff lock has nothing to judge.
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  }
  const lineup = (campus: string[]) => ({ lineup_sections: { devy: [{ id: 'q' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }], campus } })
  const save = (league: ReturnType<typeof devy>, campus: string[]) =>
    checkCampusSave(db as never, { league, redraftRosterId: 'R1', before: lineup([]), after: lineup(campus), season: 2026, week: 1 })

  it('takes a lineup that fits the devy seats, never reading a C2C config', async () => {
    vi.mocked(getC2CConfig).mockClear()
    expect(await save(devy(), ['q', 'w1', 'w2'])).toEqual([])
    expect(getC2CConfig).not.toHaveBeenCalled()
  })

  it('refuses more WRs than the seats take (two WR plus a FLEX)', async () => {
    const issues = await save(devy({ settings: { devy_college_scoring: true, devy_college_lineup_slots: { QB: 1, WR: 2 } } }), ['q', 'w1', 'w2', 'w3'])
    expect(issues.length).toBeGreaterThan(0)
  })

  it('refuses a college lineup in a stash-only devy league', async () => {
    expect((await save(devy({ settings: {} }), ['q'])).map((i) => i.code)).toEqual(['campus_not_c2c'])
  })
})
