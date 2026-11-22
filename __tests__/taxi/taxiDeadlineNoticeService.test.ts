/** The hourly taxi deadline notice run (lib/taxi/taxiDeadlineNoticeService.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  enforcement: vi.fn(),
  notify: vi.fn(async () => ({})),
  prisma: {
    $queryRaw: vi.fn(async () => [{ id: 'L' }]),
    league: { findUnique: vi.fn(async () => ({ userId: 'commish', name: 'Dyn' })) },
    redraftRoster: {
      findMany: vi.fn(async () => [
        { ownerId: 'u1', teamName: 'A', players: [{ playerName: 'Rookie One' }] },
        { ownerId: 'u2', teamName: 'B', players: [] },
        { ownerId: 'orphan-1', teamName: 'C', players: [{ playerName: 'Rookie Two' }] },
      ]),
    },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/taxi/taxiRulesService', () => ({ loadTaxiEnforcement: m.enforcement }))

import { runTaxiDeadlineNotices } from '@/lib/taxi/taxiDeadlineNoticeService'

const rules = { lockAfterWeek: 6, promotionDeadlineWeek: 10, lockBehavior: 'once_promoted_no_return', inSeasonMoves: true, postseasonMoves: false }
const season = (currentWeek: number) => ({ id: 'S', season: 2026, status: 'active', currentWeek, playoffStartWeek: 15 })

beforeEach(() => {
  vi.clearAllMocks()
  m.enforcement.mockResolvedValue({ rules, season: season(10) })
})

describe('runTaxiDeadlineNotices', () => {
  it('in the promotion deadline week, tells each owner with taxi players and the commissioner, once each', async () => {
    const r = await runTaxiDeadlineNotices()
    expect(r).toMatchObject({ leagues: 1, notified: 2, failures: [] })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['u1'], category: 'league_announcements', dedupePrefix: 'taxi-deadline:L:S:10:promotion_closes:owner:u1' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['commish'], category: 'commissioner_alerts' }))
    // An orphaned team has nobody to tell.
    expect(m.notify).not.toHaveBeenCalledWith(expect.objectContaining({ userIds: ['orphan-1'] }))
  })

  it('sends nothing in a week with no deadline, or where the rules are not enforced', async () => {
    m.enforcement.mockResolvedValueOnce({ rules, season: season(8) })
    expect((await runTaxiDeadlineNotices()).skipped).toEqual({ no_deadline_this_week: 1 })
    m.enforcement.mockResolvedValueOnce(null)
    expect((await runTaxiDeadlineNotices()).skipped).toEqual({ not_enforced: 1 })
    expect(m.notify).not.toHaveBeenCalled()
  })
})
