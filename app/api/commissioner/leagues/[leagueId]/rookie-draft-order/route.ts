/**
 * GET: Compute and return rookie draft order preview. FREE: any member can see either order.
 * PUT: Save rookie draft order mode config (league owner only). Turning automatic ordering ON is
 *      AF COMMISSIONER; turning it off, or saving a mode with it off, is free.
 * Only for dynasty/C2C/devy leagues, future seasons (not first season).
 *
 * ⚠ THE SAME RULE AS THE LIVE ORDER (./live/route.ts), WHICH THIS ROUTE PREDATES. Calculating an
 * order is free; having the system seat the next rookie draft with it is the Commissioner plan's
 * automation (docs/commissioner/DYNASTY_COMMISH_CHECKLIST.md, "Legacy rookie-order route"). This
 * header used to say the route was free on purpose, because saving had been gated on the unrelated
 * `commissioner_ai_tools` — a wrong gate, not proof that none belongs here. Two routes that seat the
 * same draft must not disagree about who may automate it, and before this the free one let any
 * league switch on what the live route sells.
 *
 * Nothing a free league needs is behind it: without an enabled config the draft keeps its default
 * order, and the preview stays free. A config already saved enabled keeps seating drafts after a
 * plan lapses, like the live order's automation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  computeRookieDraftOrder,
  saveRookieDraftOrderConfig,
  getRookieDraftOrderConfig,
  type RookieDraftOrderMode,
} from '@/lib/league/rookieDraftOrder'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import { isLeagueEntitledToLiveRookieOrder } from '@/lib/rookie-order/liveRookieOrderService'

export const dynamic = 'force-dynamic'

const VALID_VARIANTS = new Set(['dynasty', 'devy', 'c2c', 'keeper'])

function isDynastyLike(league: { isDynasty: boolean; leagueVariant: string | null; settings: unknown }): boolean {
  if (league.isDynasty) return true
  const variant = (league.leagueVariant ?? '').toLowerCase()
  if (VALID_VARIANTS.has(variant)) return true
  const s = (league.settings as Record<string, unknown>) ?? {}
  const lt = ((s.league_type ?? s.leagueType ?? '') as string).toLowerCase()
  return VALID_VARIANTS.has(lt)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, isDynasty: true, leagueVariant: true, settings: true, season: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Must be dynasty/C2C/devy/keeper
  if (!isDynastyLike(league)) {
    return NextResponse.json({ error: 'Only available for Dynasty, C2C, Devy, and Keeper leagues' }, { status: 400 })
  }

  const isCommissioner = league.userId === session.user.id
  const [savedConfig, canAutomate] = await Promise.all([
    getRookieDraftOrderConfig(leagueId),
    isCommissioner ? isLeagueEntitledToLiveRookieOrder(league.userId) : Promise.resolve(false),
  ])
  const mode: RookieDraftOrderMode = savedConfig?.mode ?? 'worst_to_first'

  // Compute the order preview
  const url = new URL(req.url)
  const requestedMode = url.searchParams.get('mode') as RookieDraftOrderMode | null
  const previewMode = requestedMode === 'reverse_max_pf' ? 'reverse_max_pf' : requestedMode === 'worst_to_first' ? 'worst_to_first' : mode
  const result = await computeRookieDraftOrder(leagueId, previewMode)

  return NextResponse.json({
    ...result,
    savedMode: savedConfig?.mode ?? null,
    enabled: savedConfig?.enabled ?? false,
    isCommissioner,
    /** The league owner holds AF Commissioner, so automatic ordering can be switched on. */
    canAutomate,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, isDynasty: true, leagueVariant: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  if (!isDynastyLike(league)) {
    return NextResponse.json({ error: 'Only available for Dynasty, C2C, Devy, and Keeper leagues' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const mode = body.mode === 'reverse_max_pf' ? 'reverse_max_pf' : 'worst_to_first'
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

  const oldConfig = await getRookieDraftOrderConfig(leagueId)
  await saveRookieDraftOrderConfig(leagueId, { mode, enabled, userId: session.user.id })

  // Notify chat
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (oldConfig?.mode !== mode) {
    changes.push({
      field: 'Rookie Draft Order Mode',
      oldValue: oldConfig?.mode === 'reverse_max_pf' ? 'Reverse Max PF' : 'Worst to First',
      newValue: mode === 'reverse_max_pf' ? 'Reverse Max PF' : 'Worst to First',
    })
  }
  if (oldConfig?.enabled !== enabled) {
    changes.push({ field: 'Rookie Draft Auto-Order', oldValue: oldConfig?.enabled ? 'On' : 'Off', newValue: enabled ? 'On' : 'Off' })
  }
  if (changes.length > 0) {
    await notifyCommissionerChange(leagueId, session.user.id, 'Rookie Draft Settings', changes).catch(() => {})
  }

  return NextResponse.json({ ok: true, mode, enabled })
}
