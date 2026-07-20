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

  const results = await Promise.all(
    sessions.map(async ({ leagueId }: { leagueId: string }) => {
      const { warm } = await checkDraftPoolCacheFast(leagueId).catch(() => ({ warm: false }))
      if (warm) return { leagueId, action: 'warm' }
      const result = await ensureDraftPoolReady(leagueId)
      return {
        leagueId,
        action: result.ok ? result.source : 'error',
        error: result.ok ? undefined : result.error,
      }
    })
  )

  console.info('[draft-pool-prewarm] cron done', { totalMs: Date.now() - t, results })
  return NextResponse.json({ ok: true, results })
}

export async function GET(req: NextRequest) {
  return handle(req)
}
