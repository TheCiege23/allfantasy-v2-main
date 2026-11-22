// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { nativeWeeklyLeague, weeklyScopeKey } = await import('@/lib/core-app/weeklyCapabilities')
const { notStartedReason, outlookEliminationFormat, survivalReason, isPreseasonStage } = await import(
  '@/lib/core-app/seasonOutlookStatusRows'
)
const { priorProfile } = await import('@/lib/core-app/seasonOutlook')

describe('nativeWeeklyLeague', () => {
  it('reads a manual league with a `manual-` platform id from the native tables (production, 2026-11-11)', () => {
    const league = { id: 'L1', platform: 'manual', platformLeagueId: 'manual-cf6f36d2-25e1-4139-a795-165ea97e88b3' }
    expect(nativeWeeklyLeague(league)).toBe(true)
    expect(weeklyScopeKey(league)).toBe('native:L1')
  })
  it('still reads native / allfantasy / id-less manual leagues as native', () => {
    expect(nativeWeeklyLeague({ platform: 'allfantasy', platformLeagueId: 'x' })).toBe(true)
    expect(nativeWeeklyLeague({ platform: 'native' })).toBe(true)
    expect(nativeWeeklyLeague({ platform: 'manual', platformLeagueId: null })).toBe(true)
  })
  it('never reads a provider league as native', () => {
    expect(nativeWeeklyLeague({ platform: 'sleeper', platformLeagueId: '1315118312069271552' })).toBe(false)
    expect(nativeWeeklyLeague({ platform: 'fantrax', platformLeagueId: 'manual-looking' })).toBe(false)
    expect(nativeWeeklyLeague({ platform: 'manual', platformLeagueId: 'exile-abc' })).toBe(false)
  })
})

describe('outlookEliminationFormat', () => {
  it.each([
    [{ leagueType: 'guillotine' }, 'guillotine'],
    [{ leagueType: 'redraft', guillotineMode: true }, 'guillotine'],
    [{ leagueType: 'survivor' }, 'survivor'],
    [{ leagueType: 'survivor_guillotine' }, 'survivor'],
    [{ leagueType: 'tournament' }, 'tournament'],
    [{ leagueType: 'redraft' }, null],
    [{ leagueType: 'dynasty' }, null],
    [{ leagueType: 'zombie' }, null],
    // A survivor league's Exile Island: plain redraft type, marked by the id SurvivorExileEngine writes.
    [{ leagueType: 'redraft', platformLeagueId: 'exile-56b97b9e-1791865779894' }, 'survivor'],
  ])('%j → %s', (league, expected) => {
    expect(outlookEliminationFormat(league)).toBe(expected)
  })
})

describe('survivalReason', () => {
  it('says alive, eliminated, not started and unknown plainly', () => {
    expect(survivalReason('guillotine', { status: 'alive', remaining: 11, field: 18 })).toBe(
      'Guillotine — you are still alive, 11 of 18 teams left.',
    )
    expect(survivalReason('survivor', { status: 'eliminated', remaining: 9, field: 20 })).toBe(
      'Survivor — you have been eliminated (9 of 20 teams left).',
    )
    expect(survivalReason('tournament', { status: 'not-started', remaining: 16, field: 16 })).toBe(
      'Tournament — not started yet; all 16 teams are still in.',
    )
    expect(survivalReason('guillotine', { status: 'unknown', remaining: null, field: 18 })).toMatch(/status is unknown/)
  })
})

describe('notStartedReason', () => {
  it('names the stage the league is in', () => {
    expect(notStartedReason('drafting')).toMatch(/^Draft in progress/)
    expect(notStartedReason('pre_draft')).toMatch(/^Pre-draft/)
    expect(notStartedReason('setup')).toMatch(/^Still being set up/)
    expect(notStartedReason(null)).toMatch(/^Still being set up/)
    expect(isPreseasonStage('in_season')).toBe(false)
    expect(isPreseasonStage('setup')).toBe(true)
  })
})

describe('priorProfile', () => {
  it('blends own weeks with the league average, keeping the real sample size', () => {
    const p = priorProfile([130], { mu: 100, sigma: 20 })
    expect(p.mu).toBeCloseTo((130 + 3 * 100) / 4)
    expect(p.sigma).toBe(20)
    expect(p.n).toBe(1)
  })
  it('rates every team equally when nothing has been scored anywhere', () => {
    expect(priorProfile([], null)).toEqual(priorProfile([], null))
    expect(priorProfile([], null).n).toBe(0)
  })
})
