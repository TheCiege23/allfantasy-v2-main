import 'server-only'

import { prisma } from '@/lib/prisma'
import { readChatAlertState, type ChatAlertState } from './alertThrottle'

/**
 * Per-(conversation, recipient) alert state, in `SportsDataCache` — no schema change.
 *
 * ⚠ A CLAIM, NOT A READ-THEN-WRITE. Two messages sent in the same second must not both buzz, so
 * the write is a compare-and-swap on the row's `expiresAt`, which changes on every claim:
 *   - no row yet   -> `create`; a unique violation (P2002) means another send claimed it first;
 *   - row exists   -> `updateMany` WHERE expiresAt = the value we read; count 0 means we lost.
 * Losing is not an error — the winner is sending the alert.
 */

export const CHAT_ALERT_STATE_PREFIX = 'chat-notify:v1:'
/** Long enough to outlive the email window with room to spare; the sweep deletes expired rows. */
export const CHAT_ALERT_STATE_TTL_MS = 2 * 24 * 60 * 60 * 1000

export function chatAlertStateKey(scope: string, userId: string): string {
  return `${CHAT_ALERT_STATE_PREFIX}${scope}:${userId}`
}

export type StoredChatAlertState = {
  key: string
  state: ChatAlertState | null
  /** The row's current `expiresAt` — the CAS token. Null when there is no row. */
  token: Date | null
}

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

/** Reads the state. Throws when the store itself is unavailable — the caller decides what that means. */
export async function readStoredChatAlertState(key: string): Promise<StoredChatAlertState> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: key },
    select: { data: true, expiresAt: true },
  })
  if (!row) return { key, state: null, token: null }
  return { key, state: readChatAlertState(row.data), token: row.expiresAt }
}

/** true = we own this alert; false = another send got there first. Throws on a store failure. */
export async function claimChatAlertState(
  stored: StoredChatAlertState,
  next: ChatAlertState,
  now: Date,
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + CHAT_ALERT_STATE_TTL_MS)
  const data = next as unknown as object
  if (!stored.token) {
    try {
      await prisma.sportsDataCache.create({ data: { cacheKey: stored.key, data, expiresAt } })
      return true
    } catch (e) {
      if (prismaCode(e) === 'P2002') return false
      throw e
    }
  }
  const result = await prisma.sportsDataCache.updateMany({
    where: { cacheKey: stored.key, expiresAt: stored.token },
    data: { data, expiresAt },
  })
  return result.count === 1
}
