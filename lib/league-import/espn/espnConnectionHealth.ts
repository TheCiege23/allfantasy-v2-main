/**
 * ESPN connection health — so expired cookies are a state we RECORD and TELL THE USER ABOUT, not a
 * sync that quietly fails every tick.
 *
 * ESPN cookies end when the user signs out of ESPN in that browser, and nothing announces it. Before
 * this, an import surfaced "reconnect" at the moment it failed, but the background sync logged a
 * failed run and the manager kept looking at a league going stale.
 *
 *   rejected → `connectionStatus = 'needs_reconnect'`, failure stamped, and ONE notification per
 *              outage (`reconnectNotifiedAt`), with a 7-day re-reminder at most;
 *   accepted → back to 'ok' and the notification throttle cleared, so the next outage notifies.
 *
 * ⚠ BEST EFFORT, ALWAYS. These run on the ESPN read path. A failed bookkeeping write must never turn
 * a working import into a failed one, so every function here swallows its own errors.
 * ⚠ It records outcomes only for STORED cookies. Cookies pasted into a form and being tested are not
 * the user's connection yet, and judging the saved row by them would be wrong in both directions.
 */

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

export const ESPN_NEEDS_RECONNECT = 'needs_reconnect'
export const ESPN_CONNECTION_OK = 'ok'

/** Don't write "still fine" more than this often — the read path runs every sync tick. */
const VERIFIED_WRITE_INTERVAL_MS = 60 * 60 * 1000
const RENOTIFY_AFTER_MS = 7 * 24 * 60 * 60 * 1000

type HealthRow = {
  connectionStatus: string | null
  lastVerifiedAt: Date | null
  reconnectNotifiedAt: Date | null
}

type Deps = {
  now?: () => Date
  notify?: typeof dispatchNotification
}

async function readRow(userId: string): Promise<HealthRow | null> {
  return (await prisma.leagueAuth.findUnique({
    where: { userId_platform: { userId, platform: 'espn' } },
    select: { connectionStatus: true, lastVerifiedAt: true, reconnectNotifiedAt: true },
  })) as HealthRow | null
}

/** Stored cookies just worked. */
export async function recordEspnCookiesAccepted(userId: string, deps: Deps = {}): Promise<void> {
  try {
    const now = (deps.now ?? (() => new Date()))()
    const row = await readRow(userId)
    if (!row) return
    const fresh =
      row.connectionStatus === ESPN_CONNECTION_OK &&
      row.lastVerifiedAt != null &&
      now.getTime() - row.lastVerifiedAt.getTime() < VERIFIED_WRITE_INTERVAL_MS
    if (fresh) return
    await prisma.leagueAuth.updateMany({
      where: { userId, platform: 'espn' },
      data: {
        connectionStatus: ESPN_CONNECTION_OK,
        lastVerifiedAt: now,
        lastFailureCode: null,
        reconnectNotifiedAt: null,
      },
    })
  } catch {
    // Bookkeeping only — see header.
  }
}

/** ESPN answered 401/403 to the STORED cookies. */
export async function recordEspnCookiesRejected(userId: string, deps: Deps = {}): Promise<void> {
  try {
    const now = (deps.now ?? (() => new Date()))()
    const row = await readRow(userId)
    if (!row) return
    await prisma.leagueAuth.updateMany({
      where: { userId, platform: 'espn' },
      data: {
        connectionStatus: ESPN_NEEDS_RECONNECT,
        lastFailureAt: now,
        lastFailureCode: 'ESPN_COOKIES_REJECTED',
      },
    })

    const recentlyNotified =
      row.reconnectNotifiedAt != null && now.getTime() - row.reconnectNotifiedAt.getTime() < RENOTIFY_AFTER_MS
    if (recentlyNotified) return

    /* Claim the notification BEFORE sending, so two sync workers racing the same outage send one. */
    const claimed = await prisma.leagueAuth.updateMany({
      where: {
        userId,
        platform: 'espn',
        OR: [{ reconnectNotifiedAt: null }, { reconnectNotifiedAt: { lt: new Date(now.getTime() - RENOTIFY_AFTER_MS) } }],
      },
      data: { reconnectNotifiedAt: now },
    })
    if (claimed.count === 0) return

    await (deps.notify ?? dispatchNotification)({
      userIds: [userId],
      category: 'system_account',
      type: 'espn_reconnect_required',
      title: 'Reconnect ESPN to keep your leagues syncing',
      body:
        'ESPN stopped accepting your saved connection — this happens when you sign out of ESPN in that browser. ' +
        'Your leagues are safe but will not update until you reconnect. It takes about two minutes on a computer.',
      actionHref: '/import?provider=espn',
      actionLabel: 'Reconnect ESPN',
      severity: 'medium',
      dedupePrefix: `espn_reconnect:${now.toISOString().slice(0, 10)}`,
    })
  } catch {
    // Bookkeeping only — see header.
  }
}

/** Fresh cookies were saved: whatever was wrong before no longer applies. */
export function espnHealthResetFields(now: Date = new Date()) {
  return {
    connectionStatus: ESPN_CONNECTION_OK,
    lastVerifiedAt: now,
    lastFailureAt: null,
    lastFailureCode: null,
    reconnectNotifiedAt: null,
  }
}
