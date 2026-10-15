import 'server-only'

import { beginWeeklyXConnection, publishWeeklyXPost, weeklyXStatus, WeeklyXError } from '@/lib/core-app/weeklyXPublishing'
import { xLength } from '@/lib/social-newsroom/postBuilder'

/**
 * One-tap "Post to X" for the social newsroom.
 *
 * It posts to the AllFantasy BRAND X account: a connection of its own (`authAccount` provider
 * `x-brand-newsroom`), made from the newsroom's "Connect AllFantasy X" button through the same X
 * OAuth app as the weekly recaps. It is kept apart from the admin's personal weekly-recap
 * connection (`x-weekly-publish`) on purpose: connecting the brand account must never re-point
 * the personal one, and vice versa. The button still names the handle, because the brand
 * connection is whichever X account was signed in on x.com when it was made.
 *
 * Nothing here runs on a schedule. A post leaves only when an admin taps the button and confirms.
 *
 * Idempotent per `requestId`: the browser makes one id per post box, so a double tap or a retry
 * after a timeout returns the first tweet rather than posting twice (publishWeeklyXPost's ledger).
 */

export const X_POST_LIMIT = 280
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type NewsroomXResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * X counts every link as 23 characters, so a headline-plus-link post can be over 280 raw
 * characters and still fit. The weekly route's own check (`text.length <= 280`) would refuse
 * those, which is why the newsroom validates with xLength instead.
 */
export function validNewsroomXPost(requestId: unknown, text: unknown): string | null {
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return 'Invalid request id.'
  if (typeof text !== 'string' || !text.trim()) return 'The post is empty.'
  if (text.length > 4000) return 'The post is too long for X.'
  const len = xLength(text.trim())
  if (len > X_POST_LIMIT) return `The post is ${len}/${X_POST_LIMIT} characters. Shorten it first.`
  return null
}

const ERROR_TEXT: Record<string, string> = {
  reconnect: 'The AllFantasy X connection expired. Use "Change account" to reconnect it, then try again.',
  not_configured: 'X posting is not configured on this server.',
  request_changed: 'This post was already sent with different text. Reload the page.',
  post_failed: 'X refused this post (it may be a duplicate of a recent tweet).',
  publication_unknown: 'X did not confirm the post. Check your X profile before trying again.',
}

export async function postNewsroomX(userId: string, requestId: string, text: string): Promise<NewsroomXResult> {
  const invalid = validNewsroomXPost(requestId, text)
  if (invalid) return { ok: false, error: invalid }
  try {
    const { url } = await publishWeeklyXPost(userId, { requestId, text: text.trim() }, 'brand')
    return { ok: true, url }
  } catch (err) {
    if (err instanceof WeeklyXError) return { ok: false, error: ERROR_TEXT[err.code] ?? `X posting failed (${err.code}).` }
    console.error('[newsroom-x] post failed:', err instanceof Error ? err.message : 'unknown')
    return { ok: false, error: 'X posting failed. Try again in a minute.' }
  }
}

/** The brand X account a newsroom post would go to, or null when none is connected. */
export async function newsroomXAccount(userId: string | null): Promise<{ handle: string } | null> {
  if (!userId) return null
  try {
    const status = await weeklyXStatus(userId, 'brand')
    return status.configured && status.connected && status.handle ? { handle: status.handle } : null
  } catch {
    return null
  }
}

/** Start connecting the brand X account. Returns X's consent URL; the callback comes back to the newsroom. */
export async function beginNewsroomXConnection(userId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    return { ok: true, url: await beginWeeklyXConnection(userId, null, 'brand') }
  } catch (err) {
    if (err instanceof WeeklyXError) return { ok: false, error: ERROR_TEXT[err.code] ?? `Could not start the X connection (${err.code}).` }
    return { ok: false, error: 'Could not start the X connection.' }
  }
}
