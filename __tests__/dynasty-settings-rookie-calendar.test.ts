import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The commissioner's rookie-draft calendar settings — auto-open and a custom open date — are saved
 * through the existing dynasty settings PUT into `League.settings`, with no schema change.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  dynastyFindUnique: vi.fn(),
  upsert: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    dynastyLeagueConfig: { findUnique: m.dynastyFindUnique },
  },
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(),
  getDynastyRosterPresets: vi.fn(() => []),
  getDynastyScoringPresets: vi.fn(() => []),
  getDynastyPlayoffPresets: vi.fn(() => []),
  upsertDynastyConfig: m.upsert,
  getDraftOrderAuditLog: vi.fn(async () => []),
  ROOKIE_PICK_ORDER_METHODS: [],
}))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({ checkDynastyLotteryEligibility: vi.fn() }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn(),
  setDraftOrderModeAndLotteryConfig: vi.fn(),
}))

import { PUT } from '@/app/api/leagues/[leagueId]/dynasty-settings/handler'
import { ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY, readRookieDraftCalendarSettings } from '@/lib/dynasty-core/rookieDraftCalendar'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const put = (body: unknown) =>
  PUT(new Request('http://x/api/leagues/L1/dynasty-settings', { method: 'PUT', body: JSON.stringify(body) }) as any, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({
    id: 'L1',
    sport: 'MLB',
    isDynasty: true,
    leagueVariant: null,
    settings: { scoring_format_type: 'standard' },
  })
  m.leagueUpdate.mockResolvedValue({})
  m.dynastyFindUnique.mockResolvedValue(null)
  m.upsert.mockResolvedValue({ leagueId: 'L1' })
})

const savedSettings = () => m.leagueUpdate.mock.calls[0][0].data.settings

describe('dynasty settings PUT — rookie draft calendar', () => {
  it('turns auto-open on and keeps every other setting', async () => {
    const res = await put({ rookieDraftAutoOpen: true })
    expect(res.status).toBe(200)
    expect(savedSettings()).toEqual({ scoring_format_type: 'standard', [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true } })
    expect(readRookieDraftCalendarSettings(savedSettings()).autoOpen).toBe(true)
  })

  it('a custom date alone does not pin auto-open (it keeps following the default)', async () => {
    await put({ rookieDraftCustomOpenDate: '2026-12-01' })
    expect(savedSettings()[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]).toEqual({ customOpenDate: '2026-12-01' })
  })

  it('clears a custom date with null or an empty string, keeping auto-open', async () => {
    m.leagueFindUnique.mockResolvedValue({
      id: 'L1', sport: 'MLB', isDynasty: true, leagueVariant: null,
      settings: { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true, customOpenDate: '2026-12-01' } },
    })
    await put({ rookieDraftCustomOpenDate: '' })
    expect(savedSettings()[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]).toEqual({ autoOpen: true, customOpenDate: null })
  })

  it('rejects an invalid date or a non-boolean switch and writes nothing', async () => {
    expect((await put({ rookieDraftCustomOpenDate: '2027-02-30' })).status).toBe(400)
    expect((await put({ rookieDraftAutoOpen: 'yes' })).status).toBe(400)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('[control] a save without calendar keys does not write the calendar', async () => {
    await put({ scoring_format_type: 'standard' })
    expect(savedSettings()[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]).toBeUndefined()
  })
})

describe('dynasty settings PUT — "start it N days after it opens" and the What changed card (2026-10-29)', () => {
  it('saves the day count and tells members, with rookie-draft and taxi changes alongside', async () => {
    m.dynastyFindUnique.mockResolvedValue({ rookiePickOrderMethod: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear', taxiSlots: 4, taxiEligibilityYears: 1, futurePicksYearsOut: 3 })
    m.upsert.mockResolvedValue({ rookiePickOrderMethod: 'max_pf', rookieDraftRounds: 5, rookieDraftType: 'linear', taxiSlots: 4, taxiEligibilityYears: 1, futurePicksYearsOut: 3 })
    const res = await put({ rookieDraftAutoStartDays: 7, rookieDraftRounds: 5 })
    expect(res.status).toBe(200)
    expect(readRookieDraftCalendarSettings(savedSettings()).autoStartDays).toBe(7)
    expect(m.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 'dynasty',
        changes: expect.arrayContaining([
          { key: 'rookieDraftRounds', before: 4, after: 5 },
          { key: 'rookieDraftAutoStartDays', before: null, after: 7 },
        ]),
      }),
    )
  })

  it('refuses a day count it does not offer', async () => {
    const res = await put({ rookieDraftAutoStartDays: 5 })
    expect(res.status).toBe(400)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })
})
