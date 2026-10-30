/**
 * A Fantrax NFL, college-football or MLB league keeps its real starting lineup — FLEX, SUPERFLEX,
 * the IDP slots, UTIL, CI/MI, P — instead of arriving with no slots at all.
 *
 * Before this, only NBA/NHL read `rosterInfo.positionConstraints`; every football and baseball league
 * stored `roster_positions: []`, so `importedLineupTemplateSlots` had nothing to build from and an IDP
 * league could never be recognised as one. The NFL `rosterInfo` here is the real public capture
 * (tests/fixtures/fantrax/nfl-public-2026.json) — its slot codes RWT/SFX/ID are read off its own
 * `playerInfo.eligiblePos` (`DB,ID`, `ID,DL`, `LB,ID`, `RWT,SFX,RB`). No provider was called.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import nfl from './fixtures/fantrax/nfl-public-2026.json'
import mlb from './fixtures/fantrax/mlb-points-public.json'

const h = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { fantraxLeague: { findUnique: h.findUnique, findMany: h.findMany } } }))
vi.mock('@/lib/league-import/fantrax/importFantraxLeague', () => ({ importFantraxLeague: h.refresh }))
import { fetchFantraxLeagueForImport } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import { importedLineupTemplateSlots } from '@/lib/league/importedLineupTemplate'
import { buildImportedLeagueSettings } from '@/lib/league-import/ImportedLeagueCommitService'
import type { NormalizedImportResult } from '@/lib/league-import/types'

type RosterInfo = { positionConstraints: Record<string, { maxActive: number }>; maxTotalPlayers?: number; maxTotalActivePlayers?: number; maxTotalReservePlayers?: number }
const NFL_INFO = nfl.info.rosterInfo as RosterInfo
/* The capture minus its one `ER` seat, whose eligibility (some DL, maybe some LB) has no exact equivalent. */
const { ER: _er, ...nflWithoutEr } = NFL_INFO.positionConstraints
const NFL_NO_ER: RosterInfo = { ...NFL_INFO, positionConstraints: nflWithoutEr, maxTotalActivePlayers: 21, maxTotalPlayers: 37 }

function snapshot(sport: string) {
  return {
    id: 'snapshot', appUserId: 'owner', sourceLeagueId: 'vendor', season: 2026,
    user: { id: 'manager', fantraxUsername: 'Manager' }, userTeam: 'Fixture team',
    sport, isDevy: false, leagueName: 'Fixture league', teamCount: 1,
    roster: [], standings: [{ team: 'Fixture team', fantraxTeamId: 't1', wins: 0, losses: 0 }], matchups: [], transactions: [],
  }
}

async function load(sport: string, rosterInfo: unknown) {
  const row = snapshot(sport)
  h.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row)
  h.refresh.mockResolvedValue({ ok: true, fantraxLeagueId: 'snapshot', scoringRules: [], scoringGaps: [], sourceSettings: { rosterInfo, scoringSystem: { type: 'HEAD_TO_HEAD_POINTS_BASED' } }, seasonState: null })
  return fetchFantraxLeagueForImport('owner', 'id:snapshot')
}
const slotsOf = (payload: Awaited<ReturnType<typeof load>>) =>
  Object.fromEntries(payload.settings!.rosterPositions.map((s) => [s.position, s.count]))

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
  h.findMany.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('Fantrax football lineup slots', () => {
  it.each([['nfl', 'NFL'], ['cfb', 'NCAAF']])('keeps FLEX, SUPERFLEX and the IDP slots for a stored %s league', async (stored, sport) => {
    const payload = await load(stored, NFL_NO_ER)
    expect(payload.league.sport).toBe(sport)
    expect(slotsOf(payload)).toEqual({ RB: 2, TE: 1, SUPER_FLEX: 2, LB: 3, DL: 2, WR: 3, K: 1, IDP_FLEX: 3, DB: 2, FLEX: 2, BN: 16 })
    expect(payload.settings?.raw).not.toHaveProperty('rosterSlotGaps')

    const league = FantraxLeagueMapper.map(payload)
    const template = importedLineupTemplateSlots({ sport, settings: { roster_positions: league.roster_positions } })
    expect(template?.map((s) => [s.slotName, s.starterCount || s.benchCount])).toEqual([
      ['RB', 2], ['TE', 1], ['SUPERFLEX', 2], ['LB', 3], ['DL', 2], ['WR', 3], ['K', 1], ['IDP_FLEX', 3], ['DB', 2], ['FLEX', 2], ['BENCH', 16],
    ])
  })

  it('refuses the whole lineup and names the seat when one Fantrax slot has no exact equivalent', async () => {
    const payload = await load('nfl', NFL_INFO)
    expect(payload.settings!.rosterPositions).toEqual([])
    expect(payload.settings?.raw).toMatchObject({ rosterSlotGaps: ['Fantrax roster slot ER has no NFL equivalent here'] })
  })

  it('an IDP lineup stored as SLOT:COUNT pairs marks the league IDP', async () => {
    const payload = await load('nfl', NFL_NO_ER)
    const league = FantraxLeagueMapper.map(payload)
    const settings = buildImportedLeagueSettings({
      league, source: { source_provider: 'fantrax', source_league_id: 'snapshot' }, rosters: [], schedule: [],
      draft_picks: [], transactions: [], standings: [], player_map: {}, previous_seasons: [],
    } as unknown as NormalizedImportResult)
    expect(settings.league_variant).toBe('IDP')
  })
})

describe('Fantrax MLB lineup slots', () => {
  it('keeps UTIL, CI, MI and P from the captured public league', async () => {
    const payload = await load('mlb', mlb.info.rosterInfo)
    expect(slotsOf(payload)).toEqual({ '2B': 1, SS: 1, P: 9, '1B': 1, C: 1, CI: 1, OF: 5, MI: 1, UTIL: 1, '3B': 1, BN: 8 })
    expect(payload.settings?.raw).not.toHaveProperty('rosterSlotGaps')
  })
})
