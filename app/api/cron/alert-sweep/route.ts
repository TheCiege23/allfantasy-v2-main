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
import { getBaseUrl } from '@/lib/get-base-url'
import { renderInjuryEmail } from '@/lib/notifications/injuryEmail'
import { fetchSleeperStatuses } from '@/lib/autocoach/status-sources/SleeperStatusAdapter'
import { detectInjuredStarterAlerts } from '@/lib/chimmy-alerts/ChimmyAlertDetectors'
import { hydrateInjuredStarters } from '@/lib/chimmy-alerts/hydrateInjuredStarters'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { sendPushToUser } from '@/lib/push-notifications'
import type { ChimmyAlertContext } from '@/lib/chimmy-alerts/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Game-window Sleeper status fold.
 *
 * `SleeperStatusAdapter` and the playerGameLock engine otherwise run only in
 * the AutoCoach worker, which nothing schedules — so this sweep's
 * injured-starter detection ran purely on the 15-minute Rolling Insights
 * ingest. This folds a bounded read of Sleeper's live `injury_status` blob
 * into `SportsInjury` (source `sleeper_live`, short TTL) so the canonical
 * injury read port — the sweep's actual injury source via
 * `assembleCrossLeaguePlayerPortfolio` → `resolveInjuryFacts` — sees fresh
 * game-day designations: the port picks the freshest row per player, so a
 * just-fetched live status wins for the rest of the window and expires on
 * its own afterwards.
 *
 * Bounded on purpose: NFL only (the sweep hydrates NFL), Out/Doubtful only
 * (the designations that actually move inside a game window — IR and
 * suspensions are slow-moving and already carried by the RI ingest), capped
 * row count, no-op outside game windows, and the adapter caches the blob.
 */
const LIVE_FOLD_TIMEOUT_MS = 8_000
const LIVE_FOLD_MAX_ROWS = 400
const LIVE_STATUS_TTL_MS = 6 * 60 * 60 * 1000
const LIVE_STATUS_SOURCE = 'sleeper_live'
const LIVE_URGENT_STATUSES = new Set(['out', 'doubtful'])
const GAME_WINDOW_HOURS = 8

async function foldLiveSleeperStatusesForGameWindow(now: Date): Promise<void> {
  const gamesInWindow = await prisma.sportsGame.count({
    where: {
      sport: 'NFL',
      startTime: {
        gte: new Date(now.getTime() - GAME_WINDOW_HOURS * 60 * 60 * 1000),
        lte: new Date(now.getTime() + GAME_WINDOW_HOURS * 60 * 60 * 1000),
      },
    },
  })
  if (gamesInWindow === 0) return

  const statuses = await fetchSleeperStatuses('nfl')
  const urgent: Array<{ externalId: string; status: string }> = []
  for (const [externalId, status] of statuses) {
    if (!LIVE_URGENT_STATUSES.has(status.trim().toLowerCase())) continue
    urgent.push({ externalId, status: status.trim() })
    if (urgent.length >= LIVE_FOLD_MAX_ROWS) break
  }

  // A player who recovered must not keep an old live row outranking the feed —
  // clear live rows the current blob no longer marks urgent.
  await prisma.sportsInjury.deleteMany({
    where: {
      sport: 'NFL',
      source: LIVE_STATUS_SOURCE,
      ...(urgent.length > 0 ? { externalId: { notIn: urgent.map((u) => u.externalId) } } : {}),
    },
  })
  if (urgent.length === 0) return

  const meta = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', externalId: { in: urgent.map((u) => u.externalId) } },
    select: { externalId: true, name: true, team: true, position: true },
  })
  const metaById = new Map(meta.map((m) => [m.externalId, m]))
  const expiresAt = new Date(now.getTime() + LIVE_STATUS_TTL_MS)

  for (const u of urgent) {
    const m = metaById.get(u.externalId)
    // No identity, no claim — a row the port would bind by a wrong or empty
    // name is worse than no row.
    if (!m?.name?.trim()) continue
    await prisma.sportsInjury.upsert({
      where: {
        sport_externalId_source: { sport: 'NFL', externalId: u.externalId, source: LIVE_STATUS_SOURCE },
      },
      create: {
        sport: 'NFL',
        externalId: u.externalId,
        playerName: m.name,
        playerId: u.externalId,
        team: m.team,
        position: m.position,
        status: u.status,
        source: LIVE_STATUS_SOURCE,
        fetchedAt: now,
        expiresAt,
      },
      update: {
        playerName: m.name,
        team: m.team,
        position: m.position,
        status: u.status,
        fetchedAt: now,
        expiresAt,
      },
    })
  }
}

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
    // Game-window fold FIRST, so this very sweep evaluates against the fresh
    // statuses. Error-swallowed and time-boxed: Sleeper being slow or down must
    // never stop the sweep itself (the race leaves a late fold to finish in the
    // background; the sweep proceeds on whatever the port already has).
    await Promise.race([
      foldLiveSleeperStatusesForGameWindow(new Date()).catch((err) => {
        console.warn(
          '[cron/alert-sweep] live status fold skipped:',
          err instanceof Error ? err.message : String(err),
        )
      }),
      new Promise<void>((resolve) => setTimeout(resolve, LIVE_FOLD_TIMEOUT_MS)),
    ])

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

        // Send only the most urgent alert per sweep. A burst of six notifications for six
        // leagues is how someone turns notifications off permanently.
        const top = [...alerts].sort((a, b) => b.urgencySignal - a.urgencySignal)[0]!

        /*
         * The email lists EVERY flagged starter, not just `top`. A phone
         * banner has room for one sentence; an email does not have that
         * constraint, and a manager with three starters out is badly served by
         * an email about one of them — the other two are the ones he misses.
         */
        const injuryEmail = renderInjuryEmail({
          alerts: alerts.map((a) => ({
            title: a.title,
            message: a.message,
            leagueId: a.leagueId ?? null,
          })),
          baseUrl: getBaseUrl(),
        })

        /*
         * In-app row first, so the bell and the notifications centre carry the
         * alert even when push is unconfigured or the subscription has gone
         * stale. The UTC-day bucket in the dedupe prefix keeps a 15-minute
         * cadence from writing 96 rows for the same injury.
         *
         * ⚠ EMAIL IS NO LONGER SKIPPED. It was, on the reasoning that this
         * sweep never promised one — but the effect was that an injured
         * starter, the single most time-critical thing this product knows,
         * had no email at all while digests and trade alerts did. The dedupe
         * prefix is what makes it safe at a 15-minute cadence: one send per
         * league per day, not ninety-six.
         *
         * It rides `emailOverride` deliberately. The dispatcher's default
         * sender strips its own HTML — every tag replaced with a space — so
         * anything designed must come through the override, which is the only
         * path to sendTemplatedEmail. SMS and push stay skipped: the targeted
         * push below is the only push, and SMS is not configured.
         */
        await dispatchNotification({
          userIds: [sub.userId],
          category: 'injury_alerts',
          productType: 'app',
          type: 'chimmy_alert',
          title: top.title,
          body: top.message,
          actionHref: top.leagueId ? `/league/${top.leagueId}` : '/my-players',
          actionLabel: 'Set lineup',
          leagueId: top.leagueId ?? null,
          severity: top.urgencySignal >= 78 ? 'high' : 'medium',
          meta: { chimmyAlert: true, class: top.class, alertType: top.type, ...(top.metadata ?? {}) },
          dedupePrefix: `injured-starter:${top.leagueId ?? 'all'}:${new Date().toISOString().slice(0, 10)}`,
          skipChannels: { email: injuryEmail == null, sms: true, push: true },
          ...(injuryEmail ? { emailOverride: injuryEmail } : {}),
        })

        if (!pushConfigured) {
          result.errors.push('push not configured')
          results.push(result)
          continue
        }

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
