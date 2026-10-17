import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Rolling Insights sends no `img` for college teams and most soccer clubs. The team sync wrote
 * that absence as `logo: null` on every run, so a logo backfilled onto an RI row from
 * TheSportsDB/CFBD (548 rows, 2026-10-01) would be erased on the next sync. A missing badge is
 * not "no logo": only a logo the vendor actually sent may replace the stored one.
 */

const { riFetchRowsMock, upsertMock } = vi.hoisted(() => ({
  riFetchRowsMock: vi.fn(),
  upsertMock: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/workers/providers/rollingInsightsRest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workers/providers/rollingInsightsRest')>()
  return { ...actual, riFetchRows: riFetchRowsMock }
})
vi.mock('@/lib/prisma', () => ({ prisma: { sportsTeam: { upsert: upsertMock } } }))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

type UpsertArgs = { update: Record<string, unknown>; create: Record<string, unknown> }

async function syncOneTeam(team: Record<string, unknown>): Promise<UpsertArgs> {
  riFetchRowsMock.mockResolvedValue({ rows: [team], notModified: false, error: null })
  const { syncRollingInsightsTeamsToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')
  await syncRollingInsightsTeamsToDb({ sport: 'NCAAB' })
  expect(upsertMock).toHaveBeenCalledTimes(1)
  return upsertMock.mock.calls[0]![0] as UpsertArgs
}

describe('RI team sync — stored logos survive a badge-less sync', () => {
  it('does not write logo on update when the vendor sent none', async () => {
    const args = await syncOneTeam({ team_id: '22', team: 'University of Dayton', abbrv: 'DAY' })
    expect('logo' in args.update, 'would null a backfilled logo').toBe(false)
    expect(args.update.name).toBe('University of Dayton')
    // A brand-new row still records the absence honestly.
    expect(args.create.logo).toBeNull()
  })

  it('does write logo when the vendor sent one', async () => {
    const args = await syncOneTeam({ team_id: '22', team: 'University of Dayton', img: 'https://cdn.example/day.svg' })
    expect(args.update.logo).toBe('https://cdn.example/day.svg')
  })
})
