/**
 * GET /api/leagues/[leagueId]/manager-record?team=<LeagueTeam.externalId>
 *
 * One leaguemate's record — the manager card (2026-11-16, re-score item 11: Manager Psychology as
 * facts only, paid). The same record Chimmy and the commissioner's screen read
 * (lib/competitive-edge/managerRecord.ts).
 *
 * 🛑 THE SERVER WITHHOLDS; THE LOCK ONLY DRAWS. A viewer without Competitive Edge gets `locked` and the
 * access to draw the lock card with — and NOT the record. The loader then checks membership itself,
 * so a paying viewer cannot read a league they are not in by its id.
 *
 * Read-only and DB-first: it calls no provider.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import { loadLeagueManagerRecords } from '@/lib/competitive-edge/managerRecordLoader'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in to see a manager’s record.' }, { status: 401, headers: NO_STORE })

  const { leagueId } = await ctx.params
  const team = req.nextUrl.searchParams.get('team')?.trim().slice(0, 120)
  if (!leagueId || !team) return NextResponse.json({ error: 'Name the team.' }, { status: 400, headers: NO_STORE })

  const access = await resolveCoreDepth(userId, 'competitive_edge').catch(() => null)
  if (!access) return NextResponse.json({ error: 'Your plan could not be checked just now.' }, { status: 503, headers: NO_STORE })
  if (!access.unlocked) return NextResponse.json({ locked: true, access }, { headers: NO_STORE })

  const read = await loadLeagueManagerRecords({ leagueId, userId, teamExternalId: team }).catch(() => null)
  if (!read) return NextResponse.json({ error: 'This record could not be read just now.' }, { status: 503, headers: NO_STORE })
  if (!read.available) return NextResponse.json({ error: read.reason }, { status: 404, headers: NO_STORE })
  const record = read.data.records[0] ?? null
  if (!record) return NextResponse.json({ error: 'That team is not in this league.' }, { status: 404, headers: NO_STORE })

  return NextResponse.json({ locked: false, access, record }, { headers: NO_STORE })
}
