import { NextRequest, NextResponse } from 'next/server'

import { withApiUsage } from '@/lib/telemetry/usage'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { normalizeSleeperUsername } from '@/lib/sleeper-check/username'
import { runSleeperCheck } from '@/lib/sleeper-check/sleeperCheck'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sleeper-check — the public (no-account) lookup behind `/check`.
 *
 * ⚠ UNAUTHENTICATED ON PURPOSE, SO EVERY GUARD HERE IS LOAD-BEARING. The same two bot checks as the
 * guest import (`server/api-route-modules/legacy/guest-import`) — a hidden honeypot field and a
 * minimum fill time — then per-visitor limits, BEFORE any Sleeper read. The module behind it caps
 * league reads per instance; see `lib/sleeper-check/sleeperCheck.ts`.
 *
 * The limiter is in-process (`lib/rate-limit.ts`), so the numbers are per instance. That is the
 * same limiter every other public route here relies on.
 */

const MIN_HUMAN_FILL_TIME_MS = 1200

const NO_STORE = { 'Cache-Control': 'no-store' }

function reject(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status, headers: NO_STORE })
}

export const POST = withApiUsage({ endpoint: '/api/sleeper-check', tool: 'SleeperCheck' })(async (request: NextRequest) => {
  let body: Record<string, unknown> = {}
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return reject(400, 'BAD_REQUEST', 'Send a Sleeper username.')
  }

  // Honeypot: a hidden field a person never fills in.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return reject(400, 'REJECTED', 'Request rejected.')
  }
  // A form submitted faster than a person can type. Absent (a shared link that runs on load) is allowed.
  const renderedAt = body.form_rendered_at
  if (typeof renderedAt === 'number' && Number.isFinite(renderedAt)) {
    const elapsed = Date.now() - renderedAt
    if (elapsed >= 0 && elapsed < MIN_HUMAN_FILL_TIME_MS) return reject(400, 'REJECTED', 'Request rejected.')
  }

  const username = normalizeSleeperUsername(body.username)
  if (!username) return reject(400, 'INVALID_USERNAME', 'That does not look like a Sleeper username.')

  const ip = getClientIp(request)
  const perIp = consumeRateLimit({
    scope: 'sleeper_check',
    action: 'lookup_ip',
    sleeperUsername: null,
    ip,
    maxRequests: 12,
    windowMs: 10 * 60_000,
    includeIpInKey: true,
  })
  if (!perIp.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many lookups from this connection. Try again in a few minutes.', rl: perIp }), {
      status: 429,
      headers: NO_STORE,
    })
  }
  const perUser = consumeRateLimit({
    scope: 'sleeper_check',
    action: 'lookup_user',
    sleeperUsername: username.toLowerCase(),
    ip,
    maxRequests: 4,
    windowMs: 5 * 60_000,
    includeIpInKey: true,
  })
  if (!perUser.success) {
    return NextResponse.json(buildRateLimit429({ message: 'You just checked this account. Rosters refresh every few minutes.', rl: perUser }), {
      status: 429,
      headers: NO_STORE,
    })
  }

  const result = await runSleeperCheck(username)
  if (result.status === 'not_found') return reject(404, 'NOT_FOUND', `No Sleeper account named "${username}".`)
  if (result.status === 'unavailable') return reject(503, 'SLEEPER_UNAVAILABLE', 'Sleeper is not answering right now. Try again in a minute.')
  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
})
