/**
 * The trade history review — commissioner / co-commissioner only.
 *
 * GET   every audited trade in the league (`trade_value_audits`, values as priced when each trade
 *       happened), the teams in it, and any pair trading far above the league's volume.
 * POST  `{ teamId }` posts that team's review to league chat as a commissioner announcement. The text is
 *       rebuilt here from the stored rows — the client names a team, never words — through the same
 *       guard the broadcast composer uses (`broadcastRefusal`).
 *
 * PRIVACY: trade records only; nothing here reads chat.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { prisma } from '@/lib/prisma'
import { broadcastRefusal } from '@/lib/commissioner/broadcastAccess'
import { postLeagueAnnouncement } from '@/lib/commissioner/postLeagueAnnouncement'
import { auditTeams, buildTradeReviewText, pairFrequency, teamTradeLines } from '@/lib/integrity/tradeAudit'
import { readTradeValueAudits, tradeValueAuditsReady } from '@/lib/integrity/tradeValueAudit'

export const dynamic = 'force-dynamic'

async function commissioner(leagueId: string): Promise<{ userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  return { userId }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const who = await commissioner(leagueId)
  if (who instanceof NextResponse) return who
  const ready = await tradeValueAuditsReady()
  const rows = ready ? await readTradeValueAudits(leagueId) : []
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { leagueSize: true } }).catch(() => null)
  const teams = auditTeams(rows)
  const teamCount = Math.max(league?.leagueSize ?? 0, teams.length)
  return NextResponse.json({ ready, rows, teams, pairs: pairFrequency(rows, teamCount) })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const who = await commissioner(leagueId)
  if (who instanceof NextResponse) return who
  const body = (await req.json().catch(() => null)) as { teamId?: unknown } | null
  const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : ''
  if (!teamId) return NextResponse.json({ error: 'Pick a team' }, { status: 400 })

  const refusal = await broadcastRefusal(leagueId, who.userId)
  if (refusal === 'imported') return NextResponse.json({ error: 'League chat posts are for leagues run on AllFantasy.' }, { status: 409 })
  if (refusal) return NextResponse.json({ error: 'Only a chat moderator can post to the league.' }, { status: 403 })

  const rows = await readTradeValueAudits(leagueId)
  const team = auditTeams(rows).find((t) => t.teamId === teamId)
  if (!team) return NextResponse.json({ error: 'No audited trades for this team yet.' }, { status: 404 })
  const text = buildTradeReviewText({ teamName: team.name, lines: teamTradeLines(rows, teamId) })
  const sent = await postLeagueAnnouncement(leagueId, who.userId, text)
  if (!sent) return NextResponse.json({ error: 'The league chat did not accept the post. Try again.' }, { status: 502 })
  return NextResponse.json({ ok: true, posted: text })
}
