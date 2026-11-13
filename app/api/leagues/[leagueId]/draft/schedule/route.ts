/**
 * Draft scheduler (lib/draft-schedule/draftScheduleService.ts).
 *
 *   GET   any member: the open (or last) availability poll, how many managers can make each time, the
 *         best time so far, and how many have answered. Answering happens on the poll in league chat.
 *   POST  commissioner / co-commissioner, by `action`:
 *           create  { slots: ISO[] }   offer 2–8 start times in a league-chat poll
 *           lock    { slotId }         make one the draft date (through the settings patch)
 *           cancel                     withdraw the open poll
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { cancelDraftSchedulePoll, createDraftSchedulePoll, lockDraftSlot, readDraftSchedule } from '@/lib/draft-schedule/draftScheduleService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

const MESSAGE: Record<string, [number, string]> = {
  too_few: [400, 'Offer at least two start times.'],
  too_many: [400, 'Offer at most eight start times.'],
  invalid_time: [400, 'One of the times could not be read.'],
  in_the_past: [400, 'Every time has to be at least two hours from now.'],
  too_close: [400, 'Keep the times at least an hour apart.'],
  poll_open: [409, 'There is already an open draft-time poll. Lock a time or cancel it first.'],
  poll_failed: [502, 'The poll could not be posted to league chat. Try again.'],
  not_found: [404, 'Not found'],
  not_open: [409, 'There is no open draft-time poll.'],
  unknown_slot: [400, 'That time is not one of the poll’s options.'],
}

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return { error: NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status }) } as const
  const role = await getLeagueRole(leagueId, userId)
  return { leagueId, userId, isCommissioner: role === 'commissioner' || role === 'co_commissioner' } as const
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const view = await readDraftSchedule(g.leagueId)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...view, isCommissioner: g.isCommissioner })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  if (!g.isCommissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const fail = (code: string, reason?: string) => {
    const [status, error] = MESSAGE[code] ?? [409, reason ?? code]
    return NextResponse.json({ error: reason ?? error, code }, { status })
  }
  if (body.action === 'create') {
    const r = await createDraftSchedulePoll(g.leagueId, g.userId, body.slots)
    return r.ok ? NextResponse.json(r, { status: 201 }) : fail(r.error)
  }
  if (body.action === 'lock') {
    const r = await lockDraftSlot(g.leagueId, g.userId, body.slotId)
    return r.ok ? NextResponse.json(r) : fail(r.error, r.reason)
  }
  if (body.action === 'cancel') {
    return (await cancelDraftSchedulePoll(g.leagueId)) ? NextResponse.json({ ok: true }) : fail('not_open')
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
