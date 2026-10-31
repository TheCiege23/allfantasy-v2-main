import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { broadcastRefusal } from '@/lib/commissioner/broadcastAccess'
import {
  cancelScheduledAnnouncement,
  listScheduledAnnouncements,
  scheduleAnnouncement,
} from '@/lib/commissioner/scheduledAnnouncementService'
import { SCHEDULE_ERROR_TEXT } from '@/lib/commissioner/scheduledAnnouncements'

export const dynamic = 'force-dynamic'

/**
 * Scheduled league announcements (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free).
 *
 *   GET                       { announcements }   pending first, then the last 20 finished
 *   POST   { message, sendAt } { announcement }   sendAt is an ISO time ≥ 15 min and ≤ 90 days out
 *   DELETE ?id=…              { cancelled: true } only while it is still pending
 *
 * Who: whoever may send an announcement to this league right now — the same rule as Send now
 * (lib/commissioner/broadcastAccess.ts). The sweep checks it AGAIN at post time for the person who
 * scheduled it, so losing the role cancels the post rather than letting an old schedule speak.
 */

type Ctx = { params: Promise<{ leagueId: string }> }

async function gate(leagueId: string): Promise<{ userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refusal = await broadcastRefusal(leagueId, userId).catch((): 'forbidden' => 'forbidden')
  if (refusal === 'imported') return NextResponse.json({ error: 'Announcements go only to leagues AllFantasy runs' }, { status: 409 })
  if (refusal) return NextResponse.json({ error: 'Only this league’s commissioner or a co-commissioner can schedule announcements.' }, { status: 403 })
  return { userId }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const g = await gate(leagueId)
  if (g instanceof NextResponse) return g
  try {
    const all = await listScheduledAnnouncements(leagueId)
    const open = all.filter((a) => a.status === 'pending' || a.status === 'sending')
    const done = all.filter((a) => !open.includes(a)).reverse()
    return NextResponse.json({ announcements: [...open, ...done] })
  } catch (err) {
    console.error('[scheduled-announcements GET]', err)
    return NextResponse.json({ error: 'Could not load scheduled announcements' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const g = await gate(leagueId)
  if (g instanceof NextResponse) return g
  const body = await req.json().catch(() => null)
  try {
    const r = await scheduleAnnouncement(leagueId, g.userId, body)
    if (!r.ok) return NextResponse.json({ error: SCHEDULE_ERROR_TEXT[r.error], code: r.error }, { status: r.error === 'too_many' ? 409 : 400 })
    return NextResponse.json({ announcement: r.announcement })
  } catch (err) {
    console.error('[scheduled-announcements POST]', err)
    return NextResponse.json({ error: 'Could not schedule the announcement' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const g = await gate(leagueId)
  if (g instanceof NextResponse) return g
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    const cancelled = await cancelScheduledAnnouncement(leagueId, g.userId, id)
    if (!cancelled) return NextResponse.json({ error: 'That announcement has already posted or was cancelled.' }, { status: 409 })
    return NextResponse.json({ cancelled: true })
  } catch (err) {
    console.error('[scheduled-announcements DELETE]', err)
    return NextResponse.json({ error: 'Could not cancel the announcement' }, { status: 500 })
  }
}
