import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The rookie draft completing is still the normal way year two starts. When it moves the season
 * from `setup` to `active`, the carried rosters get the same housekeeping the other two paths run —
 * and a season that was already running does not run it again.
 */

const m = vi.hoisted(() => ({
  seasonFindFirst: vi.fn(),
  seasonUpdate: vi.fn(),
  after: vi.fn(),
  emit: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ id: 'L', survivorMode: false, settings: {}, sport: 'NFL', leagueType: 'dynasty' })),
    },
    draftSession: { findFirst: vi.fn(async () => ({ id: 'd2', status: 'completed', picks: [] })) },
    redraftSeason: { findFirst: m.seasonFindFirst, update: m.seasonUpdate },
    redraftMatchup: { count: vi.fn(async () => 120) },
  },
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ seedNullFaabBalances: vi.fn(async () => undefined) }))
vi.mock('@/lib/schedule/teamByeWeeks', () => ({ resolveTeamByeWeeks: vi.fn(async () => new Map()), byeForTeam: () => null }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: m.emit }), EVENT: { SEASON_ACTIVATED: 'x' } }))
vi.mock('@/lib/redraft/offseason/dynastyRolloverHousekeeping', () => ({ afterDynastyNewSeasonActivated: m.after }))

import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'

const SEASON = { id: 'y2', leagueId: 'L', sport: 'NFL', season: 2026, totalWeeks: 17, playoffStartWeek: 15, medianGame: false, currentWeek: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  m.after.mockResolvedValue(null)
  m.emit.mockResolvedValue(undefined)
  m.seasonUpdate.mockResolvedValue({})
})

describe('syncCompletedDraftToRedraftSeason — year-two housekeeping', () => {
  it('runs housekeeping when the rookie draft activates a setup season', async () => {
    m.seasonFindFirst.mockResolvedValue({ ...SEASON, status: 'setup' })
    await syncCompletedDraftToRedraftSeason('L')
    expect(m.seasonUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }))
    expect(m.after).toHaveBeenCalledWith('L', 'y2')
  })

  it('does not run it again for a season that was already active', async () => {
    m.seasonFindFirst.mockResolvedValue({ ...SEASON, status: 'active', currentWeek: 0 })
    await syncCompletedDraftToRedraftSeason('L')
    expect(m.after).not.toHaveBeenCalled()
  })

  it('a housekeeping failure does not fail draft completion', async () => {
    m.seasonFindFirst.mockResolvedValue({ ...SEASON, status: 'setup' })
    m.after.mockRejectedValue(new Error('boom'))
    const out = await syncCompletedDraftToRedraftSeason('L')
    expect(out.skipped).toBe(false)
    expect(m.emit).toHaveBeenCalled()
  })
})
