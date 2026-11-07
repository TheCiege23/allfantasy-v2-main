/**
 * Post one team's Lineup Integrity report to the league chat — commissioner / co-commissioner only.
 *
 * The client sends a team, never text: the report is rebuilt here from the stored scores
 * (`readLineupScores`), so what the league reads is exactly what the score says and nothing a request
 * could edit. Posted as a commissioner announcement, through the same guard the broadcast composer
 * uses (`broadcastRefusal`: AllFantasy-run leagues, chat moderators only).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { prisma } from '@/lib/prisma'
import { broadcastRefusal } from '@/lib/commissioner/broadcastAccess'
import { postLeagueAnnouncement } from '@/lib/commissioner/postLeagueAnnouncement'
import { integrityEntitled, readLineupScores } from '@/lib/lineup-integrity/lineupIntegrityService'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as { rosterId?: unknown } | null
  const rosterId = typeof body?.rosterId === 'string' ? body.rosterId.trim() : ''
  if (!rosterId) return NextResponse.json({ error: 'Pick a team' }, { status: 400 })

  const refusal = await broadcastRefusal(leagueId, userId)
  if (refusal === 'imported') return NextResponse.json({ error: 'League chat posts are for leagues run on AllFantasy.' }, { status: 409 })
  if (refusal) return NextResponse.json({ error: 'Only a chat moderator can post to the league.' }, { status: 403 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, season: true, userId: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const entitled = await integrityEntitled(league.userId ?? null)
  const [team] = (await readLineupScores(league, entitled, rosterId)) ?? []
  if (!team) return NextResponse.json({ error: 'No scored weeks for this team yet.' }, { status: 404 })

  const sent = await postLeagueAnnouncement(leagueId, userId, team.reportText)
  if (!sent) return NextResponse.json({ error: 'The league chat did not accept the post. Try again.' }, { status: 502 })
  return NextResponse.json({ ok: true, posted: team.reportText })
}
