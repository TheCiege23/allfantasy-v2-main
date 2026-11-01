import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildCollegeTeamIndex, type CollegeTeamRecord } from '@/lib/sport-teams/collegeTeamIdentity'

const { findMany, loadCollegeTeamIndex } = vi.hoisted(() => ({
  findMany: vi.fn(),
  loadCollegeTeamIndex: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany } } }))
vi.mock('@/lib/sport-teams/collegeTeamIndexStore', () => ({ loadCollegeTeamIndex }))

import { getByeWeeks } from '@/lib/core-app/byeWeeks'

/**
 * 🛑 THE REPORT THIS PINS (2026-10-30). A Fantrax CFB manager was told "Bench Keshaun
 * Singleton — On bye — WR · University of South Florida" the day before USF hosted UAB.
 * The roster said "University of South Florida"; the week's rows said "South Florida"
 * (cfbd, thesportsdb) and "SOUTH FLORIDA" (api_sports). The NFL-only fold uppercased
 * both, they never matched, and a 150-fixture college week sailed past the 12-game gate.
 */

/** 48 synthetic FBS schools plus the real USF/UAB records, so a week can be genuinely full. */
const FILLER: CollegeTeamRecord[] = Array.from({ length: 48 }, (_, i) => ({
  id: 1000 + i,
  school: `School ${i}`,
  abbreviation: `S${i}`,
  alternateNames: [`School ${i}`],
}))
const USF: CollegeTeamRecord = { id: 58, school: 'South Florida', mascot: 'Bulls', abbreviation: 'USF', alternateNames: ['USF', 'South Florida'] }
const UAB: CollegeTeamRecord = { id: 5, school: 'UAB', mascot: 'Blazers', abbreviation: 'UAB', alternateNames: ['UAB'] }
const BYE_TEAM: CollegeTeamRecord = { id: 99, school: 'Idle State', abbreviation: 'IDLE', alternateNames: ['Idle State'] }
const INDEX = buildCollegeTeamIndex([...FILLER, USF, UAB, BYE_TEAM])

/** One college week: 24 filler fixtures + USF v UAB, written the way the four feeds write them. */
function collegeWeek(week: number, opts: { idlePlays?: boolean } = {}) {
  const rows: Array<{ homeTeam: string; awayTeam: string; week: number; seasonType: string | null }> = []
  for (let i = 0; i + 1 < FILLER.length; i += 2) {
    rows.push({ homeTeam: FILLER[i].school, awayTeam: FILLER[i + 1].school, week, seasonType: 'regular' })
  }
  rows.push(
    { homeTeam: 'SOUTH FLORIDA', awayTeam: 'UAB', week, seasonType: null }, // api_sports
    { homeTeam: 'South Florida', awayTeam: 'UAB', week, seasonType: 'regular' }, // cfbd
    { homeTeam: 'South Florida', awayTeam: 'UAB', week, seasonType: null }, // thesportsdb
  )
  // Pad to a full college Saturday (40+ distinct fixtures) with more filler pairings.
  for (let i = 0; i + 3 < FILLER.length; i += 4) {
    rows.push({ homeTeam: FILLER[i].school, awayTeam: FILLER[i + 3].school, week, seasonType: 'regular' })
  }
  for (let i = 0; i + 5 < FILLER.length && rows.length < 60; i += 6) {
    rows.push({ homeTeam: FILLER[i + 1].school, awayTeam: FILLER[i + 5].school, week, seasonType: 'regular' })
  }
  if (opts.idlePlays) rows.push({ homeTeam: 'Idle State', awayTeam: FILLER[0].school, week, seasonType: 'regular' })
  return rows
}

beforeEach(() => {
  findMany.mockReset()
  loadCollegeTeamIndex.mockReset()
  loadCollegeTeamIndex.mockResolvedValue(INDEX)
})

describe('getByeWeeks — college football', () => {
  it('🛑 a USF player is not on bye when USF has a game, however either side spells it', async () => {
    findMany.mockResolvedValue(collegeWeek(9))

    const out = await getByeWeeks({
      sport: 'NCAAF',
      season: 2026,
      playerTeams: new Map([
        ['singleton', 'University of South Florida'],
        ['fantrax-code', 'sofl'],
        ['plain', 'South Florida'],
      ]),
      fromWeek: 9,
      horizon: 0,
    })

    expect(out?.weeksCovered).toEqual([9])
    expect(out?.byWeek.get(9) ?? []).toEqual([])
  })

  it('still finds a real college bye — a team the schedule knows, absent this week', async () => {
    findMany.mockResolvedValue([...collegeWeek(9), ...collegeWeek(10, { idlePlays: true })])

    const out = await getByeWeeks({
      sport: 'NCAAF',
      season: 2026,
      playerTeams: new Map([
        ['idle', 'Idle State'],
        ['singleton', 'University of South Florida'],
      ]),
      fromWeek: 9,
    })

    expect(out?.byWeek.get(9)).toEqual(['idle'])
    expect(out?.byWeek.get(10)).toBeUndefined()
  })

  it('⚠ says nothing about a team the schedule never shows — unknown is not a bye', async () => {
    findMany.mockResolvedValue(collegeWeek(9))

    const out = await getByeWeeks({
      sport: 'NCAAF',
      season: 2026,
      playerTeams: new Map([
        ['unresolvable', 'Nowhere Tech'],
        ['idle', 'Idle State'], // in the directory, but on no covered week's slate
      ]),
      fromWeek: 9,
      horizon: 0,
    })

    expect(out?.byWeek.get(9) ?? []).toEqual([])
  })

  it('refuses to judge a college week from an NFL-sized sliver of it', async () => {
    findMany.mockResolvedValue(collegeWeek(10, { idlePlays: true }).slice(0, 15).concat(collegeWeek(9).slice(0, 15)))

    const out = await getByeWeeks({
      sport: 'NCAAF',
      season: 2026,
      playerTeams: new Map([['idle', 'Idle State']]),
      fromWeek: 9,
    })

    expect(out).toBeNull()
  })

  it('returns null rather than guessing when the college directory is unavailable', async () => {
    loadCollegeTeamIndex.mockResolvedValue(null)
    findMany.mockResolvedValue(collegeWeek(9))

    const out = await getByeWeeks({
      sport: 'NCAAF',
      season: 2026,
      playerTeams: new Map([['singleton', 'University of South Florida']]),
      fromWeek: 9,
    })

    expect(out).toBeNull()
  })
})

describe('getByeWeeks — an unrecognised team name on the NFL fold', () => {
  it('⚠ a club string the schedule never shows is not flagged off', async () => {
    const ALL = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND',
      'JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']
    const games = []
    for (let i = 0; i + 1 < ALL.length; i += 2) games.push({ homeTeam: ALL[i], awayTeam: ALL[i + 1], week: 7, seasonType: 'regular' })
    findMany.mockResolvedValue(games)

    const out = await getByeWeeks({
      sport: 'NFL',
      season: 2026,
      playerTeams: new Map([['ghost', 'Frankford Yellow Jackets']]),
      fromWeek: 7,
    })

    expect(out?.byWeek.get(7) ?? []).toEqual([])
  })
})
