/**
 * GET: The live rookie draft order — every slot locked or provisional, with the reason it landed
 *      there. FREE: any commissioner can calculate it on demand. `?nonPlayoff=&playoff=&withinRound=`
 *      previews other settings without saving them.
 * PUT: Turn automation on/off and save the ordering settings. AF COMMISSIONER: with automation on,
 *      the final order is saved when the title game is decided and seats the next rookie draft, and
 *      `roundNotices: { notify, chat }` choose who hears about each playoff round's locked picks.
 *
 * See docs/AF_COMMISSIONER_SETTINGS_SPEC.md §1.1 and lib/rookie-order/.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import {
  isLeagueEntitledToLiveRookieOrder,
  parseRookieOrderConfig,
  readLiveRookieOrderSettings,
  refreshLiveRookieOrder,
  saveLiveRookieOrderSettings,
} from '@/lib/rookie-order/liveRookieOrderService'
import { parseRoundNoticeSettings } from '@/lib/rookie-order/roundNotices'

export const dynamic = 'force-dynamic'

async function auth(params: Promise<{ leagueId: string }>) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { leagueId } = await params
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await isCommissioner(leagueId, userId))) {
    return { error: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) }
  }
  return { userId, leagueId }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const a = await auth(params)
  if ('error' in a) return a.error

  const url = new URL(req.url)
  const preview = ['nonPlayoff', 'playoff', 'withinRound'].some((k) => url.searchParams.has(k))
  const league = await prisma.league.findUnique({ where: { id: a.leagueId }, select: { userId: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const canAutomate = await isLeagueEntitledToLiveRookieOrder(league.userId)

  // Not a pure read: with automation on and the title game decided, this saves the final order.
  const view = await refreshLiveRookieOrder(a.leagueId, {
    entitled: canAutomate,
    config: preview
      ? parseRookieOrderConfig({
          nonPlayoff: url.searchParams.get('nonPlayoff'),
          playoff: url.searchParams.get('playoff'),
          withinRound: url.searchParams.get('withinRound'),
        })
      : undefined,
  })
  if (!view) return NextResponse.json({ error: 'No season data for this league yet' }, { status: 404 })

  return NextResponse.json({ ...view, preview, canAutomate })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const a = await auth(params)
  if ('error' in a) return a.error

  const league = await prisma.league.findUnique({
    where: { id: a.leagueId },
    select: { userId: true, season: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const enabled = body.enabled !== false
  if (enabled && !(await isLeagueEntitledToLiveRookieOrder(league.userId))) {
    return NextResponse.json(
      {
        error: 'AF Commissioner is required to automate the rookie draft order.',
        errorCode: 'AF_COMMISSIONER_REQUIRED',
        upgradePath: '/upgrade?plan=commissioner',
      },
      { status: 402 },
    )
  }

  const before = readLiveRookieOrderSettings(league.settings)
  const config = parseRookieOrderConfig(body.config ?? body)
  const roundNotices = parseRoundNoticeSettings(body.roundNotices, before.roundNotices)
  const saved = await saveLiveRookieOrderSettings(a.leagueId, { enabled, config, season: league.season, roundNotices })

  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (before.enabled !== enabled) {
    changes.push({ field: 'Automatic rookie draft order', oldValue: before.enabled ? 'On' : 'Off', newValue: enabled ? 'On' : 'Off' })
  }
  for (const key of ['nonPlayoff', 'playoff', 'withinRound'] as const) {
    if (before.config[key] !== config[key]) {
      changes.push({ field: `Rookie order: ${key}`, oldValue: before.config[key], newValue: config[key] })
    }
  }
  const onOff = (v: boolean) => (v ? 'On' : 'Off')
  if (before.roundNotices.notify !== roundNotices.notify) {
    changes.push({ field: 'Rookie order: notify after each playoff round', oldValue: onOff(before.roundNotices.notify), newValue: onOff(roundNotices.notify) })
  }
  if (before.roundNotices.chat !== roundNotices.chat) {
    changes.push({ field: 'Rookie order: post updates in league chat', oldValue: onOff(before.roundNotices.chat), newValue: onOff(roundNotices.chat) })
  }
  if (changes.length > 0) {
    await notifyCommissionerChange(a.leagueId, a.userId, 'Rookie Draft Settings', changes).catch(() => {})
  }

  return NextResponse.json({ ok: true, settings: saved })
}
