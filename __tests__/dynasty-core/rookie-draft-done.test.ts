import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ pickFindMany: vi.fn(), draftGroupBy: vi.fn(), leagueFindUnique: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    futureDraftPick: { findMany: h.pickFindMany },
    draftFact: { groupBy: h.draftGroupBy },
    league: { findUnique: h.leagueFindUnique },
  },
}))

import {
  buildRookieDraftDoneRecord,
  effectiveDraftStatus,
  hasRookieDraft,
  readRookieDraftDone,
  rookieDraftStateFromPlatform,
  ROOKIE_DRAFT_DONE_KEY,
} from '@/lib/dynasty-core/rookieDraftDone'
import { loadTeamFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'
import { AF_OWNED_LEAGUE_SETTINGS_KEYS } from '@/lib/league/afOwnedLeagueSettings'

const answered = (season: number, done: boolean) => ({
  [ROOKIE_DRAFT_DONE_KEY]: buildRookieDraftDoneRecord({ season, done, userId: 'u1', now: new Date('2026-05-01T00:00:00Z') }),
})

describe('the rule', () => {
  it('reads the draft state only from a platform that reports one (Sleeper)', () => {
    expect(rookieDraftStateFromPlatform('sleeper', 'pre_draft')).toBe('not_done')
    expect(rookieDraftStateFromPlatform('sleeper', 'drafting')).toBe('not_done')
    expect(rookieDraftStateFromPlatform('sleeper', 'in_season')).toBe('done')
    // MFL, ESPN and Yahoo say in_season all year: that is not an answer.
    expect(rookieDraftStateFromPlatform('mfl', 'in_season')).toBeNull()
    expect(rookieDraftStateFromPlatform('espn', 'complete')).toBeNull()
    expect(rookieDraftStateFromPlatform('sleeper', null)).toBeNull()
  })

  it('an answer counts for its own season only', () => {
    expect(readRookieDraftDone(answered(2026, false), 2026)).toBe(false)
    expect(readRookieDraftDone(answered(2026, true), 2027)).toBeNull()
    expect(readRookieDraftDone({}, 2026)).toBeNull()
  })

  it('the platform wins when it says; the answer fills in when it cannot', () => {
    expect(effectiveDraftStatus({ platform: 'sleeper', providerStatus: 'in_season', settings: answered(2026, false), leagueSeason: 2026 })).toBe('in_season')
    expect(effectiveDraftStatus({ platform: 'mfl', providerStatus: 'in_season', settings: answered(2026, false), leagueSeason: 2026 })).toBe('pre_draft')
    expect(effectiveDraftStatus({ platform: 'mfl', providerStatus: 'in_season', settings: answered(2026, true), leagueSeason: 2026 })).toBe('in_season')
    expect(effectiveDraftStatus({ platform: 'mfl', providerStatus: 'in_season', settings: {}, leagueSeason: 2026 })).toBe('in_season')
  })

  it('is asked for league types with a rookie draft, and survives a re-import', () => {
    expect(['dynasty', 'c2c', 'devy'].every(hasRookieDraft)).toBe(true)
    expect(hasRookieDraft('redraft')).toBe(false)
    expect(hasRookieDraft('keeper')).toBe(false)
    expect(AF_OWNED_LEAGUE_SETTINGS_KEYS).toContain(ROOKIE_DRAFT_DONE_KEY)
  })
})

describe('an MFL league\'s picks', () => {
  const teams = [{ id: 't1', externalId: '0001', platformUserId: null, claimedByUserId: null, teamName: 'Alpha' }]
  const args = { leagueId: 'mfl-1', platform: 'mfl', isDynasty: false, leagueSeason: 2026, status: 'in_season', teams, teamExternalId: '0001' }
  const seasonsRead = () => (h.pickFindMany.mock.calls[0]![0] as { where: { pickSeason: { in: number[] } } }).where.pickSeason.in

  beforeEach(() => {
    vi.clearAllMocks()
    h.pickFindMany.mockResolvedValue([])
    h.draftGroupBy.mockResolvedValue([])
  })

  it('"not yet" keeps this season\'s draft on the board', async () => {
    h.leagueFindUnique.mockResolvedValue({ settings: answered(2026, false) })
    await loadTeamFuturePicks(args)
    expect(seasonsRead()).toEqual([2026, 2027, 2028])
  })

  it('"done", or no answer, starts with next season — as before', async () => {
    h.leagueFindUnique.mockResolvedValue({ settings: answered(2026, true) })
    await loadTeamFuturePicks(args)
    expect(seasonsRead()).toEqual([2027, 2028, 2029])
    vi.clearAllMocks()
    h.pickFindMany.mockResolvedValue([])
    h.leagueFindUnique.mockResolvedValue({ settings: {} })
    await loadTeamFuturePicks(args)
    expect(seasonsRead()).toEqual([2027, 2028, 2029])
  })

  it('a settings read that fails costs nothing', async () => {
    h.leagueFindUnique.mockRejectedValue(new Error('down'))
    await loadTeamFuturePicks(args)
    expect(seasonsRead()).toEqual([2027, 2028, 2029])
  })

  it('Sleeper is not read for an answer: its own status decides', async () => {
    await loadTeamFuturePicks({ ...args, platform: 'sleeper', status: 'pre_draft' })
    expect(h.leagueFindUnique).not.toHaveBeenCalled()
    expect(seasonsRead()).toEqual([2026, 2027, 2028])
  })
})
