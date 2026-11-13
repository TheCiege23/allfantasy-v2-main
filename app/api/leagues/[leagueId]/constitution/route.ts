/**
 * League constitution (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 3).
 *
 *   GET   any member: the current version, its history, amendments, their votes and the rule-change log
 *   POST  any member, by `action`:
 *           propose   { title, text?, change?, effective } → waits for the commissioner (pending_approval)
 *           withdraw  { id }                              → withdraw your own proposal while it waits
 *   POST  commissioner / co-commissioner, by `action`:
 *           draft     { answers }                         → sections written from the league's settings
 *                                                           (AF Commissioner plan, 402 without it)
 *           publish   { sections, answers?, source? }     → a new version (free)
 *           propose   { title, text?, change?, effective } → an amendment + its league-chat vote (free)
 *           apply     { id }                              → apply a passed amendment now (free)
 *           withdraw  { id }                              → withdraw an amendment being voted on or waiting
 *           approve   { id }                              → open the league vote on a member's proposal
 *           decline   { id, reason? }                     → decline a member's proposal
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import {
  applyAmendment,
  approveAmendment,
  constitutionEntitled,
  declineAmendment,
  draftFromSettings,
  proposeAmendment,
  publishVersion,
  readConstitutionView,
  withdrawAmendment,
} from '@/lib/constitution/constitutionService'
import { prisma } from '@/lib/prisma'
import { leagueCommissionerAccountId } from '@/lib/commissioner/leagueCommissionerAccount'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return { error: NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status }) } as const
  }
  const role = await getLeagueRole(leagueId, userId)
  return { leagueId, userId, isCommissioner: role === 'commissioner' || role === 'co_commissioner' } as const
}

const STATUS: Record<string, number> = {
  title_required: 400, invalid_change: 400, invalid_sections: 400, too_many_open: 429, too_many_pending: 429, poll_failed: 502,
  not_found: 404, not_passed: 409, no_change: 409, refused: 409, not_pending: 409,
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const view = await readConstitutionView(g.leagueId, { userId: g.userId, isCommissioner: g.isCommissioner })
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''

  // Members may propose a rule change (it waits for the commissioner) and withdraw their own.
  if (!g.isCommissioner) {
    if (body.action === 'propose') {
      const r = await proposeAmendment(g.leagueId, g.userId, body, new Date(), { asCommissioner: false })
      return r.ok ? NextResponse.json(r, { status: 201 }) : NextResponse.json({ error: r.error }, { status: STATUS[r.error] })
    }
    if (body.action === 'withdraw') {
      return (await withdrawAmendment(g.leagueId, g.userId, id, { isCommissioner: false }))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'not_open' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  switch (body.action) {
    case 'draft': {
      const league = await prisma.league.findUnique({ where: { id: g.leagueId }, select: { userId: true } })
      if (!(await constitutionEntitled(await leagueCommissionerAccountId(g.leagueId, league?.userId)))) {
        return NextResponse.json({ error: 'not_entitled', upgradeUrl: '/commissioner-upgrade' }, { status: 402 })
      }
      const sections = await draftFromSettings(g.leagueId, body.answers)
      return sections ? NextResponse.json({ sections }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    case 'publish': {
      const r = await publishVersion(g.leagueId, g.userId, { sections: body.sections, answers: body.answers, source: body.source })
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: STATUS[r.error] })
    }
    case 'propose': {
      const r = await proposeAmendment(g.leagueId, g.userId, body)
      return r.ok ? NextResponse.json(r, { status: 201 }) : NextResponse.json({ error: r.error }, { status: STATUS[r.error] })
    }
    case 'apply': {
      const r = await applyAmendment(g.leagueId, id, g.userId)
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error, reason: r.reason }, { status: STATUS[r.error] })
    }
    case 'withdraw': {
      return (await withdrawAmendment(g.leagueId, g.userId, id, { isCommissioner: true }))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'not_open' }, { status: 409 })
    }
    case 'approve': {
      const r = await approveAmendment(g.leagueId, g.userId, id)
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: STATUS[r.error] })
    }
    case 'decline': {
      const r = await declineAmendment(g.leagueId, g.userId, id, body.reason)
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: STATUS[r.error] })
    }
    default:
      return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }
}
