// @vitest-environment node
/**
 * NHL dynasty free agency carries the Fantrax prospects #3051 put on the rookie-draft board, and the
 * add / claim gate accepts `fantrax:<id>` for them only. Every other league is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITIES, prospectDb } from './nhl-prospect-fixture'

const h = vi.hoisted(() => ({
  league: vi.fn(),
  roster: vi.fn(),
  rosters: vi.fn(),
  legality: vi.fn(),
  waiverType: { value: 'rolling' as string },
  db: null as null | ReturnType<typeof import('./nhl-prospect-fixture').prospectDb>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: h.league },
    roster: { findFirst: h.roster, findMany: h.rosters },
    leagueWaiverSettings: { findUnique: async () => ({}) },
    sportsDataCache: { findUnique: (a: never) => h.db!.sportsDataCache.findUnique(a) },
    playerIdentityMap: { findMany: (a: never) => h.db!.playerIdentityMap.findMany(a) },
  },
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: h.waiverType.value }),
}))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: h.legality }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ computePerPlayerKickoffLocks: () => ({ lockedPlayerIds: [] }) }))

import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
import {
  assertNhlProspectFreeAgencyAdd,
  isFantraxProspectId,
  linkedRosteredProspectIds,
  loadNhlProspectFreeAgents,
  offersNhlProspectFreeAgency,
  PROSPECT_LIST_UNREADABLE_MESSAGE,
  PROSPECT_NOT_IN_LEAGUE_MESSAGE,
  PROSPECT_NOT_ON_LIST_MESSAGE,
} from '@/lib/waiver-wire/nhlProspectFreeAgency'
import { mapAddDropErrorCode } from '@/lib/waiver-wire/addDropErrors'

const NHL_DYNASTY = { id: 'L1', sport: 'NHL', isDynasty: true, leagueType: 'dynasty', leagueVariant: null, rosterSize: 10, lockAllMoves: false, lifecycleState: 'in_season' }

beforeEach(() => {
  vi.clearAllMocks()
  h.db = prospectDb()
  h.waiverType.value = 'rolling'
  h.league.mockResolvedValue(NHL_DYNASTY)
  h.roster.mockResolvedValue({ id: 'r1', playerData: { players: [] }, faabRemaining: 100 })
  h.rosters.mockResolvedValue([
    { id: 'r1', playerData: { players: [] } },
    { id: 'r2', playerData: { players: ['fantrax:04abc', '7001'] } },
  ])
  h.legality.mockResolvedValue(null)
})

describe('which leagues offer prospects in free agency', () => {
  it.each([
    [{ sport: 'NHL', isDynasty: true, leagueType: 'dynasty' }, true],
    [{ sport: 'nhl', isDynasty: false, leagueType: 'devy' }, true],
    [{ sport: 'NHL', isDynasty: false, leagueType: 'c2c' }, true],
    [{ sport: 'NHL', isDynasty: false, leagueType: 'redraft' }, false],
    [{ sport: 'NHL', isDynasty: false, leagueType: 'keeper' }, false],
    [{ sport: 'NBA', isDynasty: true, leagueType: 'dynasty' }, false],
    [{ sport: 'MLB', isDynasty: true, leagueType: 'dynasty' }, false],
    [{ sport: 'NFL', isDynasty: true, leagueType: 'dynasty' }, false],
  ])('%o -> %s', (league, expected) => {
    expect(offersNhlProspectFreeAgency(league)).toBe(expected)
  })

  it('only a non-empty fantrax: id is a prospect id', () => {
    expect(isFantraxProspectId('fantrax:04qyh')).toBe(true)
    expect(isFantraxProspectId('fantrax:')).toBe(false)
    expect(isFantraxProspectId('7001')).toBe(false)
  })
})

describe('loadNhlProspectFreeAgents (DB-first)', () => {
  it('lists unrostered prospects only: not a drafted one, not one linked to an NHL identity', async () => {
    const out = await loadNhlProspectFreeAgents(h.db as never, { rosteredIds: new Set(['fantrax:04abc']) })
    expect(out.prospects.map((p) => p.playerId).sort()).toEqual(['fantrax:04qyf', 'fantrax:04qyh'])
    expect(out.total).toBe(2)
    const madden = out.prospects.find((p) => p.fantraxId === '04qyh')
    expect(madden).toMatchObject({ name: 'Tyler Madden', position: 'RW', orgTeam: 'MIN' })
    expect(out.prospects.find((p) => p.fantraxId === '04qyf')?.orgTeam).toBeNull()
  })

  it('a name search finds a prospect, and the cap limits the list but not the total', async () => {
    const found = await loadNhlProspectFreeAgents(h.db as never, { rosteredIds: new Set(), query: 'madd' })
    expect(found.prospects.map((p) => p.name)).toEqual(['Tyler Madden'])
    const capped = await loadNhlProspectFreeAgents(h.db as never, { rosteredIds: new Set(), limit: 1 })
    expect(capped.prospects).toHaveLength(1)
    expect(capped.total).toBe(3)
  })

  it('maps a rostered fantrax id the weekly link attached to the identity ids it now goes by', async () => {
    const ids = await linkedRosteredProspectIds(h.db as never, ['fantrax:04lnk', '7001'])
    expect([...ids].sort()).toEqual(['5001', 'idm-linked'])
    const none = await linkedRosteredProspectIds(h.db as never, ['7001'])
    expect(none.size).toBe(0)
    expect(h.db!.playerIdentityMap.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('assertNhlProspectFreeAgencyAdd', () => {
  it('accepts a real prospect in NHL dynasty', async () => {
    await expect(assertNhlProspectFreeAgencyAdd(h.db as never, NHL_DYNASTY, 'fantrax:04qyh', [])).resolves.toBeUndefined()
  })

  it.each(['fantrax:made-up', 'fantrax:04lnk'])('refuses %s (not a current prospect)', async (id) => {
    await expect(assertNhlProspectFreeAgencyAdd(h.db as never, NHL_DYNASTY, id, [])).rejects.toThrow(PROSPECT_NOT_ON_LIST_MESSAGE)
  })

  it.each([
    ['NHL redraft', { sport: 'NHL', isDynasty: false, leagueType: 'redraft' }],
    ['NBA dynasty', { sport: 'NBA', isDynasty: true, leagueType: 'dynasty' }],
    ['NFL dynasty', { sport: 'NFL', isDynasty: true, leagueType: 'dynasty' }],
  ])('refuses a real prospect id in %s without reading the universe', async (_label, league) => {
    await expect(assertNhlProspectFreeAgencyAdd(h.db as never, league, 'fantrax:04qyh', [])).rejects.toThrow(PROSPECT_NOT_IN_LEAGUE_MESSAGE)
    expect(h.db!.sportsDataCache.findUnique).not.toHaveBeenCalled()
  })

  it('fails closed for a prospect id when the universe cannot be read', async () => {
    h.db = prospectDb({ universe: 'throw' })
    await expect(assertNhlProspectFreeAgencyAdd(h.db as never, NHL_DYNASTY, 'fantrax:04qyh', [])).rejects.toThrow(PROSPECT_LIST_UNREADABLE_MESSAGE)
  })

  it('a non-prospect id outside NHL dynasty reads nothing at all', async () => {
    await assertNhlProspectFreeAgencyAdd(h.db as never, { sport: 'NHL', leagueType: 'redraft' }, '7001', [{ players: ['fantrax:04lnk'] }])
    expect(h.db!.sportsDataCache.findUnique).not.toHaveBeenCalled()
    expect(h.db!.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })

  it('every refusal maps to PLAYER_UNAVAILABLE on the add / drop surface', () => {
    for (const m of [PROSPECT_NOT_IN_LEAGUE_MESSAGE, PROSPECT_NOT_ON_LIST_MESSAGE, PROSPECT_LIST_UNREADABLE_MESSAGE]) {
      expect(mapAddDropErrorCode(m, { hasDrop: false })).toBe('PLAYER_UNAVAILABLE')
    }
  })
})

describe('assertWaiverClaimEligibility — the gate add/drop and claims both run', () => {
  const claim = (addPlayerId: string, extra: Record<string, unknown> = {}) =>
    assertWaiverClaimEligibility({ leagueId: 'L1', rosterId: 'r1', addPlayerId, ...extra })

  it('accepts a real prospect id and still runs the roster-legality check', async () => {
    await expect(claim('fantrax:04qyh')).resolves.toBeUndefined()
    expect(h.legality).toHaveBeenCalledOnce()
  })

  it('refuses a made-up prospect id before legality', async () => {
    await expect(claim('fantrax:nope')).rejects.toThrow(PROSPECT_NOT_ON_LIST_MESSAGE)
    expect(h.legality).not.toHaveBeenCalled()
  })

  it('refuses a prospect another team drafted as already rostered', async () => {
    await expect(claim('fantrax:04abc')).rejects.toThrow('already on another roster')
  })

  it('refuses the pro id of a rostered prospect the weekly link has since attached', async () => {
    h.rosters.mockResolvedValue([{ id: 'r1', playerData: { players: [] } }, { id: 'r2', playerData: { players: ['fantrax:04lnk'] } }])
    await expect(claim('5001')).rejects.toThrow('already on another roster')
  })

  it('refuses a prospect id in NBA and NHL redraft leagues', async () => {
    h.league.mockResolvedValue({ ...NHL_DYNASTY, sport: 'NBA', leagueVariant: 'dynasty' })
    await expect(claim('fantrax:04qyh')).rejects.toThrow(PROSPECT_NOT_IN_LEAGUE_MESSAGE)
    h.league.mockResolvedValue({ ...NHL_DYNASTY, isDynasty: false, leagueType: 'redraft' })
    await expect(claim('fantrax:04qyh')).rejects.toThrow(PROSPECT_NOT_IN_LEAGUE_MESSAGE)
  })

  it('NHL redraft and MLB adds of ordinary ids are unchanged: no universe or identity read', async () => {
    h.league.mockResolvedValue({ ...NHL_DYNASTY, isDynasty: false, leagueType: 'redraft' })
    await expect(claim('9999')).resolves.toBeUndefined()
    h.league.mockResolvedValue({ ...NHL_DYNASTY, sport: 'MLB', isDynasty: true, leagueType: 'dynasty' })
    await expect(claim('9999')).resolves.toBeUndefined()
    expect(h.db!.sportsDataCache.findUnique).not.toHaveBeenCalled()
    expect(h.db!.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })

  it('the roster limit applies to a prospect unchanged', async () => {
    h.league.mockResolvedValue({ ...NHL_DYNASTY, rosterSize: 1 })
    h.roster.mockResolvedValue({ id: 'r1', playerData: { players: ['9999'] }, faabRemaining: 100 })
    await expect(claim('fantrax:04qyh')).rejects.toThrow(/roster is already at the limit/)
  })

  it('FAAB rules apply to a prospect unchanged', async () => {
    h.waiverType.value = 'faab'
    h.roster.mockResolvedValue({ id: 'r1', playerData: { players: [] }, faabRemaining: 10 })
    await expect(claim('fantrax:04qyh', { faabBid: 50 })).rejects.toThrow('Insufficient FAAB')
  })

  it('a commissioner lock applies to a prospect unchanged', async () => {
    h.league.mockResolvedValue({ ...NHL_DYNASTY, lockAllMoves: true })
    await expect(claim('fantrax:04qyh')).rejects.toThrow('All roster moves are locked')
  })

  it('fixture sanity: the linked identity carries the Fantrax id the rule excludes', () => {
    expect(IDENTITIES.find((r) => r.fantraxId === '04lnk')?.rollingInsightsId).toBe('5001')
  })
})
