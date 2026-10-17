/**
 * The scheduled NCAAF skill-pool refresh (`lib/ncaaf/cfbdRosterPool.ts`) and the school matcher
 * it shares with `scripts/refresh-ncaaf-pool-cfbd.ts`.
 *
 * Measured against production 2026-10-01 before these were written: the matcher restricted to
 * Rolling Insights teams reproduced 135 of the 136 stored school→team mappings (the 136th was the
 * June run's own Louisiana mistake), and the unfiltered matcher would have renamed 107 of them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() },
  sportsTeam: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}))
const cfbdMock = vi.hoisted(() => ({
  getCFBFbsRosterResult: vi.fn(),
  getCFBTeamDirectory: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cfb-player-data', () => cfbdMock)

import { indexRiTeams, matchSchoolToRi } from '@/lib/ncaaf/cfbdSchoolMatch'
import {
  COLLEGE_ROSTER_POOL_REFRESH_MS,
  refreshCollegeRosterPool,
  refreshCollegeRosterPoolIfDue,
} from '@/lib/ncaaf/cfbdRosterPool'

const RI_TEAMS = [
  { externalId: '1', name: 'University of Alabama', shortName: 'ALA' },
  { externalId: '19', name: 'University of Miami', shortName: 'MIA' },
  { externalId: '112', name: 'Miami University', shortName: 'M-OH' },
  { externalId: '85', name: 'Louisiana Tech University', shortName: 'LT' },
  { externalId: '209', name: 'Louisiana State University', shortName: 'LSU' },
  { externalId: '230', name: 'Southeastern Louisiana University', shortName: 'SELA' },
  { externalId: '247', name: 'University of Louisiana at Lafayette', shortName: 'ULL' },
  { externalId: '248', name: 'University of Louisiana at Monroe', shortName: 'ULM' },
]
const school = (name: string, abbreviation: string | null = null, alternateNames: string[] | null = null) => ({
  school: name,
  abbreviation,
  alternateNames,
})

describe('matchSchoolToRi', () => {
  const index = indexRiTeams(RI_TEAMS)

  it('matches a CFBD school to its Rolling Insights team by normalized name', () => {
    expect(matchSchoolToRi(school('Alabama'), index)?.name).toBe('University of Alabama')
    expect(matchSchoolToRi(school('Louisiana Tech', 'LT'), index)?.name).toBe('Louisiana Tech University')
  })

  it('places the two Miamis and UL Lafayette by explicit id', () => {
    expect(matchSchoolToRi(school('Miami'), index)?.externalId).toBe('19')
    expect(matchSchoolToRi(school('Miami (OH)'), index)?.externalId).toBe('112')
    // CFBD's real alternates for this school — none normalizes to RI's name.
    expect(matchSchoolToRi(school('Louisiana', 'UL', ['UL Lafayette', 'UL', 'Louisiana']), index)?.externalId).toBe('247')
  })

  it('refuses a containment match that more than one team satisfies', () => {
    // "louisiana" is contained in several RI names; the June run took whichever came first.
    const noOverride = indexRiTeams(RI_TEAMS.filter((t) => t.externalId !== '247'))
    expect(matchSchoolToRi(school('Louisiana', 'UL'), noOverride)).toBeNull()
  })

  it('still accepts a containment match that exactly one team satisfies', () => {
    expect(matchSchoolToRi(school('Louisiana Monroe'), index)?.externalId).toBe('248')
  })
})

const DIRECTORY = [
  { school: 'Alabama', abbreviation: 'ALA', alternateNames: null },
  { school: 'Louisiana', abbreviation: 'UL', alternateNames: ['UL Lafayette', 'UL'] },
]
const rosterPlayer = (id: number, fullName: string, position: string, team: string) => ({
  id,
  firstName: fullName.split(' ')[0],
  lastName: fullName.split(' ').slice(1).join(' '),
  fullName,
  team,
  position,
  jersey: null,
  year: 1,
  height: null,
  weight: null,
  hometown: null,
  homeState: null,
  homeCountry: null,
})
const ROSTER_2026 = [
  rosterPlayer(5000001, 'Freshman Quarterback', 'QB', 'Alabama'),
  rosterPlayer(5000002, 'Some Fullback', 'FB', 'Alabama'),
  rosterPlayer(5000003, 'Offensive Lineman', 'OL', 'Alabama'),
  rosterPlayer(5000004, 'Ragin Cajun', 'WR', 'Louisiana'),
]

const NOW = Date.parse('2026-10-01T03:00:00Z')

function upsertedRows() {
  return prismaMock.sportsPlayer.upsert.mock.calls.map((c) => c[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.sportsDataCache.findUnique.mockResolvedValue(null)
  prismaMock.sportsDataCache.upsert.mockResolvedValue({})
  prismaMock.sportsTeam.findMany.mockResolvedValue(RI_TEAMS)
  prismaMock.sportsPlayer.findMany.mockResolvedValue([])
  prismaMock.sportsPlayer.upsert.mockImplementation((args: unknown) => args)
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => ops)
  cfbdMock.getCFBTeamDirectory.mockResolvedValue(DIRECTORY)
  cfbdMock.getCFBFbsRosterResult.mockResolvedValue({ ok: true, data: ROSTER_2026 })
})

describe('refreshCollegeRosterPool', () => {
  it('upserts current-season skill players under their Rolling Insights team', async () => {
    const result = await refreshCollegeRosterPool({ now: NOW, state: null })

    expect(cfbdMock.getCFBFbsRosterResult).toHaveBeenCalledWith(2026)
    expect(result).toMatchObject({ season: 2026, rosterPlayers: 4, seeds: 3, mappedToRiTeam: 3, written: 3, completed: true })

    const rows = upsertedRows()
    const byId = new Map(rows.map((r) => [r.where.sport_externalId_source.externalId, r]))
    expect(byId.get('5000001')?.create).toMatchObject({ source: 'cfbd', team: 'University of Alabama', teamId: '1', position: 'QB' })
    expect(byId.get('5000002')?.create.position).toBe('RB') // FB folds into RB, as the script did
    expect(byId.has('5000003')).toBe(false) // OL is not a pool position
    expect(byId.get('5000004')?.update).toMatchObject({ team: 'University of Louisiana at Lafayette', teamId: '247' })
  })

  it('reads Rolling Insights team rows only', async () => {
    await refreshCollegeRosterPool({ now: NOW, state: null })
    expect(prismaMock.sportsTeam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sport: 'NCAAF', source: 'rolling_insights' } }),
    )
  })

  it('never writes imageUrl and never deletes', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { externalId: '4000000', fetchedAt: new Date('2026-06-26T00:00:00Z') }, // graduated
    ])
    const result = await refreshCollegeRosterPool({ now: NOW, state: null })

    for (const row of upsertedRows()) {
      expect(row.create).not.toHaveProperty('imageUrl')
      expect(row.update).not.toHaveProperty('imageUrl')
    }
    expect(prismaMock.sportsPlayer.deleteMany).not.toHaveBeenCalled()
    expect(result.notOnCurrentRoster).toBe(1)
  })

  it('falls back to last season only when the current one is published empty', async () => {
    cfbdMock.getCFBFbsRosterResult
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: ROSTER_2026 })
    const result = await refreshCollegeRosterPool({ now: NOW, state: null })
    expect(cfbdMock.getCFBFbsRosterResult.mock.calls.map((c) => c[0])).toEqual([2026, 2025])
    expect(result.season).toBe(2025)
  })

  it('treats a refused request as an error, not as "no rosters" — no fallback, no writes', async () => {
    cfbdMock.getCFBFbsRosterResult.mockResolvedValue({
      ok: false,
      failure: { kind: 'quota', status: 429, message: 'CFBD monthly call quota exceeded', path: '/roster' },
    })
    const result = await refreshCollegeRosterPool({ now: NOW, state: null })
    expect(cfbdMock.getCFBFbsRosterResult).toHaveBeenCalledTimes(1)
    expect(result.error).toMatch(/quota/)
    expect(prismaMock.sportsPlayer.upsert).not.toHaveBeenCalled()
    expect(prismaMock.sportsDataCache.upsert).not.toHaveBeenCalled()
  })

  it('stops at the deadline without marking the cycle complete', async () => {
    const result = await refreshCollegeRosterPool({ now: NOW, state: null, deadlineAt: Date.now() - 1 })
    expect(result).toMatchObject({ written: 0, deferredRows: 3, completed: false })
    const states = prismaMock.sportsDataCache.upsert.mock.calls.map((c) => c[0].update.data)
    expect(states.at(-1)).toMatchObject({ completedAt: null })
  })

  it('resumes a partial cycle by skipping rows already written in it', async () => {
    const cycleStartedAt = new Date(NOW - 60_000).toISOString()
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { externalId: '5000001', fetchedAt: new Date(NOW - 30_000) }, // written this cycle
      { externalId: '5000002', fetchedAt: new Date('2026-06-26T00:00:00Z') }, // stale
    ])
    const result = await refreshCollegeRosterPool({
      now: NOW,
      state: { season: 2026, cycleStartedAt, completedAt: null },
    })
    expect(result).toMatchObject({ alreadyCurrent: 1, written: 2, completed: true })
    expect(upsertedRows().map((r) => r.where.sport_externalId_source.externalId).sort()).toEqual(['5000002', '5000004'])
  })
})

describe('refreshCollegeRosterPoolIfDue', () => {
  it('skips when the last completed cycle is under a week old', async () => {
    prismaMock.sportsDataCache.findUnique.mockResolvedValue({
      data: { season: 2026, cycleStartedAt: new Date(NOW - 86_400_000).toISOString(), completedAt: new Date(NOW - 86_400_000).toISOString() },
    })
    const result = await refreshCollegeRosterPoolIfDue({ now: NOW })
    expect(result.skipped).toMatch(/within 7 days/)
    expect(cfbdMock.getCFBFbsRosterResult).not.toHaveBeenCalled()
  })

  it('runs when the last completed cycle is over a week old', async () => {
    const old = new Date(NOW - COLLEGE_ROSTER_POOL_REFRESH_MS - 1).toISOString()
    prismaMock.sportsDataCache.findUnique.mockResolvedValue({
      data: { season: 2025, cycleStartedAt: old, completedAt: old },
    })
    const result = await refreshCollegeRosterPoolIfDue({ now: NOW })
    expect(result.completed).toBe(true)
  })
})
