/**
 * Dispute desk (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.2).
 *
 *   GET    members: own disputes + rulings posted to chat; commissioners: all, plus `isCommissioner`
 *   POST   any member files { category, subject, details }
 *   PATCH  { id, action: 'rule', outcome, text, postToChat }  commissioner / co-commissioner only
 *          { id, action: 'withdraw' }                         the filer only
 *
 * Free on every tier: settling an argument is the floor of running a league, not a premium tool.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import {
  fileLeagueDispute,
  listDisputes,
  resolveDisputeViewer,
  ruleLeagueDispute,
  withdrawLeagueDispute,
} from '@/lib/disputes/disputeService'
import { DISPUTE_ERROR_STATUS } from '@/lib/disputes/disputeStore'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return {
      error: NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status }),
    } as const
  }
  return { leagueId, viewer: await resolveDisputeViewer(leagueId, userId) } as const
}

function failure(error: keyof typeof DISPUTE_ERROR_STATUS) {
  return NextResponse.json({ error }, { status: DISPUTE_ERROR_STATUS[error] })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const disputes = await listDisputes(g.leagueId, g.viewer)
  return NextResponse.json({ disputes, isCommissioner: g.viewer.isCommissioner, viewerUserId: g.viewer.userId })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const result = await fileLeagueDispute(g.leagueId, g.viewer.userId, body)
  if (!result.ok) return failure(result.error)
  return NextResponse.json({ dispute: result.dispute }, { status: 201 })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  if (body.action === 'rule') {
    if (!g.viewer.isCommissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    const result = await ruleLeagueDispute(g.leagueId, g.viewer.userId, id, body)
    if (!result.ok) return failure(result.error)
    return NextResponse.json({ dispute: result.dispute })
  }
  if (body.action === 'withdraw') {
    const result = await withdrawLeagueDispute(g.leagueId, g.viewer.userId, id)
    if (!result.ok) return failure(result.error)
    return NextResponse.json({ dispute: result.dispute })
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
