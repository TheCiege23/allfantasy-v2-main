import { NextResponse } from 'next/server'

import { processExpiredDraftTimersBatch } from '@/lib/live-draft-engine/cron/expiredDraftTimerCron'
import { logStructured } from '@/lib/logging/structured'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = request.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (bearer && bearer === secret) return true

  if (process.env.NODE_ENV !== 'production') {
    const q = new URL(request.url).searchParams.get('secret')
    if (q && q === secret) return true
  }

  return false
}

/**
 * GET /api/cron/draft-expired-timers
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 * Non-production: `?secret=${CRON_SECRET}` for local smoke tests.
 *
 * Advances snake/linear drafts whose pick timers have expired (queue-first / BPA / skip)
 * and auction drafts whose bid/nomination timers have expired — without requiring
 * live-sync or an open browser tab.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    logStructured('warn', 'draft_expired_timer_cron', 'cron_secret_missing', {})
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }

  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Math.min(250, Math.max(1, Number(limitRaw) || 100)) : 100
  const leagueId = url.searchParams.get('leagueId')?.trim()

  if (dryRun) {
    const { discoverExpiredDraftTimerLeagues } = await import('@/lib/live-draft-engine/cron/expiredDraftTimerCron')
    const now = new Date()
    const discovered = await discoverExpiredDraftTimerLeagues(now, { limit })
    return NextResponse.json({
      ok: true,
      dryRun: true,
      now: now.toISOString(),
      discovered: discovered.length,
      leagueIds: leagueId ? [leagueId] : discovered,
    })
  }

  try {
    const batch = await processExpiredDraftTimersBatch({
      now: new Date(),
      limit,
      ...(leagueId ? { leagueIds: [leagueId] } : {}),
    })
    return NextResponse.json({ ok: true, ...batch })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logStructured('error', 'draft_expired_timer_cron', 'cron_route_failed', { message })
    return NextResponse.json({ ok: false, error: 'batch_failed' }, { status: 500 })
  }
}
