// @vitest-environment node
/**
 * ESPN connection health: expired cookies are recorded and the user is told ONCE per outage, a
 * working read clears it, and none of this can break the read it rides on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, notify } = vi.hoisted(() => ({
  prismaMock: {
    leagueAuth: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  notify: vi.fn(async () => ({ requested: 1, suppressed: 0, delivered: 1, failed: 0 })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: notify }))

import {
  ESPN_CONNECTION_OK,
  ESPN_NEEDS_RECONNECT,
  espnHealthResetFields,
  recordEspnCookiesAccepted,
  recordEspnCookiesRejected,
} from '@/lib/league-import/espn/espnConnectionHealth'

const NOW = new Date('2026-11-08T12:00:00Z')
const now = () => NOW

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.leagueAuth.updateMany.mockResolvedValue({ count: 1 })
})

describe('recordEspnCookiesRejected', () => {
  it('marks the connection as needing reconnection and notifies the user once', async () => {
    prismaMock.leagueAuth.findUnique.mockResolvedValue({ connectionStatus: 'ok', lastVerifiedAt: null, reconnectNotifiedAt: null })
    await recordEspnCookiesRejected('u1', { now })

    expect(prismaMock.leagueAuth.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', platform: 'espn' },
      data: { connectionStatus: ESPN_NEEDS_RECONNECT, lastFailureAt: NOW, lastFailureCode: 'ESPN_COOKIES_REJECTED' },
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      userIds: ['u1'],
      category: 'system_account',
      type: 'espn_reconnect_required',
      actionHref: '/import?provider=espn',
    })
  })

  it('does not notify again inside the re-reminder window', async () => {
    prismaMock.leagueAuth.findUnique.mockResolvedValue({
      connectionStatus: ESPN_NEEDS_RECONNECT,
      lastVerifiedAt: null,
      reconnectNotifiedAt: new Date('2026-11-07T12:00:00Z'),
    })
    await recordEspnCookiesRejected('u1', { now })
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not notify when a concurrent worker already claimed the notification', async () => {
    prismaMock.leagueAuth.findUnique.mockResolvedValue({ connectionStatus: 'ok', lastVerifiedAt: null, reconnectNotifiedAt: null })
    prismaMock.leagueAuth.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    await recordEspnCookiesRejected('u1', { now })
    expect(notify).not.toHaveBeenCalled()
  })

  it('does nothing for a user with no stored ESPN connection', async () => {
    prismaMock.leagueAuth.findUnique.mockResolvedValue(null)
    await recordEspnCookiesRejected('u1', { now })
    expect(prismaMock.leagueAuth.updateMany).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('never throws — bookkeeping cannot break the ESPN read', async () => {
    prismaMock.leagueAuth.findUnique.mockRejectedValue(new Error('db down'))
    await expect(recordEspnCookiesRejected('u1', { now })).resolves.toBeUndefined()
  })
})

describe('recordEspnCookiesAccepted', () => {
  it('clears a needs-reconnect state and the notification throttle', async () => {
    prismaMock.leagueAuth.findUnique.mockResolvedValue({
      connectionStatus: ESPN_NEEDS_RECONNECT,
      lastVerifiedAt: null,
      reconnectNotifiedAt: new Date('2026-11-01T00:00:00Z'),
    })
    await recordEspnCookiesAccepted('u1', { now })
    expect(prismaMock.leagueAuth.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', platform: 'espn' },
      data: { connectionStatus: ESPN_CONNECTION_OK, lastVerifiedAt: NOW, lastFailureCode: null, reconnectNotifiedAt: null },
    })
  })

  it('skips the write when it was verified within the last hour', async () => {
    prismaMock.leagueAuth.findUnique.mockResolvedValue({
      connectionStatus: ESPN_CONNECTION_OK,
      lastVerifiedAt: new Date('2026-11-08T11:30:00Z'),
      reconnectNotifiedAt: null,
    })
    await recordEspnCookiesAccepted('u1', { now })
    expect(prismaMock.leagueAuth.updateMany).not.toHaveBeenCalled()
  })
})

describe('espnHealthResetFields', () => {
  it('resets every health column when fresh cookies are saved', () => {
    expect(espnHealthResetFields(NOW)).toEqual({
      connectionStatus: ESPN_CONNECTION_OK,
      lastVerifiedAt: NOW,
      lastFailureAt: null,
      lastFailureCode: null,
      reconnectNotifiedAt: null,
    })
  })
})
