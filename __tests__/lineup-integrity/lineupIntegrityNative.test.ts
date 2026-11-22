import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assignments: [] as Array<{ rosterId: string; section: string; playerId: string; season: number; week: number }>,
  stats: [] as Array<{ playerId: string; week: number }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L1', platform: 'native', platformLeagueId: null, season: 2026, sport: 'NFL', starters: null,
        settings: { roster_positions: ['QB', 'RB', 'WR', 'BN', 'BN'] }, leagueType: 'redraft', bestBallMode: false, userId: 'owner',
      })),
    },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S26', season: 2026 })) },
    redraftMatchup: {
      findMany: vi.fn(async () => [
        { week: 5, status: 'final' }, { week: 5, status: 'final' },
        { week: 6, status: 'final' }, { week: 6, status: 'live' }, // week 6 not finished
      ]),
    },
    redraftRoster: {
      findMany: vi.fn(async () => [
        { id: 'r1', teamName: 'Tankers', ownerName: 'Pat' },
        { id: 'r2', teamName: null, ownerName: 'Sam' },
        { id: 'r3', teamName: 'Never Saved', ownerName: 'Lee' },
      ]),
    },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'af1', redraftRosterId: 'r1', league: { platform: 'native' } },
        { id: 'af2', redraftRosterId: 'r2', league: { platform: 'native' } },
        { id: 'af3', redraftRosterId: 'r3', league: { platform: 'native' } },
      ]),
    },
    afRosterLineupAssignment: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; season: number; week: number } }) =>
        h.assignments.filter((a) => where.rosterId.in.includes(a.rosterId) && a.season === where.season && a.week === where.week),
      ),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; playerId: { in: string[] } } }) =>
        [
          { rosterId: 'r1', playerId: 'qb1', slotType: 'QB', position: 'QB', injuryStatus: null, byeWeek: 9, playerName: 'QB One', team: 'KC' },
          { rosterId: 'r1', playerId: 'rb-bye', slotType: 'RB', position: 'RB', injuryStatus: null, byeWeek: 5, playerName: 'Bye Back', team: 'DET' },
          { rosterId: 'r1', playerId: 'wr-out', slotType: 'BN', position: 'WR', injuryStatus: 'Out', byeWeek: 10, playerName: 'Hurt Receiver', team: 'DAL' },
          { rosterId: 'r2', playerId: 'qb2', slotType: 'QB', position: 'QB', injuryStatus: null, byeWeek: 9, playerName: 'QB Two', team: 'BUF' },
          { rosterId: 'r2', playerId: 'wr-played', slotType: 'WR', position: 'WR', injuryStatus: 'IR', byeWeek: 11, playerName: 'Played Anyway', team: 'MIA' },
          { rosterId: 'r3', playerId: 'qb3', slotType: 'QB', position: 'QB', injuryStatus: null, byeWeek: 5, playerName: 'QB Three', team: 'DET' },
        ].filter((p) => where.rosterId.in.includes(p.rosterId) && where.playerId.in.includes(p.playerId)),
      ),
    },
    playerWeeklyScore: {
      findMany: vi.fn(async ({ where }: { where: { playerId: { in: string[] }; week: { in: number[] } } }) =>
        h.stats.filter((s) => where.playerId.in.includes(s.playerId) && where.week.in.includes(s.week)),
      ),
    },
  },
}))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: vi.fn(async () => ({})) }))
vi.mock('@/lib/core-app/injuryStatusById', () => ({ readInjuryStatusById: vi.fn(async () => new Map()) }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { async evaluateUserFeatureAccess() { return { allowed: true } } } }))

import { readLineupIntegrity, readLineupIntegrityTasks } from '@/lib/lineup-integrity/lineupIntegrityService'

const a = (rosterId: string, playerId: string, section: string, week = 5) => ({ rosterId, playerId, section, season: 2026, week })

beforeEach(() => {
  h.assignments = [
    // r1 saved week 5 with the Out receiver STARTING (his slotType says bench now).
    a('af1', 'qb1', 'starters'), a('af1', 'rb-bye', 'starters'), a('af1', 'wr-out', 'starters'),
    // r2 saved only two starters for three slots.
    a('af2', 'qb2', 'starters'), a('af2', 'wr-played', 'starters'),
    // r3 never saved week 5 — only week 6.
    a('af3', 'qb3', 'starters', 6),
  ]
  h.stats = [{ playerId: 'qb1', week: 5 }, { playerId: 'rb-bye', week: 5 }, { playerId: 'qb2', week: 5 }, { playerId: 'wr-played', week: 5 }]
})

describe('lineup integrity on an AllFantasy-run league', () => {
  it('audits the latest FINISHED week from the lineups teams saved for it', async () => {
    const rep = await readLineupIntegrity('L1', { fullSeason: false })
    if (!rep?.supported) throw new Error('unsupported')
    expect(rep.latestWeek).toBe(5) // week 6 still has a live game
    const by = new Map(rep.findings.map((f) => [f.teamName, f]))
    expect(by.get('Tankers')).toMatchObject({ emptySlots: 0, byeStarters: ['rb-bye'], ruledOutStarters: ['wr-out'], flagged: true })
    expect(by.get('Tankers')!.text).toBe('Week 5: Tankers — started Bye Back on a bye; started Hurt Receiver, who did not play and is listed Out/IR.')
    expect(by.get('Sam')).toMatchObject({ emptySlots: 1, ruledOutStarters: [], flagged: true }) // his IR starter played
    expect(by.has('Never Saved')).toBe(false) // no saved week-5 lineup → not audited, never his current one
  })

  it('opens queue tasks keyed by the native roster id', async () => {
    const keys = (await readLineupIntegrityTasks('L1')).map((t) => t.sourceKey).sort()
    expect(keys).toEqual(['operational:lineup-integrity:r1:2026:5:v1', 'operational:lineup-integrity:r2:2026:5:v1'])
  })
})
