// @vitest-environment node
/**
 * Transfer-portal moves for college players (lib/devy/portalMoves.ts, lib/devy/portalMoveAlerts.ts):
 * one honest line on the player card, and an alert to managers who hold the player's devy rights when
 * the portal list shows something NEW. Rows mirror production DevyPlayer rows read 2026-11-25.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  rights: [] as Array<Record<string, unknown>>,
  users: [] as string[],
  dispatch: vi.fn(async (_input: Record<string, unknown>) => ({ delivered: 1 })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyRights: { findMany: vi.fn(async () => m.rights) },
    appUser: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => m.users.includes(id)).map((id) => ({ id }))) },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))

import { describeCollegeTransfer, portalMoveAlert, portalMoveFor } from '@/lib/devy/portalMoves'
import { notifyPortalMoves } from '@/lib/devy/portalMoveAlerts'

describe('the player card line', () => {
  it('says where he went, in which portal, and whether he can play right away', () => {
    expect(describeCollegeTransfer({ transferStatus: true, transferFromSchool: 'Auburn', transferToSchool: 'Texas', transferEligibility: 'Immediate' }, 2026))
      .toBe('Transferred from Auburn to Texas (2026 portal), eligible right away')
  })

  it('says plainly when he has no new school yet', () => {
    expect(describeCollegeTransfer({ transferStatus: true, transferFromSchool: 'Louisville', transferToSchool: null, transferEligibility: 'Immediate' }, 2026))
      .toBe('Entered the 2026 portal from Louisville, no new school yet, eligible right away')
  })

  it('shows nothing for a player with no move on record', () => {
    expect(describeCollegeTransfer({ transferStatus: false, transferFromSchool: 'Auburn' }, 2026)).toBeNull()
    expect(describeCollegeTransfer({ transferStatus: true }, 2026)).toBeNull()
  })
})

describe('what counts as news', () => {
  const stored = { id: 'd1', name: 'Cam Coleman', position: 'WR', transferStatus: true, transferFromSchool: 'Auburn', transferToSchool: 'Texas' }

  it('the same move read again is not news, so switching alerts on replays nothing', () => {
    expect(portalMoveFor(stored, { origin: 'Auburn', destination: 'Texas', eligibility: 'Immediate' })).toBeNull()
  })

  it('a player with no move on record entering the portal is news', () => {
    expect(portalMoveFor({ id: 'd2', name: 'Isaac Brown', position: 'RB', transferStatus: false }, { origin: 'Louisville', destination: null }))
      .toMatchObject({ kind: 'entered', from: 'Louisville', to: null })
  })

  it('a destination appearing is news', () => {
    expect(portalMoveFor({ ...stored, transferToSchool: null }, { origin: 'Auburn', destination: 'Texas' }))
      .toMatchObject({ kind: 'committed', to: 'Texas' })
  })

  it('a second transfer, from the school he moved to, is news', () => {
    expect(portalMoveFor(stored, { origin: 'Texas', destination: null })).toMatchObject({ kind: 'entered', from: 'Texas' })
  })

  it('an entry without a school is ignored', () => {
    expect(portalMoveFor(stored, { origin: null })).toBeNull()
  })

  it('reads as Chimmy, never "AI"', () => {
    const alert = portalMoveAlert({ devyPlayerId: 'd1', name: 'Cam Coleman', position: 'WR', kind: 'committed', from: 'Auburn', to: 'Texas', eligibility: 'Immediate' })
    expect(alert.title).toBe('Portal move: Cam Coleman is headed to Texas')
    expect(alert.body).toBe('Chimmy: Cam Coleman (WR), on your devy roster, is transferring from Auburn to Texas, eligible right away.')
    expect(`${alert.title} ${alert.body}`).not.toMatch(/\bAI\b/)
  })
})

describe('notifyPortalMoves', () => {
  const move = { devyPlayerId: 'd1', name: 'Cam Coleman', position: 'WR', kind: 'committed' as const, from: 'Auburn', to: 'Texas', eligibility: 'Immediate' }

  beforeEach(() => {
    m.dispatch.mockClear()
    m.users = ['u-ann', 'u-ben']
    m.rights = [
      { devyPlayerId: 'd1', state: 'NCAA_DEVY_ACTIVE', leagueId: 'L1', roster: { platformUserId: 'u-ann', managerUserId: null } },
      { devyPlayerId: 'd1', state: 'NCAA_DEVY_TAXI', leagueId: 'L2', roster: { platformUserId: 'team-key', managerUserId: 'u-ben' } },
      { devyPlayerId: 'd1', state: 'PROMOTED_TO_PRO', leagueId: 'L3', roster: { platformUserId: 'u-cal', managerUserId: null } },
      { devyPlayerId: 'd1', state: 'NCAA_DEVY_ACTIVE', leagueId: 'L4', roster: { platformUserId: 'sleeper:999', managerUserId: null } },
    ]
  })

  it('tells each manager holding his rights, once per league, and nobody whose rights ended or who has no account', async () => {
    expect(await notifyPortalMoves([move])).toEqual({ notified: 2 })
    expect(m.dispatch.mock.calls.map(([c]) => [(c as { userIds: string[] }).userIds[0], (c as { leagueId: string }).leagueId])).toEqual([['u-ann', 'L1'], ['u-ben', 'L2']])
    expect(m.dispatch.mock.calls[0]![0]).toMatchObject({ category: 'ai_alerts', type: 'devy_portal_move', dedupePrefix: 'devy-portal:L1:d1:committed:Texas' })
  })

  it('does nothing without moves', async () => {
    expect(await notifyPortalMoves([])).toEqual({ notified: 0 })
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})
