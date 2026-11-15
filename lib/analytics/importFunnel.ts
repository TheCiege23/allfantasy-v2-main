/**
 * The import stages of the acquisition funnel (2026-11-15), through the one funnel emitter
 * (`recordFunnelEvent`) so campaign attribution is attached exactly as it is for signup.
 *
 *   acquisition.import_started    — an import request was accepted: provider chosen and supported,
 *                                   identifier present. Emitted by discover AND preview, because a
 *                                   pasted league id skips discovery.
 *   acquisition.import_completed  — a commit succeeded: a league is on this account.
 *
 * The admin funnel counts DISTINCT users per stage, so retries and multi-league imports never
 * inflate a stage. Best-effort by contract: recordFunnelEvent never throws, and a missing cookie jar
 * (outside a request) records the row with no attribution rather than failing.
 */
import { cookies } from 'next/headers'

import { recordFunnelEvent } from '@/lib/analytics/recordFunnelEvent'
import { ACQUISITION } from '@/lib/analytics/eventNames'

/** `cookies()` throws SYNCHRONOUSLY outside a request scope, so a `.catch` alone would not hold. */
async function cookieGetter(): Promise<(name: string) => string | undefined> {
  try {
    const jar = await cookies()
    return (name) => jar.get(name)?.value
  } catch {
    return () => undefined
  }
}

export async function recordImportStarted(userId: string, provider: string, step: 'discover' | 'preview'): Promise<void> {
  try {
    await recordFunnelEvent({ event: ACQUISITION.IMPORT_STARTED, userId, getCookie: await cookieGetter(), meta: { provider, step } })
  } catch {
    // Never reaches the import: analytics is best-effort.
  }
}

export type ImportCompletedOutcome = 'imported' | 'joined_existing' | 'already_imported'

export function importCompletedOutcome(r: { existed: boolean; joinedExisting: boolean }): ImportCompletedOutcome {
  return r.existed ? 'already_imported' : r.joinedExisting ? 'joined_existing' : 'imported'
}

export async function recordImportCompleted(
  userId: string,
  provider: string,
  r: { existed: boolean; joinedExisting: boolean },
): Promise<void> {
  try {
    await recordFunnelEvent({
      event: ACQUISITION.IMPORT_COMPLETED,
      userId,
      getCookie: await cookieGetter(),
      meta: { provider, outcome: importCompletedOutcome(r) },
    })
  } catch {
    // Never fails the import that just succeeded.
  }
}
