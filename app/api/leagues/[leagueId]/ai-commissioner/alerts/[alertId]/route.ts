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
import { createSystemMessage } from '@/lib/platform/chat-service'
import { leagueChatThreadIdFromSettings } from '@/lib/league/leagueChatThreadLink'

export const dynamic = 'force-dynamic'

type AlertMutationAction = 'approve' | 'dismiss' | 'snooze' | 'resolve' | 'reopen' | 'send_notice'

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

  if (action === 'send_notice') {
    const [league, alert] = await Promise.all([
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { settings: true },
      }),
      prisma.aiCommissionerAlert.findFirst({
        where: { alertId, leagueId },
      }),
    ])
    if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    // Only a link that passes the one rule (lib/league/leagueChatThreadLink.ts); a DM or huddle is no link.
    const threadId = leagueChatThreadIdFromSettings(leagueId, league?.settings)
    if (!threadId) {
      return NextResponse.json(
        { error: 'League chat thread is not linked (leagueChatThreadId missing).' },
        { status: 400 }
      )
    }
    const sent = await createSystemMessage(
      threadId,
      'commissioner_notice',
      `[AI Commissioner] ${alert.headline}: ${alert.summary}`
    )
    await appendAICommissionerActionLog({
      leagueId,
      sport: alert.sport,
      actionType: 'ALERT_SEND_NOTICE',
      source: 'commissioner_ui',
      summary: `Posted alert ${alert.alertId} to league chat.`,
      relatedAlertId: alert.alertId,
    })
    return NextResponse.json({
      status: sent ? 'sent' : 'failed',
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
