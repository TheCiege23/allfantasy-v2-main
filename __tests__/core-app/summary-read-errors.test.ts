// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The home's cross-league joins degrade instead of throwing, so a failed read is invisible in their
 * result. The portfolio summaries (lib/core-app/homePortfolioSummary.ts) must never STORE such a
 * result, so every degraded read has to be reported through `onReadError`. These tests fail each
 * read in turn and assert the report — including the shared reads inside `unstable_cache`, whose
 * failures used to be swallowed (and cached) inside the cached function where nothing could see them.
 */

const db = vi.hoisted(() => ({ fail: new Set<string>() }))

function model(name: string, rows: unknown[] = []) {
  return {
    findMany: vi.fn(async () => {
      if (db.fail.has(name)) throw new Error(`${name} P2024`)
      return rows
    }),
  }
}

vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: model('leagueTeam', [
      { leagueId: 'L1', teamName: 'Mine', ownerName: 'me', platformUserId: 'p1', externalId: '1', isCommissioner: false, isCoCommissioner: false },
    ]),
    sportsGame: model('sportsGame'),
    roster: model('roster', [{ leagueId: 'L1', playerData: { players: ['100'], starters: ['100'] } }]),
    sportsPlayer: model('sportsPlayer'),
    sportsInjury: model('sportsInjury'),
    league: model('league', [{ id: 'L1', platformLeagueId: 'P1' }]),
    weeklyMatchup: model('weeklyMatchup'),
  },
}))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: vi.fn(async () => {
    if (db.fail.has('values')) throw new Error('values P2024')
    return []
  }),
}))

const LEAGUE = { id: 'L1', name: 'League', platform: 'sleeper', sport: 'NFL', hasUnifiedRecord: true, lastSyncedAt: null }

beforeEach(() => {
  db.fail.clear()
})

describe('getDash34Data reports every read it degrades on', () => {
  it.each([
    ['leagueTeam', 'teams'],
    ['sportsGame', 'next-games'],
    ['roster', 'rosters'],
    ['sportsInjury', 'injury-feed'],
  ])('a failed %s read is reported as %s, and the result still comes back', { timeout: 60_000 }, async (model, read) => {
    const { getDash34Data } = await import('@/lib/core-app/dash34')
    db.fail.add(model)
    const reported: string[] = []
    const result = await getDash34Data('u1', [LEAGUE], new Date(), { onReadError: (r) => reported.push(r) })
    expect(result).toBeTruthy()
    expect(reported).toContain(read)
  })

  it('reports nothing when every read succeeds — the signal is not noise', { timeout: 60_000 }, async () => {
    const { getDash34Data } = await import('@/lib/core-app/dash34')
    const reported: string[] = []
    await getDash34Data('u1', [LEAGUE], new Date(), { onReadError: (r) => reported.push(r) })
    expect(reported).toEqual([])
  })

  it('a reporter that throws never fails the render', { timeout: 60_000 }, async () => {
    const { getDash34Data } = await import('@/lib/core-app/dash34')
    db.fail.add('roster')
    await expect(
      getDash34Data('u1', [LEAGUE], new Date(), {
        onReadError: () => {
          throw new Error('reporter bug')
        },
      }),
    ).resolves.toBeTruthy()
  })
})

describe('the panel loaders report their degraded reads', () => {
  it('exposure: a failed claims read is reported, and still reads as a panel', { timeout: 60_000 }, async () => {
    const { getCrossLeagueExposure } = await import('@/lib/core-app/dash3aPanels')
    db.fail.add('leagueTeam')
    const errors: unknown[] = []
    const panel = await getCrossLeagueExposure('u1', ['L1'], 6, { onReadError: (e) => errors.push(e) })
    expect(panel.available).toBe(false)
    expect(errors).toHaveLength(1)
  })

  it('rivals: a failed matchup read is reported', { timeout: 60_000 }, async () => {
    const { getRivalRecords } = await import('@/lib/core-app/dash3aPanels')
    db.fail.add('weeklyMatchup')
    const errors: unknown[] = []
    await getRivalRecords('u1', ['L1'], 4, { onReadError: (e) => errors.push(e) })
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('reports nothing when the reads succeed', { timeout: 60_000 }, async () => {
    const { getCrossLeagueExposure, getRivalRecords } = await import('@/lib/core-app/dash3aPanels')
    const errors: unknown[] = []
    await getCrossLeagueExposure('u1', ['L1'], 6, { onReadError: (e) => errors.push(e) })
    await getRivalRecords('u1', ['L1'], 4, { onReadError: (e) => errors.push(e) })
    expect(errors).toEqual([])
  })
})
