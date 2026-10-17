// @vitest-environment node
/**
 * `SportsPlayer.status` is Sleeper's ROSTER status ("Active", "Injured Reserve"), not an injury
 * designation. These pin the shared reader the activity feed, both lineup scans and the waiver pool now
 * take the designation from: the live injury feed through `resolveInjuryFacts`, with the staleness rule
 * `ruledOutByFact` uses, and a roster status counted only as a season-scale absence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { findMany: mocks.findMany } } }))

import { currentDesignationFromFact, isRosterAbsence } from '@/lib/core-app/injuryStatus'
import { designationSeverity, resolveCurrentInjuryDesignations } from '@/lib/injuries/currentInjuryDesignations'

const NOW = new Date('2026-10-11T17:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

function feed(over: Partial<Record<string, unknown>>) {
  return {
    playerName: 'Ja’Marr Chase',
    status: 'Out',
    type: 'Hamstring',
    description: null,
    date: hoursAgo(20),
    week: 6,
    source: 'rolling_insights',
    fetchedAt: hoursAgo(1),
    team: 'Cincinnati Bengals',
    position: 'WR',
    ...over,
  }
}

beforeEach(() => {
  mocks.findMany.mockReset()
})

describe('currentDesignationFromFact — the ruledOutByFact staleness rule, for every designation', () => {
  it.each([
    [{ status: 'Questionable', stale: false }, 'Questionable'],
    [{ status: 'Out', stale: false }, 'Out'],
    [{ status: 'Questionable', stale: true }, null],
    [{ status: 'Out', stale: true }, null],
    [{ status: 'IR', stale: true }, 'IR'],
    [{ status: 'Suspension', stale: true }, 'Suspension'],
    [{ status: 'Active', stale: false }, null],
    [{ status: 'ACT', stale: false }, null],
    [{ status: null, stale: false }, null],
  ])('%j → %s', (fact, expected) => {
    expect(currentDesignationFromFact(fact)).toBe(expected)
  })

  it('no fact is no designation', () => {
    expect(currentDesignationFromFact(null)).toBeNull()
  })

  it('a roster absence is season-scale only — never the game-day "Out" PlayerStatusAggregator stamps', () => {
    expect(isRosterAbsence('Injured Reserve')).toBe(true)
    expect(isRosterAbsence('Suspended')).toBe(true)
    expect(isRosterAbsence('out')).toBe(false)
    expect(isRosterAbsence('Active')).toBe(false)
    expect(isRosterAbsence('Inactive')).toBe(false)
  })
})

describe('resolveCurrentInjuryDesignations', () => {
  it('🛑 an Out player whose Sleeper roster status reads "Active" is Out', async () => {
    mocks.findMany.mockResolvedValue([feed({})])
    const got = await resolveCurrentInjuryDesignations({
      sport: 'NFL',
      now: NOW,
      players: [{ key: 'p1', name: 'Ja’Marr Chase', team: 'CIN', position: 'WR', rosterStatus: 'Active' }],
    })
    expect(got.get('p1')).toMatchObject({ status: 'Out', source: 'injury_feed' })
  })

  it('the newest CLAIM wins — Sunday’s "Active" clears Friday’s "Questionable" however recently it was re-pulled', async () => {
    mocks.findMany.mockResolvedValue([
      feed({ status: 'Questionable', date: hoursAgo(50), fetchedAt: hoursAgo(0.2), source: 'rolling_insights' }),
      feed({ status: 'Active', date: hoursAgo(3), fetchedAt: hoursAgo(3), source: 'espn' }),
    ])
    const got = await resolveCurrentInjuryDesignations({
      sport: 'NFL',
      now: NOW,
      players: [{ key: 'p1', name: 'Ja’Marr Chase', team: 'CIN', position: 'WR' }],
    })
    expect(got.has('p1')).toBe(false)
  })

  it('a stale game-day word is suppressed; a stale season-scale ruling holds', async () => {
    mocks.findMany.mockResolvedValue([
      feed({ playerName: 'Old Questionable', status: 'Questionable', date: hoursAgo(9 * 24), team: 'Dallas Cowboys' }),
      feed({ playerName: 'Long Term', status: 'IR', date: hoursAgo(9 * 24), team: 'Dallas Cowboys' }),
    ])
    const got = await resolveCurrentInjuryDesignations({
      sport: 'NFL',
      now: NOW,
      players: [
        { key: 'q', name: 'Old Questionable', team: 'DAL', position: 'WR' },
        { key: 'ir', name: 'Long Term', team: 'DAL', position: 'WR' },
      ],
    })
    expect(got.has('q')).toBe(false)
    expect(got.get('ir')?.status).toBe('IR')
  })

  it('🛑 two namesakes in one call each get their OWN designation — never the other’s', async () => {
    mocks.findMany.mockResolvedValue([
      feed({ playerName: 'Josh Allen', status: 'Questionable', team: 'Buffalo Bills', position: 'QB' }),
      feed({ playerName: 'Josh Allen', status: 'Out', team: 'Jacksonville Jaguars', position: 'LB' }),
    ])
    const got = await resolveCurrentInjuryDesignations({
      sport: 'NFL',
      now: NOW,
      players: [
        { key: 'qb', name: 'Josh Allen', team: 'BUF', position: 'QB' },
        { key: 'lb', name: 'Josh Allen', team: 'JAX', position: 'LB' },
      ],
    })
    expect(got.get('qb')?.status).toBe('Questionable')
    expect(got.get('lb')?.status).toBe('Out')
  })

  it('a Sleeper roster absence counts when the feed has nothing current — and only then', async () => {
    mocks.findMany.mockResolvedValue([feed({ playerName: 'Back From IR', status: 'Active', team: 'Dallas Cowboys' })])
    const got = await resolveCurrentInjuryDesignations({
      sport: 'NFL',
      now: NOW,
      players: [
        { key: 'ir', name: 'On The Shelf', team: 'DAL', position: 'RB', rosterStatus: 'Injured Reserve' },
        { key: 'stamped', name: 'Stamped Out', team: 'DAL', position: 'RB', rosterStatus: 'out' },
        { key: 'cleared', name: 'Back From IR', team: 'DAL', position: 'WR', rosterStatus: 'Injured Reserve' },
      ],
    })
    expect(got.get('ir')).toMatchObject({ status: 'Injured Reserve', source: 'roster_status' })
    expect(got.has('stamped')).toBe(false)
    expect(got.has('cleared')).toBe(false)
  })
})

describe('designationSeverity', () => {
  it.each([
    ['Out', 'unavailable'],
    ['Injured Reserve', 'unavailable'],
    ['Suspension', 'unavailable'],
    ['PUP', 'unavailable'],
    ['Doubtful', 'doubtful'],
    ['Questionable', 'questionable'],
    ['Day-To-Day', 'other'],
    [null, null],
  ])('%s → %s', (status, expected) => {
    expect(designationSeverity(status)).toBe(expected)
  })
})
