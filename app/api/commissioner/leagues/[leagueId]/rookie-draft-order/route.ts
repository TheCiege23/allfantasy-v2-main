/**
 * GET: Compute and return rookie draft order preview. FREE: any member can see either order.
 * PUT: Save the rookie draft order config (league owner only).
 * Only for dynasty/C2C/devy leagues, future seasons (not first season).
 *
 * WORST RECORD FIRST IS FREE AND ON BY DEFAULT (owner's decision, 2026-11-19;
 * lib/rookie-order/automaticRookieOrder.ts). Any commissioner can switch the automatic order on or
 * off. Only switching it on with LOWEST MAX PF FIRST is the league owner's AF Commissioner plan,
 * refused here with AF_COMMISSIONER_REQUIRED. A max PF config already saved keeps its setting after
 * a plan lapses, and the draft is then seated worst record first.
 */
import { commissionerAccessResponse, canCommissionerAct } from '@/lib/league/commissionerAccess'
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
import { publishRookieDraftOrderChange } from '@/lib/league-rules-explainer/rookieOrderChange'
import { isLeagueEntitledToLiveRookieOrder } from '@/lib/rookie-order/liveRookieOrderService'
import { automaticRookieOrderFromSettings } from '@/lib/rookie-order/automaticRookieOrder'

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

  const isCommissioner = await canCommissionerAct(leagueId, session.user.id, 'league')
  const [savedConfig, canAutomate, dynasty] = await Promise.all([
    getRookieDraftOrderConfig(leagueId),
    isCommissioner ? isLeagueEntitledToLiveRookieOrder(league.userId) : Promise.resolve(false),
    prisma.dynastyLeagueConfig.findUnique({ where: { leagueId }, select: { rookiePickOrderMethod: true } }).catch(() => null),
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
    /** On unless the league switched it off: worst record first is the default. */
    enabled: automaticRookieOrderFromSettings(league.settings, dynasty?.rookiePickOrderMethod ?? null) !== null,
    isCommissioner,
    /** The league owner holds AF Commissioner, so lowest max PF first can be automated. */
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
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused

  if (!isDynastyLike(league)) {
    return NextResponse.json({ error: 'Only available for Dynasty, C2C, Devy, and Keeper leagues' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const mode = body.mode === 'reverse_max_pf' ? 'reverse_max_pf' : 'worst_to_first'
  const enabled = body.enabled !== false
  if (enabled && mode === 'reverse_max_pf' && !(await isLeagueEntitledToLiveRookieOrder(league.userId))) {
    return NextResponse.json(
      {
        error: 'AF Commissioner is required to order the rookie draft by lowest max points for.',
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

  // The popup's rookie order follows this setting; members get a "What changed" card when it moves.
  await publishRookieDraftOrderChange({ leagueId: leagueId, actorUserId: session.user.id, settingsBefore: league.settings })

  return NextResponse.json({ ok: true, mode, enabled })
}
