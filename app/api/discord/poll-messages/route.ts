import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { runDiscordInboundPass } from '@/lib/discord/inboundPass'
import { DISCORD_INBOUND_SCHEDULED } from '@/lib/discord/inboundStatus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Discord → AllFantasy for every league with two-way switched on.
 *
 * ⚠ NOTHING SCHEDULES THIS ROUTE, and the cron registry is at its ceiling, so do not
 * add an entry for it. The scheduled path is `runDiscordInboundPass` called from an
 * existing frequent cron with its own budget (see `lib/discord/inboundPass.ts`). This
 * route stays as the hand-run / verification entry point, behind the cron secret.
 */
export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report = await runDiscordInboundPass({ budgetMs: 45_000 })
  return NextResponse.json({ ok: true, scheduled: DISCORD_INBOUND_SCHEDULED, ...report })
}
