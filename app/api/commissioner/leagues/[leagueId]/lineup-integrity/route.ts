/**
 * Lineup-integrity monitor (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 7) — commissioner /
 * co-commissioner only. The latest finished week for everyone; the whole season on the
 * AF Commissioner plan (`commissioner_integrity_monitoring`, the league owner's plan).
 */
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { integrityEntitled, readLineupIntegrity } from '@/lib/lineup-integrity/lineupIntegrityService'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const refused = await commissionerAccessResponse(leagueId, userId, 'view')
  if (refused) return refused

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  const entitled = await integrityEntitled(league?.userId ?? null)
  const report = await readLineupIntegrity(leagueId, { fullSeason: entitled })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...report, entitled })
}
