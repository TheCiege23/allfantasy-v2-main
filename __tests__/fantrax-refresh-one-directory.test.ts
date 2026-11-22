// @vitest-environment node
/**
 * A refresh asks for one player directory, not six.
 *
 * A Fantrax league does not say what sport it is, so a first import downloads every sport's
 * directory and measures which one names its players. A snapshot being refreshed was measured
 * already, so its own directory is asked for first — and the other five only when that one turns
 * out not to fit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), userUpsert: vi.fn(),
  info: vi.fn(), rosters: vi.fn(), standings: vi.fn(), players: vi.fn(), schedule: vi.fn(), draft: vi.fn(), picks: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  fantraxLeague: { findUnique: h.findUnique, findMany: h.findMany, updateMany: h.updateMany, upsert: h.upsert },
  fantraxUser: { upsert: h.userUpsert },
} }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (original) => ({
  ...await original<object>(),
  getFantraxLeagueInfo: h.info, getFantraxTeamRosters: h.rosters,
  getFantraxStandings: h.standings, getFantraxPlayerIds: h.players,
  fetchFantraxScheduleWithScores: h.schedule, getFantraxDraftResults: h.draft,
  getFantraxDraftPicks: h.picks,
}))
import { importFantraxLeague, knownDirectoryFits } from '@/lib/league-import/fantrax/importFantraxLeague'

const refreshArgs = { leagueId: 'vendor-id', teamName: 'My team', appUserId: 'owner', refreshSnapshotId: 'stable-uuid' }
const roster = (ids: string[]) => ids.map((id) => ({ id, position: 'WR', status: 'ACTIVE' }))
const ref = (id: string) => ({ fantraxId: id, name: `Player, ${id}`, position: 'WR', team: 'KC' })
const snapshot = (sport: string) => ({ id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026, sport })

/** Which sport's directory names the league's four players. */
let playersBelongTo = 'NFL'
const sportsAsked = () => h.players.mock.calls.map(([sport]) => sport as string)

beforeEach(() => {
  vi.resetAllMocks()
  playersBelongTo = 'NFL'
  h.findUnique.mockResolvedValue(snapshot('nfl'))
  h.updateMany.mockResolvedValue({ count: 1 })
  h.upsert.mockResolvedValue({ id: 'new-uuid' })
  h.userUpsert.mockResolvedValue({ id: 'fantrax-user' })
  h.info.mockResolvedValue({ ok: true, data: { leagueName: 'L', seasonYear: 2026, rosterInfo: {} } })
  h.rosters.mockResolvedValue({ ok: true, data: {
    team1: { teamName: 'My team', rosterItems: roster(['p1', 'p2']) },
    team2: { teamName: 'Other', rosterItems: roster(['p3', 'p4']) },
  } })
  h.players.mockImplementation(async (sport: string) => ({
    ok: true,
    data: sport === playersBelongTo ? { p1: ref('p1'), p2: ref('p2'), p3: ref('p3'), p4: ref('p4') } : { other: ref('other') },
  }))
  h.standings.mockResolvedValue({ ok: true, data: [] })
  h.schedule.mockResolvedValue({ rows: [], position: { state: 'in_progress', period: 5 }, periodsRead: 0, periodsFailed: 0, periodScores: [] })
  h.draft.mockResolvedValue(null)
  h.picks.mockResolvedValue({ ok: false, failure: { kind: 'not_found', message: 'no picks' } })
})

describe('a refresh of a league whose sport is known', () => {
  it('asks for that one directory and nothing else', async () => {
    const out = await importFantraxLeague(refreshArgs)
    expect(out).toMatchObject({ ok: true })
    expect(sportsAsked()).toEqual(['NFL'])
  })

  it('does the same for a hockey league', async () => {
    playersBelongTo = 'NHL'
    h.findUnique.mockResolvedValue(snapshot('nhl'))
    expect(await importFantraxLeague(refreshArgs)).toMatchObject({ ok: true })
    expect(sportsAsked()).toEqual(['NHL'])
  })
})

describe('the shortcut is dropped when it is not plainly right', () => {
  /**
   * 🛑 A WRONG STORED SPORT MUST NOT STICK. If only the stored sport's directory were ever read, a
   * snapshot filed under the wrong sport could never be corrected — every refresh would measure it
   * against the same wrong list.
   */
  it('measures every directory when the stored sport does not name the players', async () => {
    playersBelongTo = 'NBA'
    h.findUnique.mockResolvedValue(snapshot('nfl'))
    await importFantraxLeague(refreshArgs)
    /* NFL first; it names none of them; then all six. */
    expect(sportsAsked()[0]).toBe('NFL')
    expect([...new Set(sportsAsked())].sort()).toEqual(['CFB', 'MLB', 'NBA', 'NCAAB', 'NFL', 'NHL'])
    const written = h.updateMany.mock.calls.at(-1)?.[0]?.data
    expect(written?.sport).toBe('nba')
  })

  /** One failed request must cost the old six downloads, never a failed refresh. */
  it('measures every directory when the known one fails to load', async () => {
    let first = true
    h.players.mockImplementation(async (sport: string) => {
      if (sport === 'NFL' && first) {
        first = false
        return { ok: false, failure: { kind: 'unavailable', message: 'rate limited' } }
      }
      return { ok: true, data: sport === 'NFL' ? { p1: ref('p1'), p2: ref('p2'), p3: ref('p3'), p4: ref('p4') } : { other: ref('other') } }
    })
    expect(await importFantraxLeague(refreshArgs)).toMatchObject({ ok: true })
    expect([...new Set(sportsAsked())].sort()).toEqual(['CFB', 'MLB', 'NBA', 'NCAAB', 'NFL', 'NHL'])
  })

  it('a first import, which has no stored sport, still measures all six', async () => {
    h.findUnique.mockResolvedValue(null)
    await importFantraxLeague({ leagueId: 'vendor-id', teamName: 'My team', appUserId: 'owner' })
    expect([...sportsAsked()].sort()).toEqual(['CFB', 'MLB', 'NBA', 'NCAAB', 'NFL', 'NHL'])
  })
})

describe('whether a directory fits a league', () => {
  const teams = { t1: { rosterItems: [{ id: 'a' }, { id: 'b' }] }, t2: { rosterItems: [{ id: 'c' }, { id: 'd' }] } }

  it('needs at least half of the rostered players', () => {
    expect(knownDirectoryFits({ a: 1, b: 1 }, teams, null)).toBe(true)
    expect(knownDirectoryFits({ a: 1 }, teams, null)).toBe(false)
    expect(knownDirectoryFits({}, teams, null)).toBe(false)
  })

  /** A league that has not drafted has no rostered players; its own player pool is measured instead. */
  it('measures the player pool when nobody is rostered', () => {
    const empty = { t1: { rosterItems: [] }, t2: { rosterItems: [] } }
    expect(knownDirectoryFits({ a: 1, b: 1 }, empty, { a: {}, b: {}, c: {} })).toBe(true)
    expect(knownDirectoryFits({ z: 1 }, empty, { a: {}, b: {} })).toBe(false)
  })

  it('says no when there is no directory or nothing to measure', () => {
    expect(knownDirectoryFits(null, teams, null)).toBe(false)
    expect(knownDirectoryFits({ a: 1 }, null, null)).toBe(false)
    expect(knownDirectoryFits({ a: 1 }, { t1: { rosterItems: [] } }, {})).toBe(false)
  })
})
