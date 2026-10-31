/**
 * League constitution (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 3).
 *
 *   GET   any member: the current version, its history, amendments and their votes
 *   POST  commissioner / co-commissioner, by `action`:
 *           draft     { answers }                         → sections written from the league's settings
 *                                                           (AF Commissioner plan, 402 without it)
 *           publish   { sections, answers?, source? }     → a new version (free)
 *           propose   { title, text?, change?, effective } → an amendment + its league-chat vote (free)
 *           apply     { id }                              → apply a passed amendment now (free)
 *           withdraw  { id }                              → withdraw an amendment still being voted on
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import {
  applyAmendment,
  constitutionEntitled,
  draftFromSettings,
  proposeAmendment,
  publishVersion,
  readConstitutionView,
  withdrawAmendment,
} from '@/lib/constitution/constitutionService'
import { prisma } from '@/lib/prisma'

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
  title_required: 400, invalid_change: 400, invalid_sections: 400, too_many_open: 429, poll_failed: 502,
  not_found: 404, not_passed: 409, no_change: 409, refused: 409,
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
  if (!g.isCommissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''

  switch (body.action) {
    case 'draft': {
      const league = await prisma.league.findUnique({ where: { id: g.leagueId }, select: { userId: true } })
      if (!(await constitutionEntitled(league?.userId ?? null))) {
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
      return (await withdrawAmendment(g.leagueId, g.userId, id))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'not_open' }, { status: 409 })
    }
    default:
      return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }
}
