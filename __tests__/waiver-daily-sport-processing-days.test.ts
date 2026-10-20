/**
 * Daily sports (NBA/NHL/MLB) must run waivers on EVERY default processing day, not only the first.
 *
 * The sport defaults say NBA, NHL and MLB all run [Mon, Wed, Fri] (DAILY_REDRAFT_WAIVER_PROCESSING_DAYS;
 * e69537f9c moved MLB off [Mon, Thu]), but the
 * league-creation writers persisted only `processingDayOfWeek: processing_days[0]` and never the
 * `processingDays` list — so `computeNextWaiverRunAtUtc` scheduled one run a week (Monday).
 *
 * NFL (single default day [Tue]) must stay byte-identical: no `processingDays` key is written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  waiverFindUnique: vi.fn(),
  waiverCreate: vi.fn(),
  waiverUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    leagueWaiverSettings: { findUnique: m.waiverFindUnique, create: m.waiverCreate, update: m.waiverUpdate },
  },
}))

import { initializeLeagueWithSportDefaults } from '@/lib/sport-defaults/LeagueCreationInitializer'
import { bootstrapLeagueWaiverSettings } from '@/lib/waiver-defaults/LeagueWaiverBootstrapService'
import { computeNextWaiverRunAtUtc } from '@/lib/waiver-wire/next-waiver-run'

// Monday 2026-10-19 13:00 UTC — one hour after the NBA Monday 12:00 run.
const MONDAY_AFTER_RUN = new Date('2026-10-19T13:00:00Z')

function nextRunFrom(data: Record<string, unknown>) {
  return computeNextWaiverRunAtUtc(MONDAY_AFTER_RUN, {
    processingDayOfWeek: data.processingDayOfWeek as number,
    processingTimeUtc: data.processingTimeUtc as string,
    processingDays: data.processingDays,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.waiverFindUnique.mockResolvedValue(null)
  m.waiverCreate.mockResolvedValue({ id: 'ws' })
  m.leagueUpdate.mockResolvedValue({})
})

describe('LeagueCreationInitializer persists every default processing day', () => {
  async function createFor(sport: string) {
    m.leagueFindUnique.mockResolvedValue({ id: 'L', settings: {}, leagueVariant: null })
    await initializeLeagueWithSportDefaults({ leagueId: 'L', sport })
    expect(m.waiverCreate).toHaveBeenCalledOnce()
    return m.waiverCreate.mock.calls[0][0].data as Record<string, unknown>
  }

  it('NBA: [Mon, Wed, Fri] — the run after Monday is Wednesday, not next Monday', async () => {
    const data = await createFor('NBA')
    expect(data.processingDays).toEqual([1, 3, 5])
    expect(nextRunFrom(data)).toBe('2026-10-21T12:00:00.000Z')
  })

  it('MLB: [Mon, Wed, Fri]', async () => {
    const data = await createFor('MLB')
    expect(data.processingDays).toEqual([1, 3, 5])
    expect(nextRunFrom(data)).toBe('2026-10-21T12:00:00.000Z')
  })

  it('NHL: [Mon, Wed, Fri]', async () => {
    const data = await createFor('NHL')
    expect(data.processingDays).toEqual([1, 3, 5])
  })

  it('NFL: byte-identical — no processingDays key, still Tuesday weekly', async () => {
    const data = await createFor('NFL')
    expect(data).toEqual({
      leagueId: 'L',
      waiverType: 'faab',
      faabBudget: 100,
      processingDayOfWeek: 2,
      processingTimeUtc: '10:00',
      claimLimitPerPeriod: 10,
      tiebreakRule: 'faab_highest',
      lockType: 'game_time',
      instantFaAfterClear: false,
    })
    expect(nextRunFrom(data)).toBe('2026-10-20T10:00:00.000Z')
  })

  it('existing row with a commissioner-chosen day is never given the default list', async () => {
    m.leagueFindUnique.mockResolvedValue({ id: 'L', settings: {}, leagueVariant: null })
    m.waiverFindUnique.mockResolvedValue({
      leagueId: 'L',
      waiverType: 'rolling',
      faabBudget: null,
      processingDayOfWeek: 4,
      processingTimeUtc: '12:00',
      claimLimitPerPeriod: 14,
      tiebreakRule: 'priority_lowest_first',
      lockType: 'first_game',
      instantFaAfterClear: false,
      processingDays: null,
    })
    await initializeLeagueWithSportDefaults({ leagueId: 'L', sport: 'NBA' })
    const patch = m.waiverUpdate.mock.calls[0]?.[0]?.data ?? {}
    expect(patch).not.toHaveProperty('processingDays')
  })
})

describe('LeagueWaiverBootstrapService persists every default processing day', () => {
  async function bootstrapFor(sport: string) {
    m.leagueFindUnique.mockResolvedValue({ id: 'L', sport, leagueVariant: null, settings: {} })
    await bootstrapLeagueWaiverSettings('L')
    expect(m.waiverCreate).toHaveBeenCalledOnce()
    return m.waiverCreate.mock.calls[0][0].data as Record<string, unknown>
  }

  it('NBA create writes [1,3,5] and schedules Wednesday after a Monday run', async () => {
    const data = await bootstrapFor('NBA')
    expect(data.processingDays).toEqual([1, 3, 5])
    expect(nextRunFrom(data)).toBe('2026-10-21T12:00:00.000Z')
  })

  it('NFL create is byte-identical (no processingDays key)', async () => {
    const data = await bootstrapFor('NFL')
    expect(data).not.toHaveProperty('processingDays')
    expect(data.processingDayOfWeek).toBe(2)
    expect(data.instantFaAfterClear).toBe(false)
  })
})
