/**
 * GET: Compute and return rookie draft order preview.
 * PUT: Save rookie draft order mode config (commissioner only).
 * Only for dynasty/C2C/devy leagues, future seasons (not first season).
 *
 * ⚠ FREE, NOT AF COMMISSIONER. Both modes (worst-to-first, reverse max PF) are a
 * deterministic sort of last season's results — nothing here is AI — yet saving was
 * gated on `commissioner_ai_tools`, so a free dynasty league could never turn
 * auto-ordering on and every rookie draft needed a hand-set order. Setting the order
 * a league's own draft runs in is running the league.
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
  const savedConfig = await getRookieDraftOrderConfig(leagueId)
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
