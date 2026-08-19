/**
 * GET/POST /api/cron/alert-sweep
 *
 * The scheduled evaluation that makes alerts reach people. Until this existed,
 * `runUnifiedAlertEngine` had exactly one caller — `/api/ai/alerts`, fetched by a React
 * component — so the platform was pull-only and could never notify a manager who had not
 * opened the app. That is the whole gap between "the system knows your starter is out" and
 * "you find out before kickoff".
 *
 * SCOPE IS DELIBERATELY NARROW. It sweeps only users who have a push subscription, because
 * evaluating users who cannot be reached is pure cost. Everyone else still gets the same
 * alerts in-app via /api/ai/alerts, unchanged.
 *
 * Query params:
 *   dryRun=1     evaluate and report without sending
 *   limit=N      cap users processed this run (default 200)
 *   userId=...   evaluate a single user, for verification
 *
 * FAILS LOUDLY on a systemic error (no push configured, sweep threw). It does NOT fail when
 * zero alerts are found — on a Tuesday in the off-season that is the correct outcome, and a
 * cron that 500s daily for being correct is one nobody reads.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { detectInjuredStarterAlerts } from '@/lib/chimmy-alerts/ChimmyAlertDetectors'
import { hydrateInjuredStarters } from '@/lib/chimmy-alerts/hydrateInjuredStarters'
import { sendPushToUser } from '@/lib/push-notifications'
import type { ChimmyAlertContext } from '@/lib/chimmy-alerts/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface SweepUserResult {
  userId: string
  injuredStarters: number
  alerts: number
  pushed: number
  errors: string[]
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dryRun') ?? '').toLowerCase())
  const singleUser = url.searchParams.get('userId')
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 200

  const startedAt = Date.now()
  const pushConfigured = Boolean(
    process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim(),
  )

  try {
    // Only users we can actually reach. A subscription row is the proof of reachability —
    // permission granted, endpoint stored, and not yet expired.
    const subscribers = singleUser
      ? [{ userId: singleUser }]
      : await prisma.webPushSubscription.findMany({
          select: { userId: true },
          distinct: ['userId'],
          take: limit,
        })

    const results: SweepUserResult[] = []
    let totalPushed = 0
    let totalAlerts = 0

    for (const sub of subscribers) {
      const result: SweepUserResult = { userId: sub.userId, injuredStarters: 0, alerts: 0, pushed: 0, errors: [] }
      try {
        const signal = await hydrateInjuredStarters({ appUserId: sub.userId })
        result.injuredStarters = signal.injuredStarters.length
        if (signal.injuredStarters.length === 0) {
          results.push(result)
          continue
        }

        // `lineupLockAt` is intentionally left undefined for now: no durable per-league lock
        // time is populated yet. The detector handles that by scoring at a lower, non-zero
        // urgency rather than refusing — a manager should still be told his starter is out
        // even when we cannot say exactly how long he has.
        const context = {
          now: new Date(),
          signalBundle: { injuredStarters: signal.injuredStarters },
        } as unknown as ChimmyAlertContext

        const alerts = detectInjuredStarterAlerts(context)
        result.alerts = alerts.length
        totalAlerts += alerts.length

        if (dryRun || alerts.length === 0) {
          results.push(result)
          continue
        }
        if (!pushConfigured) {
          result.errors.push('push not configured')
          results.push(result)
          continue
        }

        // Send only the most urgent alert per sweep. A burst of six notifications for six
        // leagues is how someone turns notifications off permanently.
        const top = [...alerts].sort((a, b) => b.urgencySignal - a.urgencySignal)[0]!
        const sent = await sendPushToUser(sub.userId, {
          title: top.title,
          body: top.message,
          href: top.leagueId ? `/league/${top.leagueId}` : '/my-players',
          tag: `injured-starter:${top.leagueId ?? 'all'}`,
          type: 'lineup',
          leagueId: top.leagueId ?? null,
        })
        const okCount = sent.filter((s) => s.ok).length
        result.pushed = okCount
        totalPushed += okCount
        if (okCount === 0 && sent.length > 0) {
          result.errors.push(sent[0]?.error ?? 'push failed')
        }
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message.slice(0, 160) : String(err))
      }
      results.push(result)
    }

    const withErrors = results.filter((r) => r.errors.length > 0)

    return NextResponse.json({
      // Zero alerts is a legitimate outcome (off-season, healthy rosters) and must not fail.
      ok: true,
      dryRun,
      pushConfigured,
      usersScanned: results.length,
      usersWithInjuredStarters: results.filter((r) => r.injuredStarters > 0).length,
      alertsDetected: totalAlerts,
      pushesSent: totalPushed,
      usersWithErrors: withErrors.length,
      errors: withErrors.slice(0, 10).map((r) => ({ userId: r.userId, errors: r.errors })),
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/alert-sweep] failed:', message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}
