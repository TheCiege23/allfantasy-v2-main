// @vitest-environment node
/**
 * Home's Top decisions and Starters in doubt for a team ESPN has knocked out (user report, 2026-11-08).
 *
 * 🛑 An imported Guilly / Knockout league records no chop anywhere — no chop row, no eliminated flag —
 * and its stored roster still lists the players. So a team out since week 8 kept its injured starter
 * on Home as a lineup to fix, after the league had even been confirmed Guilly. The loader now applies
 * the rail's score rule (railMatchups.ts `choppedBefore`) to your own roster.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: vi.fn(async () => []),
}))
// An ESPN roster is translated to Sleeper ids by an identity read; these ids are Sleeper's already.
vi.mock('@/lib/core-app/rosterIdSpace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/rosterIdSpace')>()),
  sleeperReadableRosters: async (rows: unknown[]) => rows,
}))

/**
 * Five teams, mine is '1'; each scores its base unless chopped (then 0). The chops this produces are
 * team 5 after week 6 and team 4 after week 7 (the natural lowest), then `lowestInWeek8` after week 8.
 * Week 9 is the current week, unplayed.
 */
function season(lowestInWeek8: string) {
  const base: Record<string, number> = { '1': 120, '2': 115, '3': 110, '4': 105, '5': 100 }
  const chopAfter: Record<number, string> = { 6: '5', 7: '4', 8: lowestInWeek8 }
  const out: Array<{ leagueId: string; seasonYear: number; week: number; rosterId: string; pointsFor: number }> = []
  const gone = new Set<string>()
  for (let week = 6; week <= 9; week++) {
    for (const id of Object.keys(base)) {
      let pts = gone.has(id) || week === 9 ? 0 : base[id]!
      if (week === 8 && id === lowestInWeek8 && !gone.has(id)) pts = 60
      out.push({ leagueId: 'E1', seasonYear: 2026, week, rosterId: id, pointsFor: pts })
    }
    if (chopAfter[week]) gone.add(chopAfter[week]!)
  }
  return out
}

const { db, rows } = vi.hoisted(() => ({
  db: {
    lowest: '1',
    leagueType: 'guillotine' as string,
    settings: { current_week: 9 } as Record<string, unknown>,
  },
  rows: (list: unknown[]) => ({ findMany: vi.fn(async () => list) }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineRosterState: rows([]),
    guillotineElimination: rows([]),
    leagueTeam: rows([
      { leagueId: 'L1', id: 'T1', teamName: 'Mine', ownerName: 'me', platformUserId: 'p1', externalId: '1', isCommissioner: false, isCoCommissioner: false },
    ]),
    sportsGame: rows([]),
    roster: rows([{ id: 'R1', leagueId: 'L1', playerData: { players: ['6038', '6039'], starters: ['6038'] } }]),
    sportsPlayer: {
      findMany: vi.fn(async () => [{ sleeperId: '6038', name: 'Hurt Starter', position: 'WR', team: 'NYJ', sport: 'NFL', imageUrl: null }]),
    },
    sportsInjury: rows([
      { playerName: 'Hurt Starter', status: 'Out', description: 'Concussion', date: new Date(), position: 'WR', team: 'NYJ' },
    ]),
    league: { findMany: vi.fn(async () => [{ id: 'L1', platform: 'espn', guillotineMode: false, leagueVariant: null, settings: db.settings }]) },
    weeklyMatchup: { findMany: vi.fn(async () => season(db.lowest)) },
  },
}))

import { getDash34Data } from '@/lib/core-app/dash34'

const league = () => ({
  id: 'L1',
  name: 'Washington Pro Knockout PPR League',
  sport: 'NFL',
  status: 'in_season',
  season: 2026,
  platform: 'espn',
  platformLeagueId: 'E1',
  leagueType: db.leagueType,
  settings: db.settings,
  hasUnifiedRecord: true,
  lastSyncedAt: null,
})

/** `allLeagues` holds every league; `leagues` only the ones needing attention. */
const leagueOf = (result: unknown) =>
  ((result as { allLeagues?: Array<{ id: string; hurtStarters?: number; chips?: Array<{ label: string }> }> }).allLeagues ?? []).find((l) => l.id === 'L1')

beforeEach(() => {
  vi.clearAllMocks()
  db.lowest = '1'
  db.leagueType = 'guillotine'
  db.settings = { current_week: 9 }
})

describe('getDash34Data — a team an imported knockout league has chopped', () => {
  it('🛑 puts none of its players in Starters in doubt, raises no lineup alert, and says ELIMINATED', { timeout: 60_000 }, async () => {
    const result = await getDash34Data('u1', [league()], new Date())
    expect(JSON.stringify(result)).not.toContain('Hurt Starter')
    expect(leagueOf(result)?.hurtStarters ?? 0).toBe(0)
    expect(leagueOf(result)?.chips?.map((c) => c.label)).toContain('ELIMINATED')
  })

  it('CONTROL: the same league with your team still alive keeps the alert', { timeout: 60_000 }, async () => {
    db.lowest = '2'
    const result = await getDash34Data('u1', [league()], new Date())
    expect(JSON.stringify(result)).toContain('Hurt Starter')
    expect(leagueOf(result)?.hurtStarters).toBe(1)
    expect(leagueOf(result)?.chips?.map((c) => c.label)).not.toContain('ELIMINATED')
  })

  it('honours the Guilly confirmation when a sync has guessed the column back to redraft', { timeout: 60_000 }, async () => {
    db.leagueType = 'redraft'
    db.settings = { current_week: 9, leagueTypeConfirmation: { type: 'guillotine' } }
    const result = await getDash34Data('u1', [league()], new Date())
    expect(JSON.stringify(result)).not.toContain('Hurt Starter')
  })

  it('CONTROL: a league that is not Guilly is never judged by the chop rule', { timeout: 60_000 }, async () => {
    db.leagueType = 'redraft'
    const result = await getDash34Data('u1', [league()], new Date())
    expect(JSON.stringify(result)).toContain('Hurt Starter')
  })

  it('CONTROL: with no stated current week it does not guess', { timeout: 60_000 }, async () => {
    db.settings = {}
    const result = await getDash34Data('u1', [league()], new Date())
    expect(JSON.stringify(result)).toContain('Hurt Starter')
  })
})
