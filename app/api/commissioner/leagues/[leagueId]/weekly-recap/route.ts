/**
 * Weekly recap review (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 6) — commissioner / co-commissioner.
 *
 *   GET   { review, draft }  the league's review setting and the draft waiting, if any
 *   PUT   { mode: 'auto' | 'review', autoPostIfUntouched? }
 *   POST  { action: 'post' | 'save' | 'discard', season, week, text? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { prisma } from '@/lib/prisma'
import { REVIEW_SETTINGS_KEY, cleanRecapText, parseRecapReview, readRecapReview } from '@/lib/recap-review/recapReview'
import { discardRecapDraft, postRecapDraft, readPendingDraft, saveRecapEdit } from '@/lib/recap-review/recapReviewService'
import { readChimmySpeaksUp } from '@/lib/league-chat/chimmyIdentity'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return { error: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) } as const
  }
  return { leagueId, userId } as const
}

const POST_STATUS = { not_found: 404, not_pending: 409, already_posted: 409, chimmy_quiet: 409, post_failed: 502 } as const

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const league = await prisma.league.findUnique({ where: { id: g.leagueId }, select: { settings: true } })
  return NextResponse.json({
    review: readRecapReview(league?.settings),
    chimmySpeaksUp: readChimmySpeaksUp(league?.settings),
    draft: await readPendingDraft(g.leagueId),
  })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const next = parseRecapReview(await req.json().catch(() => null))
  if (!next) return NextResponse.json({ error: 'invalid_mode' }, { status: 400 })
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${g.leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: g.leagueId }, select: { settings: true } })
    const settings = league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
    await tx.league.update({ where: { id: g.leagueId }, data: { settings: { ...settings, [REVIEW_SETTINGS_KEY]: next } as Prisma.InputJsonValue } })
    await tx.leagueAuditLog.create({ data: { leagueId: g.leagueId, userId: g.userId, actionType: 'weekly_recap_review_set', entityType: 'league_settings', afterState: next as Prisma.InputJsonValue } })
  })
  return NextResponse.json({ review: next })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const season = typeof body.season === 'string' ? body.season : String(body.season ?? '')
  const week = Number(body.week)
  if (!season || !Number.isInteger(week)) return NextResponse.json({ error: 'season_and_week_required' }, { status: 400 })

  if (body.action === 'discard') {
    return (await discardRecapDraft(g.leagueId, season, week, g.userId))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'not_pending' }, { status: 409 })
  }
  const text = body.text === undefined ? null : cleanRecapText(body.text)
  if (body.text !== undefined && !text) return NextResponse.json({ error: 'text_required' }, { status: 400 })
  if (body.action === 'save') {
    return text && (await saveRecapEdit(g.leagueId, season, week, text, g.userId))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'not_pending' }, { status: 409 })
  }
  if (body.action === 'post') {
    const r = await postRecapDraft(g.leagueId, season, week, { text, actorUserId: g.userId })
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: POST_STATUS[r.error] })
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
