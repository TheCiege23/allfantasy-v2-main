import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  league: {} as Record<string, unknown>,
  rows: [] as Array<{ week: number; rosterId: number; playerId: string; isStarter: boolean; points: number }>,
  injury: new Map<string, string>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => state.league) },
    leaguePlayerWeeklyScore: { findMany: vi.fn(async () => state.rows) },
    sportsPlayer: {
      findMany: vi.fn(async () => [
        { sleeperId: 'mahomes', name: 'Patrick Mahomes', team: 'KC', position: 'QB' },
        { sleeperId: 'hurts', name: 'Jalen Hurts', team: 'PHI', position: 'QB' },
        { sleeperId: 'hurt', name: 'Hurt Guy', team: 'DAL', position: 'WR' },
      ]),
    },
    leagueTeam: { findMany: vi.fn(async () => [{ externalId: '1', teamName: 'Tankers', ownerName: 'a' }, { externalId: '2', teamName: null, ownerName: 'bob' }]) },
  },
}))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: vi.fn(async () => ({ KC: 6 })) }))
vi.mock('@/lib/core-app/injuryStatusById', () => ({ readInjuryStatusById: vi.fn(async () => state.injury) }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { async evaluateUserFeatureAccess() { return { allowed: true } } } }))

import { readLineupIntegrity, readLineupIntegrityTasks } from '@/lib/lineup-integrity/lineupIntegrityService'

const sleeper = { id: 'L1', platform: 'sleeper', platformLeagueId: 'S1', season: 2026, sport: 'NFL', settings: { roster_positions: ['QB', 'WR', 'BN'] }, starters: null, leagueType: 'redraft', bestBallMode: false, userId: 'owner' }
const r = (week: number, rosterId: number, playerId: string, points = 10) => ({ week, rosterId, playerId, isStarter: true, points })

beforeEach(() => {
  state.league = { ...sleeper }
  state.rows = [r(5, 1, 'hurts'), r(5, 1, 'mahomes'), r(6, 1, 'mahomes'), r(6, 2, 'hurts'), r(6, 2, 'hurt', 0)]
  state.injury = new Map([['hurt', 'Out']])
})

describe('readLineupIntegrity', () => {
  it('says plainly where it cannot audit', async () => {
    state.league = { ...sleeper, platform: 'native' }
    expect(await readLineupIntegrity('L1', { fullSeason: true })).toEqual({ supported: false, reason: 'not_sleeper' })
    state.league = { ...sleeper, bestBallMode: true }
    expect(await readLineupIntegrity('L1', { fullSeason: true })).toEqual({ supported: false, reason: 'best_ball' })
    state.league = { ...sleeper, settings: {} }
    expect(await readLineupIntegrity('L1', { fullSeason: true })).toEqual({ supported: false, reason: 'no_lineup_rules' })
  })

  it('free view: the latest finished week only', async () => {
    const rep = await readLineupIntegrity('L1', { fullSeason: false })
    if (!rep?.supported) throw new Error('unsupported')
    expect(rep.weeks).toEqual([6])
    expect(rep.summary).toBeNull()
    // Two required starters (QB, WR; BN is bench): Bob's lineup was full, his Out starter is only a lead.
    expect(rep.findings.map((f) => [f.teamName, f.flagged])).toEqual([['bob', false], ['Tankers', true]])
    expect(rep.findings.find((f) => f.rosterId === 1)?.text).toBe('Week 6: Tankers — 1 empty starting slot; started Patrick Mahomes on a bye.')
    expect(rep.findings.find((f) => f.rosterId === 2)?.ruledOutStarters).toEqual(['hurt'])
  })

  it('full season adds the team-by-team record', async () => {
    const rep = await readLineupIntegrity('L1', { fullSeason: true })
    if (!rep?.supported) throw new Error('unsupported')
    expect(rep.weeks).toEqual([5, 6])
    expect(rep.summary?.find((s) => s.rosterId === 1)).toMatchObject({ weeksAudited: 2, weeksFlagged: 1 })
  })
})

describe('Action Queue tasks', () => {
  it('one task per team with HARD evidence in the latest week, keyed by season and week', async () => {
    const tasks = await readLineupIntegrityTasks('L1')
    // Bob's soft lead does not open a task; only hard evidence does.
    expect(tasks.map((t) => t.sourceKey)).toEqual(['operational:lineup-integrity:1:2026:6:v1'])
  })
  it('nothing for leagues it cannot audit', async () => {
    state.league = { ...sleeper, platform: 'native' }
    expect(await readLineupIntegrityTasks('L1')).toEqual([])
  })
})
