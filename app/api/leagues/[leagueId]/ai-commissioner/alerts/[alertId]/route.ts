import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import {
  appendAICommissionerActionLog,
  toAlertView,
  updateAICommissionerAlertStatus,
} from '@/lib/ai-commissioner'
import { chimmyDayKey, postChimmyMoment, type ChimmyMomentSkipReason } from '@/lib/league-chat/chimmyMoments'
import { commissionerNoticeText } from '@/lib/league-chat/chimmyCommissionerNotices'

export const dynamic = 'force-dynamic'

type AlertMutationAction = 'approve' | 'dismiss' | 'snooze' | 'resolve' | 'reopen' | 'send_notice'

/** Why a notice did not post, in words the commissioner can act on. */
const NOTICE_REFUSALS: Record<ChimmyMomentSkipReason, { status: number; error: string }> = {
  duplicate: { status: 409, error: 'That notice is already in league chat today.' },
  disabled: {
    status: 409,
    error: 'Chimmy is switched off for this league. Turn on "Chimmy speaks up in league chat" under Automations to post notices.',
  },
  daily_cap: { status: 429, error: 'League chat has had enough from Chimmy today. Try again tomorrow.' },
  invalid: { status: 400, error: 'That notice has nothing to post.' },
  no_league: { status: 404, error: 'League not found.' },
  error: { status: 502, error: 'Could not post the notice. Try again.' },
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ leagueId: string; alertId: string }> }
) {
  const { leagueId, alertId } = await ctx.params
  if (!leagueId || !alertId) {
    return NextResponse.json({ error: 'Missing leagueId or alertId' }, { status: 400 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    action: AlertMutationAction
    snoozeHours: number
  }>
  const action = String(body.action ?? '').trim().toLowerCase() as AlertMutationAction
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 })

  /*
   * 🛑 "SEND NOTICE" USED TO GO NOWHERE. It posted into a platform thread named by
   * `League.settings.leagueChatThreadId`, which nothing ever sets (0 of 390 leagues), so every press
   * answered "League chat thread is not linked" — and a failed post still came back 200. It now posts
   * into the league's OWN chat, as Chimmy (lib/league-chat/chimmyMoments.ts): Chimmy's name and
   * badge, no "AI" label, once per alert per day. A commissioner pressed the button, so it skips the
   * daily cap; it still respects "Chimmy speaks up" being switched off, and says so.
   */
  if (action === 'send_notice') {
    const alert = await prisma.aiCommissionerAlert.findFirst({ where: { alertId, leagueId } })
    if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    const now = new Date()
    const posted = await postChimmyMoment({
      leagueId,
      kind: 'commissioner_notice',
      dedupeKey: `alert:${alert.alertId}:${chimmyDayKey(now)}`,
      text: commissionerNoticeText(alert),
      card: { commissionerNotice: { alertType: alert.alertType, severity: alert.severity } },
      now,
    })
    if (!posted.posted) {
      const refusal = NOTICE_REFUSALS[posted.reason]
      return NextResponse.json({ status: 'failed', reason: posted.reason, error: refusal.error }, { status: refusal.status })
    }
    await appendAICommissionerActionLog({
      leagueId,
      sport: alert.sport,
      actionType: 'ALERT_SEND_NOTICE',
      source: 'commissioner_ui',
      summary: `Posted alert ${alert.alertId} to league chat.`,
      relatedAlertId: alert.alertId,
    })
    return NextResponse.json({
      status: 'sent',
      messageId: posted.messageId,
      alert: toAlertView(alert),
    })
  }

  if (!['approve', 'dismiss', 'snooze', 'resolve', 'reopen'].includes(action)) {
    return NextResponse.json(
      { error: 'Invalid action. Use approve, dismiss, snooze, resolve, reopen, send_notice.' },
      { status: 400 }
    )
  }

  const updated = await updateAICommissionerAlertStatus({
    leagueId,
    alertId,
    action: action as 'approve' | 'dismiss' | 'snooze' | 'resolve' | 'reopen',
    source: 'commissioner_ui',
    snoozeHours:
      typeof body.snoozeHours === 'number' && Number.isFinite(body.snoozeHours)
        ? body.snoozeHours
        : undefined,
  })
  return NextResponse.json(updated)
}
