/**
 * Fantrax import against REAL public leagues (captured 2026-10-26, pre-draft, owner's consent):
 * one NBA, one NHL, one NFL (IDP) and one EPL league. Until these, NBA/NHL were proven against
 * synthetic fixtures only (contracts/fantrax/GAPS.md F-01/F-02/F-03/F-08).
 *
 * What the real captures showed, and what this file pins:
 *   - a league that has not drafted was refused ("roster player IDs do not identify one sport");
 *     its player pool identifies the sport instead;
 *   - basketball and hockey scoring codes were all unmapped, and a goalie save was read as a
 *     baseball save (`INDIVIDUAL_SAVES` → `sv`);
 *   - an NFL league's interceptions thrown, fumbles lost, kicking and IDP rules were dropped;
 *   - the NBA league states no reserve count, so its bench vanished.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import nba from './fixtures/fantrax/nba-public-2026.json'
import nhl from './fixtures/fantrax/nhl-public-2026.json'
import nfl from './fixtures/fantrax/nfl-public-2026.json'
import epl from './fixtures/fantrax/epl-public-2026.json'
import nbaPlayers from './fixtures/fantrax/nba-player-ids-public.json'
import nhlPlayers from './fixtures/fantrax/nhl-player-ids-public.json'
import mlb from './fixtures/fantrax/mlb-points-public.json'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import { fantraxImportSeason, mapFantraxRosterSlots } from '@/lib/league-import/fantrax/fantraxProSports'

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

type Capture = { info: Record<string, unknown>; rosters: { rosters: Record<string, unknown> } }
const info = (c: { info: unknown }) => c.info as unknown as FantraxLeagueInfo
const rules = (c: { info: unknown }) => Object.fromEntries(fantraxScoringRules(info(c)).rules.map((r) => [r.stat_key, r.points_value]))

const MAPS: Record<string, Record<string, unknown>> = {
  NBA: nbaPlayers.players,
  NHL: nhlPlayers.players,
}

function serve(capture: Capture) {
  h.info.mockResolvedValue({ ok: true, data: capture.info })
  h.rosters.mockResolvedValue({ ok: true, data: capture.rosters.rosters })
  h.players.mockImplementation(async (code: string) => ({ ok: true, data: MAPS[code] ?? {} }))
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

describe('real Fantrax captures — scoring', () => {
  it('NBA: every basketball rule maps, with no gaps', () => {
    expect(rules(nba)).toEqual({ pts: 1, reb: 1.25, ast: 1.5, stl: 2, blk: 2, to: -1 })
    expect(fantraxScoringRules(info(nba)).gaps).toEqual([])
  })

  it('NHL: skater and goalie rules map to hockey keys — a goalie save is not a baseball save', () => {
    expect(rules(nhl)).toEqual({
      g: 4, a: 3, sog: 0.5, ppp: 1, shg: 2, hits: 0.3, blks: 0.5, pim: 0.2,
      g_win: 3, g_sv: 0.15, g_ga: -1, g_so: 3,
    })
    expect(rules(nhl)).not.toHaveProperty('sv')
    // Goalie penalty minutes (0.5) and skater penalty minutes (0.2) share one rule here, so it is reported.
    expect(fantraxScoringRules(info(nhl)).gaps).toEqual(['Penalty Minutes is worth 0.5 here but shares one rule worth 0.2'])
  })

  it('NFL: interceptions thrown, fumbles lost, kicking and IDP now carry over; only rare kick-block plays remain gaps', () => {
    expect(rules(nfl)).toMatchObject({
      pass_int: -2, fum_lost: -1, xpm: 1, fgm: 3,
      idp_tkl: 0.5, idp_tkl_loss: 1, idp_sack: 5, idp_qb_hit: 0.5, idp_pass_def: 1, idp_int: 6,
      idp_ff: 2, idp_fum_rec: 1, idp_blk_kick: 3, idp_def_td: 6,
    })
    expect(fantraxScoringRules(info(nfl)).gaps).toEqual([
      'Blocked Field Goals for Touchdowns has no equivalent here, so it is not scored',
      'Blocked Punts has no equivalent here, so it is not scored',
      'Blocked Punts for Touchdowns has no equivalent here, so it is not scored',
      'Blocked Extra Point Returns for Score has no equivalent here, so it is not scored',
    ])
  })

  it('MLB is unchanged: a baseball save is still `sv`', () => {
    expect(rules(mlb)).toHaveProperty('sv')
    expect(rules(mlb)).not.toHaveProperty('g_sv')
  })
})

describe('real Fantrax captures — season and lineup', () => {
  it('NBA and NHL seasons are keyed by the year they begin', () => {
    expect(fantraxImportSeason(info(nba), 'nba')).toBe(2026)
    expect(fantraxImportSeason(info(nhl), 'nhl')).toBe(2026)
  })

  it('NBA keeps its bench when Fantrax states no reserve count (14 total − 10 active)', () => {
    expect(mapFantraxRosterSlots('NBA', nba.info.rosterInfo)).toEqual({
      slots: [{ position: 'C', count: 1 }, { position: 'UTIL', count: 5 }, { position: 'F', count: 2 }, { position: 'G', count: 2 }, { position: 'BN', count: 4 }],
      gaps: [],
    })
  })

  it('NHL forwards map to the C/W flex and its stated reserve is the bench', () => {
    expect(mapFantraxRosterSlots('NHL', nhl.info.rosterInfo)).toEqual({
      slots: [{ position: 'D', count: 3 }, { position: 'FLEX_CW', count: 5 }, { position: 'G', count: 2 }, { position: 'BN', count: 6 }],
      gaps: [],
    })
  })
})

describe('real Fantrax captures — a league that has not drafted yet', () => {
  it.each([
    ['NBA', nba as unknown as Capture, 'nba'],
    ['NHL', nhl as unknown as Capture, 'nhl'],
  ])('%s: the empty rosters do not stop the import — the player pool names the sport', async (_label, capture, stored) => {
    serve(capture)
    const outcome = await importFantraxLeague({ leagueId: 'public', teamName: 'Team 01', appUserId: 'owner' })
    expect(outcome).toMatchObject({ ok: true, season: 2026 })
    expect(h.upsert.mock.calls[0]![0].create).toMatchObject({ sport: stored, season: 2026 })
  })

  it('EPL: a soccer pool matches no supported sport and is refused with a plain reason', async () => {
    serve(epl as unknown as Capture)
    const outcome = await importFantraxLeague({ leagueId: 'public', teamName: 'Team 01', appUserId: 'owner' })
    expect(outcome).toMatchObject({ ok: false })
    expect((outcome as { error: string }).error).toMatch(/do not match the college, NFL, MLB, NBA or NHL player lists/)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
