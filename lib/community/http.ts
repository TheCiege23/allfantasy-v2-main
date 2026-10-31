import 'server-only'
import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { consumeRateLimit } from '@/lib/rate-limit'
import { CommunityError, getCommunityViewer, type CommunityViewer } from './service'
import { firstIssueMessage } from './validation'

/**
 * The plumbing every Clubhouse route shares: one viewer lookup, one error mapping, one
 * set of burst limits. Routes stay a few lines each, so the rules stay in service.ts.
 */

/**
 * Burst brakes, in-process like every other `consumeRateLimit` caller (a ceiling per
 * instance, not a global guarantee). The durable limit for brand-new accounts is the
 * database count in service.ts.
 */
export const COMMUNITY_RATE_LIMITS = {
  post_create: { maxRequests: 5, windowMs: 10 * 60 * 1000 },
  reply_create: { maxRequests: 20, windowMs: 60 * 1000 },
  reaction: { maxRequests: 60, windowMs: 60 * 1000 },
  report: { maxRequests: 10, windowMs: 10 * 60 * 1000 },
  edit: { maxRequests: 30, windowMs: 10 * 60 * 1000 },
} as const

export type CommunityRateLimitedAction = keyof typeof COMMUNITY_RATE_LIMITS

export function communityRateLimitResponse(
  userId: string,
  action: CommunityRateLimitedAction,
): NextResponse | null {
  const limit = COMMUNITY_RATE_LIMITS[action]
  const rl = consumeRateLimit({
    scope: 'community',
    action,
    sleeperUsername: userId,
    maxRequests: limit.maxRequests,
    windowMs: limit.windowMs,
  })
  if (rl.success) return null
  const retryAfterSec = Math.max(1, rl.retryAfterSec)
  return NextResponse.json(
    { error: "You're going a little fast. Wait a moment and try again.", retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  )
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}))
}

export function parseOr400<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; res: NextResponse } {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, data: parsed.data }
  return { ok: false, res: NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 }) }
}

/**
 * Runs a handler with the viewer resolved, mapping a `CommunityError` to its status and
 * anything else to a bare 500 — an unexpected error's message never reaches the client.
 */
export async function withCommunityViewer(
  handler: (viewer: CommunityViewer) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const viewer = await getCommunityViewer()
    return await handler(viewer)
  } catch (err) {
    if (err instanceof CommunityError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[community] unexpected error', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}

export function requireSignedIn(viewer: CommunityViewer): NextResponse | null {
  return viewer.userId ? null : NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
}
