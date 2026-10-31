/**
 * Fantrax NBA and NHL import: sport detection, two-calendar-year seasons, slot mapping to our NBA/NHL
 * roster catalogs, minors -> taxi, and DB-first identity linking.
 *
 * ⚠ THE NBA/NHL FIXTURES ARE SYNTHETIC. They copy the shape of the one public Fantrax capture
 * (`mlb-points-public.json`) — nothing here proves what Fantrax actually sends for basketball or
 * hockey. See contracts/fantrax/GAPS.md for the captures that would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nba from './fixtures/fantrax/nba-synthetic.json'
import nhl from './fixtures/fantrax/nhl-synthetic.json'
import mlb from './fixtures/fantrax/mlb-points-public.json'
import { resolveRosters, type FantraxLeagueInfo, type FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import {
  fantraxImportSeason,
  isFantraxSplitSeasonFinished,
  mapFantraxRosterSlots,
} from '@/lib/league-import/fantrax/fantraxProSports'
import { splitLineupForTest as splitLineup } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
import { planProFantraxIdentityLinks, type ProIdentityRow } from '@/lib/player-identity/proFantraxIdentityPlan'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'
import { NBA_SLOT_MAP } from '@/lib/nba-roster/NbaRosterTemplates'
import { NHL_SLOT_MAP } from '@/lib/nhl-roster/NhlRosterTemplates'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), userUpsert: vi.fn(),
  info: vi.fn(), rosters: vi.fn(), standings: vi.fn(), players: vi.fn(), schedule: vi.fn(), draft: vi.fn(),
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
}))
import { importFantraxLeague } from '@/lib/league-import/fantrax/importFantraxLeague'

type Fixture = { info: Record<string, unknown>; playerMap: Record<string, FantraxPlayerRef>; roster: { teamName: string; rosterItems: Array<{ id: string; position: string; status: string }> } }
const asInfo = (f: { info: unknown }) => f.info as unknown as FantraxLeagueInfo

/** Every sport's map loads; only the fixture's own sport names anyone, as on the live API. */
function serve(fixture: Fixture, sport: string) {
  h.info.mockResolvedValue({ ok: true, data: fixture.info })
  h.rosters.mockResolvedValue({ ok: true, data: { t1: fixture.roster } })
  h.players.mockImplementation(async (code: string) => ({ ok: true, data: code === sport ? fixture.playerMap : { unrelated: { fantraxId: 'unrelated', name: 'Nobody, A', team: 'X', position: 'X' } } }))
}

beforeEach(() => {
  vi.resetAllMocks()
  h.findUnique.mockResolvedValue(null)
  h.userUpsert.mockResolvedValue({ id: 'fantrax-user' })
  h.upsert.mockResolvedValue({ id: 'snapshot' })
  h.standings.mockResolvedValue({ ok: true, data: [] })
  h.schedule.mockResolvedValue({ rows: [], position: null, periodsRead: 0, periodsFailed: 0 })
  h.draft.mockResolvedValue(null)
})
afterEach(() => { vi.useRealTimers() })

describe('Fantrax NBA/NHL league import', () => {
  it.each([
    ['NBA', nba as unknown as Fixture, 'nba'],
    ['NHL', nhl as unknown as Fixture, 'nhl'],
  ])('detects %s from its player map and keys the season by the year it begins', async (sport, fixture, stored) => {
    serve(fixture, sport)
    const outcome = await importFantraxLeague({ leagueId: 'synthetic', teamName: 'Fixture team', appUserId: 'owner' })
    expect(outcome).toMatchObject({ ok: true, season: 2025, resolved: 6, total: 7 })
    expect(h.players.mock.calls.map(([code]) => code)).toEqual(expect.arrayContaining(['NBA', 'NHL', 'MLB', 'NFL', 'CFB']))
    const write = h.upsert.mock.calls[0]![0]
    expect(write.create).toMatchObject({ sport: stored, season: 2025, isDevy: false })
    expect(write.where.userId_leagueName_season.season).toBe(2025)
  })

  it('leaves an MLB league on its own calendar year', async () => {
    serve({ ...(mlb as unknown as Fixture), roster: (mlb as unknown as Fixture).roster }, 'MLB')
    const outcome = await importFantraxLeague({ leagueId: 'public', teamName: 'Fixture team', appUserId: 'owner' })
    expect(outcome).toMatchObject({ ok: true, season: 2023 })
    expect(h.upsert.mock.calls[0]![0].create).toMatchObject({ sport: 'mlb' })
  })

  it('resolves the synthetic rosters against their own maps and keeps the unknown minor-leaguer', () => {
    for (const fixture of [nba, nhl] as unknown as Fixture[]) {
      const [roster] = resolveRosters({ t1: fixture.roster }, fixture.playerMap)
      expect(roster).toMatchObject({ resolved: 6, total: 7 })
      expect(roster!.players.find((p) => p.status === 'MINORS')).toMatchObject({ name: null })
    }
  })
})

describe('two-calendar-year seasons', () => {
  it('reads a "2025-26" label as 2025', () => {
    expect(fantraxImportSeason({ seasonYear: '2025-26' } as unknown as FantraxLeagueInfo, 'nba')).toBe(2025)
    expect(fantraxImportSeason({ seasonYear: '2025-2026' } as unknown as FantraxLeagueInfo, 'nhl')).toBe(2025)
  })
  it('lets the league calendar outrank a bare year whose meaning is unconfirmed', () => {
    expect(fantraxImportSeason(asInfo(nba), 'nba')).toBe(2025)
    expect(fantraxImportSeason({ seasonYear: 2025, scoringPeriods: [{ number: 1, startDate: '2025-10-07' }] } as unknown as FantraxLeagueInfo, 'nhl')).toBe(2025)
    /* A league whose first period opens after New Year still belongs to the season that began in the autumn. */
    expect(fantraxImportSeason({ seasonYear: 2026, startDate: '2026-01-05' } as unknown as FantraxLeagueInfo, 'nba')).toBe(2025)
  })
  it('falls back to the bare year, then to the season in progress', () => {
    expect(fantraxImportSeason({ seasonYear: 2025 } as unknown as FantraxLeagueInfo, 'nba')).toBe(2025)
    expect(fantraxImportSeason({} as FantraxLeagueInfo, 'nhl', new Date('2026-03-01T00:00:00Z'))).toBe(2025)
    expect(fantraxImportSeason({} as FantraxLeagueInfo, 'nhl', new Date('2026-10-19T00:00:00Z'))).toBe(2026)
  })
  it('does not touch single-year sports', () => {
    expect(fantraxImportSeason({ seasonYear: 2023, startDate: '2022-10-01' } as unknown as FantraxLeagueInfo, 'mlb')).toBe(2023)
    expect(fantraxImportSeason({ seasonYear: 2026 } as unknown as FantraxLeagueInfo, 'cfb')).toBe(2026)
  })
  it('is not finished until the summer after it began', () => {
    expect(isFantraxSplitSeasonFinished(2025, new Date('2026-03-15T00:00:00Z'))).toBe(false)
    expect(isFantraxSplitSeasonFinished(2025, new Date('2026-07-02T00:00:00Z'))).toBe(true)
  })
})

describe('roster slots map onto the native NBA/NHL catalogs', () => {
  it('NBA', () => {
    const { slots, gaps } = mapFantraxRosterSlots('NBA', nba.info.rosterInfo)
    expect(gaps).toEqual([])
    expect(Object.fromEntries(slots.map((s) => [s.position, s.count]))).toEqual({ PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 5 })
    for (const s of slots) expect(NBA_SLOT_MAP.has(s.position)).toBe(true)
  })
  it('NHL', () => {
    const { slots, gaps } = mapFantraxRosterSlots('NHL', nhl.info.rosterInfo)
    expect(gaps).toEqual([])
    expect(Object.fromEntries(slots.map((s) => [s.position, s.count]))).toEqual({ C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1, BN: 7 })
    for (const s of slots) expect(NHL_SLOT_MAP.has(s.position)).toBe(true)
  })
  it('names a slot it cannot place instead of dropping or guessing it', () => {
    const { slots, gaps } = mapFantraxRosterSlots('NHL', { positionConstraints: { C: { maxActive: 2 }, XYZ: { maxActive: 1 } } })
    expect(slots).toEqual([{ position: 'C', count: 2 }])
    expect(gaps).toEqual(['Fantrax roster slot XYZ has no NHL equivalent here'])
  })
})

describe('dynasty minors', () => {
  const players = [
    { fantraxId: 'a', status: 'ACTIVE' },
    { fantraxId: 'min', status: 'MINORS' },
    { fantraxId: 'ir', status: 'INJURED_RESERVE' },
    { fantraxId: 'bn', status: 'RESERVE' },
  ]
  it.each(['NBA', 'NHL', 'MLB'])('files %s minor-leaguers on the taxi squad, not the bench or IR', (sport) => {
    expect(splitLineup(players, sport)).toEqual({ starters: ['a'], bench: ['bn'], reserve: ['ir'], taxi: ['min'] })
  })
  it('leaves the NFL split exactly as it was', () => {
    expect(splitLineup(players)).toEqual({ starters: ['a'], bench: ['min', 'bn'], reserve: ['ir'] })
  })
})

describe('DB-first identity links for NBA and NHL', () => {
  const row = (id: string, name: string, team: string, position: string): ProIdentityRow => ({ id, canonicalName: name, currentTeam: team, position, fantraxId: null, rollingInsightsId: `ri-${id}` })
  it('links NBA players on name + team even when the positions disagree', () => {
    const plan = planProFantraxIdentityLinks('NBA', Object.values(nba.playerMap), [
      row('sga', 'Shai Gilgeous-Alexander', 'OKLAHOMA CITY THUNDER', 'G'),
      row('jokic', 'Nikola Jokić', 'Denver Nuggets', 'C'),
      row('wemby', 'Victor Wembanyama', 'SAS', 'F-C'),
      row('ant', 'Anthony Edwards', 'MIN', 'SF'),
    ])
    expect(plan.links.map((l) => l.id).sort()).toEqual(['ant', 'jokic', 'sga', 'wemby'])
  })
  it('never crosses an NBA team, and refuses a tie', () => {
    const ref = { fantraxId: 'x', name: 'Edwards, Anthony', team: 'MIN', position: 'SG' }
    expect(planProFantraxIdentityLinks('NBA', [ref], [row('a', 'Anthony Edwards', 'Brooklyn Nets', 'SG')]).links).toEqual([])
    expect(planProFantraxIdentityLinks('NBA', [ref], [row('a', 'Anthony Edwards', 'MIN', 'SG'), row('b', 'Anthony Edwards', 'Minnesota Timberwolves', 'G')]).ambiguous).toBe(1)
  })
  it('splits NHL goalies from skaters who share a name', () => {
    const refs = [
      { fantraxId: 'skater', name: 'Hughes, Quinn', team: 'VAN', position: 'D' },
      { fantraxId: 'goalie', name: 'Hughes, Quinn', team: 'VAN', position: 'G' },
    ]
    const plan = planProFantraxIdentityLinks('NHL', refs, [row('d', 'Quinn Hughes', 'Vancouver Canucks', 'D'), row('g', 'Quinn Hughes', 'VAN', 'G')])
    expect(plan.links).toEqual([
      { id: 'd', fantraxId: 'skater', rollingInsightsId: 'ri-d' },
      { id: 'g', fantraxId: 'goalie', rollingInsightsId: 'ri-g' },
    ])
  })
  it('folds NHL team spellings (TB / TBL / Tampa Bay Lightning)', () => {
    const plan = planProFantraxIdentityLinks('NHL', Object.values(nhl.playerMap), [row('kuch', 'Nikita Kucherov', 'Tampa Bay Lightning', 'RW')])
    expect(plan.links).toEqual([{ id: 'kuch', fantraxId: 'syn-nhl-02', rollingInsightsId: 'ri-kuch' }])
  })
})

describe('import UI', () => {
  it('offers Fantrax for NBA and NHL alongside the sports it already had', () => {
    const fantrax = IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === 'fantrax')
    expect(fantrax?.supportedSports).toEqual(['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL'])
  })
})

describe('a college-football Fantrax league is not a devy league by sport alone', () => {
  /*
   * Fantrax's league info carries no devy/dynasty flag (contracts/fantrax/GAPS.md F-06), and the
   * import used to stamp `isDevy: true` on every league whose players matched the CFB map — so a plain
   * college redraft league was filed, scored and labelled as devy.
   */
  it('stores isDevy false for a league detected as cfb', async () => {
    const cfbMap: Record<string, FantraxPlayerRef> = {
      c1: { fantraxId: 'c1', name: 'Prospect, A', team: 'BAMA', position: 'QB' },
      c2: { fantraxId: 'c2', name: 'Prospect, B', team: 'UGA', position: 'RB' },
    }
    serve({
      info: { leagueName: 'College redraft', seasonYear: 2026 },
      playerMap: cfbMap,
      roster: { teamName: 'Fixture team', rosterItems: [{ id: 'c1', position: 'QB', status: 'ACTIVE' }, { id: 'c2', position: 'RB', status: 'RESERVE' }] },
    }, 'CFB')
    const outcome = await importFantraxLeague({ leagueId: 'college', teamName: 'Fixture team', appUserId: 'owner' })
    expect(outcome).toMatchObject({ ok: true })
    expect(h.upsert.mock.calls[0]![0].create).toMatchObject({ sport: 'cfb', isDevy: false })
    expect(h.upsert.mock.calls[0]![0].update).toMatchObject({ sport: 'cfb', isDevy: false })
  })
})
