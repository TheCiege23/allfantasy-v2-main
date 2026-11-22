/**
 * The league log (lib/league-log/leagueLog.ts).
 *
 *   GET  ?lang=en|es&limit=&cursor=&category=   any member; what they see depends on role and the setting
 *   PUT  { visibility: 'league' | 'commish_only' }  commissioner — through the settings patch, so the
 *        co-commissioner scopes and the settings lock apply exactly as they do to any other setting.
 *   POST { auditId }   commissioner or co-commissioner — undo a recent FAAB, waiver-order or standings
 *        edit (lib/commissioner-undo), while nothing has come to depend on it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { LEAGUE_LOG_VISIBILITY_KEY, LOG_CATEGORY_LABELS, parseLeagueLogVisibility, type LogCategory } from '@/lib/league-log/leagueLog'
import { readLeagueLog } from '@/lib/league-log/leagueLogService'
import { UNDO_BLOCK_TEXT } from '@/lib/commissioner-undo/commissionerUndo'
import { undoCommissionerAction } from '@/lib/commissioner-undo/commissionerUndoService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const category = sp.get('category')
  const result = await readLeagueLog(leagueId, userId, {
    lang: sp.get('lang') === 'es' ? 'es' : 'en',
    limit: Number(sp.get('limit') || '40'),
    cursor: sp.get('cursor'),
    category: category && category in LOG_CATEGORY_LABELS ? (category as LogCategory) : null,
  })
  if (!result.ok) {
    const error = result.status === 401 ? 'Unauthorized' : result.status === 404 ? 'Not found' : 'Forbidden'
    return NextResponse.json({ error }, { status: result.status })
  }
  const { ok: _ok, ...body } = result
  return NextResponse.json(body)
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { visibility?: unknown } | null
  const parsed = parseLeagueLogVisibility(body?.visibility)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  return executeLeagueSettingsPatch(
    userId,
    { leagueId, settingsMerge: { [LEAGUE_LOG_VISIBILITY_KEY]: parsed.value } },
    { section: 'commissioner' },
  )
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { auditId?: unknown } | null
  const r = await undoCommissionerAction(leagueId, userId, body?.auditId)
  if (r.ok) return NextResponse.json({ status: 'ok', actionType: r.actionType })
  const error =
    r.message ?? (r.error === 'not_found' ? 'That action is not in this league.' : r.error === 'forbidden' ? 'Forbidden' : UNDO_BLOCK_TEXT[r.error])
  return NextResponse.json({ error, code: r.error }, { status: r.status })
}
