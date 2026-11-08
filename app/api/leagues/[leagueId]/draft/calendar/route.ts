/**
 * The league's scheduled draft as a calendar file (.ics) — any member. One event, at the stored UTC
 * moment, so every calendar app shows it in its owner's own zone. 404 when no future draft time is set.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { buildIcs } from '@/lib/core-app/commissioner/calendar'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, leagueSettings: { select: { draftDateUtc: true } } } })
  const at = league?.leagueSettings?.draftDateUtc ?? null
  const now = new Date()
  if (!league || !at || at.getTime() <= now.getTime()) return NextResponse.json({ error: 'No draft time is set.' }, { status: 404 })

  const name = league.name?.trim() || 'League'
  const ics = buildIcs({
    leagueId,
    leagueName: name,
    now,
    events: [{ id: 'draft', kind: 'draft', title: `${name} draft`, at: at.toISOString(), allDay: false, week: null, whenLabel: '', status: 'upcoming', detail: '', source: 'allfantasy' }],
  })
  if (!ics) return NextResponse.json({ error: 'No draft time is set.' }, { status: 404 })
  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'league'}-draft.ics"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
