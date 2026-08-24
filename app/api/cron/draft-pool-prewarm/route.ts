/**
 * Vercel Cron: prewarm DraftPoolCache for all pre_draft/scheduled/paused/in_progress drafts.
 * Runs every 30 minutes so the pool is hot before users open the draft room.
 * Auth: requireCronAuth (CRON_SECRET / LEAGUE_CRON_SECRET).
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { checkDraftPoolCacheFast, ensureDraftPoolReady } from '@/lib/draft-room/ensureDraftPoolReady'
import { runWithConcurrency, withTimeout } from '@/lib/async-utils'

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * ⚠ CONCURRENCY, THE PER-LEAGUE TIMEOUT, AND THE LATEST-START DEADLINE ARE NOT INDEPENDENT.
 *
 * `Promise.all` over every cold league had no per-league bound at all, so ONE stuck league (a
 * hung provider call, a slow write) failed the entire batch: every other league's work was
 * silently discarded when the platform killed the whole function at maxDuration. Measured in
 * production, three runs in a row, right after the fast-tier loop's own 180s client ceiling was
 * removed (which had been hiding this): HTTP 504 / "fetch failed" landing within ~1s of the
 * 300000ms mark every time.
 *
 * PER_LEAGUE_TIMEOUT_MS sits ABOVE the documented normal cost, not below it -- a cold build was
 * already measured at 60-90s even in isolation (see the docblock atop
 * __tests__/draft/pool-prewarm-controls.test.ts, "ensureDraftPoolReady ran a 60-90s synchronous
 * cold build"). A lower number would abort legitimate builds, not just hung ones.
 *
 * LATEST_START_DEADLINE_MS is derived, not guessed: the last league allowed to START must still
 * be able to finish -- or hit its own per-league timeout -- before maxDuration. Once elapsed time
 * passes it, remaining leagues are marked 'deferred' without being attempted; they are picked up
 * on the very next tick (this cron runs every 30 minutes) instead of becoming another 504.
 */
const CONCURRENCY = 3
const PER_LEAGUE_TIMEOUT_MS = 120_000
const RESPONSE_MARGIN_MS = 20_000
const LATEST_START_DEADLINE_MS = maxDuration * 1000 - PER_LEAGUE_TIMEOUT_MS - RESPONSE_MARGIN_MS

async function handle(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessions = await prisma.draftSession.findMany({
    where: { status: { in: ['pre_draft', 'scheduled', 'paused', 'in_progress'] } },
    select: { leagueId: true },
    distinct: ['leagueId'],
  })

  console.info('[draft-pool-prewarm] cron start', { count: sessions.length })
  const t = Date.now()
  const latestStartAt = t + LATEST_START_DEADLINE_MS

  const results = await runWithConcurrency(sessions, CONCURRENCY, async ({ leagueId }: { leagueId: string }) => {
    if (Date.now() > latestStartAt) {
      return { leagueId, action: 'deferred', error: 'past this run’s start deadline; retried next tick' }
    }

    const { warm } = await checkDraftPoolCacheFast(leagueId).catch(() => ({ warm: false }))
    if (warm) return { leagueId, action: 'warm' }

    const outcome = await withTimeout(ensureDraftPoolReady(leagueId), PER_LEAGUE_TIMEOUT_MS)
    if (!outcome.ok) {
      console.warn('[draft-pool-prewarm] league exceeded its per-league timeout, retried next tick', {
        leagueId,
        timeoutMs: PER_LEAGUE_TIMEOUT_MS,
      })
      return { leagueId, action: 'timeout', error: `exceeded ${PER_LEAGUE_TIMEOUT_MS}ms` }
    }

    const result = outcome.value
    return {
      leagueId,
      action: result.ok ? result.source : 'error',
      error: result.ok ? undefined : result.error,
    }
  })

  console.info('[draft-pool-prewarm] cron done', { totalMs: Date.now() - t, results })
  return NextResponse.json({ ok: true, results })
}

export async function GET(req: NextRequest) {
  return handle(req)
}
