// @vitest-environment node
/**
 * The CFBD team directory carries each team's stadium, and is refreshed on a schedule.
 *
 * Measured 2026-09-30 (one CFBD call): `/teams` returns `location` with latitude,
 * longitude and dome for 664 of 1,933 teams — every FBS school. The directory used to
 * drop it, and `ingestCollegeTeams` had no scheduled caller at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cacheRow: null as null | { data: unknown; expiresAt: Date },
  directory: [] as Array<Record<string, unknown>>,
  teamUpserts: 0,
  cacheUpserts: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async () => h.cacheRow),
      upsert: vi.fn(async (args: { update: { data: unknown } }) => {
        h.cacheUpserts.push(args.update.data)
        return {}
      }),
    },
    sportsTeam: {
      upsert: vi.fn(async () => {
        h.teamUpserts += 1
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/cfb-player-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cfb-player-data')>()
  return { ...actual, getCFBTeamDirectory: vi.fn(async () => h.directory) }
})

import { toTeamVenue } from '@/lib/cfb-player-data'
import { parseDirectoryPayload } from '@/lib/sport-teams/collegeTeamIndexStore'
import { ingestCollegeTeamsIfDue } from '@/lib/sport-teams/ingestCollegeTeams'

const DAY = 24 * 60 * 60 * 1000
const CAMP_RANDALL = { name: 'Camp Randall Stadium', latitude: 43.06994, longitude: -89.4126943, dome: false }

beforeEach(() => {
  h.cacheRow = null
  h.teamUpserts = 0
  h.cacheUpserts = []
  h.directory = [
    { id: 275, school: 'Wisconsin', abbreviation: 'WIS', venue: CAMP_RANDALL },
    { id: 164, school: 'Rutgers', abbreviation: 'RUTG', venue: null },
  ]
})

describe('toTeamVenue (CFBD location)', () => {
  it('keeps name, coordinates and dome', () => {
    expect(
      toTeamVenue({ name: 'Camp Randall Stadium', latitude: 43.06994, longitude: -89.4126943, dome: false, city: 'Madison' }),
    ).toEqual(CAMP_RANDALL)
  })

  it('drops a location without real coordinates', () => {
    expect(toTeamVenue(null)).toBeNull()
    expect(toTeamVenue({ name: 'X', latitude: null, longitude: -89 })).toBeNull()
    expect(toTeamVenue({ name: 'X', latitude: '43', longitude: -89 })).toBeNull()
    expect(toTeamVenue({ name: 'X', latitude: Number.NaN, longitude: -89 })).toBeNull()
  })
})

describe('parseDirectoryPayload', () => {
  it('reads a stored venue, and a pre-venue row as null', () => {
    const [withVenue, legacy, bad] = parseDirectoryPayload([
      { id: 275, school: 'Wisconsin', venue: CAMP_RANDALL },
      { id: 164, school: 'Rutgers' },
      { id: 1, school: 'Odd U', venue: { name: 'Nowhere', latitude: 'north' } },
    ])
    expect(withVenue!.venue).toEqual(CAMP_RANDALL)
    expect(legacy!.venue).toBeNull()
    expect(bad!.venue).toBeNull()
  })
})

describe('ingestCollegeTeamsIfDue', () => {
  it('🛑 ingests when the stored directory has no stadiums, however recent', async () => {
    const now = Date.now()
    h.cacheRow = { data: [{ id: 275, school: 'Wisconsin' }], expiresAt: new Date(now + 29 * DAY) }
    const r = await ingestCollegeTeamsIfDue({ now })
    expect(r.skipped).toBeUndefined()
    expect(r).toMatchObject({ fetched: 2, withVenue: 1, written: 2 })
    expect((h.cacheUpserts[0] as Array<{ venue: unknown }>)[0]!.venue).toEqual(CAMP_RANDALL)
  })

  it('skips a directory written within 7 days that already has stadiums', async () => {
    const now = Date.now()
    h.cacheRow = { data: [{ id: 275, school: 'Wisconsin', venue: CAMP_RANDALL }], expiresAt: new Date(now + 29 * DAY) }
    const r = await ingestCollegeTeamsIfDue({ now })
    expect(r.skipped).toMatch(/within 7 days/)
    expect(h.teamUpserts).toBe(0)
  })

  it('re-ingests a directory older than 7 days', async () => {
    const now = Date.now()
    // Written 8 days ago: its 30-day expiry is 22 days out.
    h.cacheRow = { data: [{ id: 275, school: 'Wisconsin', venue: CAMP_RANDALL }], expiresAt: new Date(now + 22 * DAY) }
    const r = await ingestCollegeTeamsIfDue({ now })
    expect(r.skipped).toBeUndefined()
    expect(h.cacheUpserts).toHaveLength(1)
  })

  it('ingests when no directory exists at all', async () => {
    const r = await ingestCollegeTeamsIfDue({ now: Date.now() })
    expect(r.fetched).toBe(2)
  })

  it('⚠ a passed deadline defers team rows but still writes the whole directory', async () => {
    const r = await ingestCollegeTeamsIfDue({ now: Date.now(), deadlineAt: Date.now() - 1 })
    expect(r.deferredTeamRows).toBe(2)
    expect(h.teamUpserts).toBe(0)
    expect(h.cacheUpserts).toHaveLength(1)
    expect((h.cacheUpserts[0] as unknown[]).length).toBe(2)
  })
})
