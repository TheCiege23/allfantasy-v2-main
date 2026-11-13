import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { loadPlayerHighScores } from '@/lib/league-settings-hub/recordBookReads'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/player-high-scores?limit=10
 * Biggest single-week starter scores in this league, this season and last (league members).
 * Postgres only — see lib/league-settings-hub/recordBookReads.ts.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'League not found' : 'Forbidden' }, { status: gate.status })

  const raw = Number(req.nextUrl.searchParams?.get('limit') ?? 10)
  const limit = Number.isFinite(raw) ? Math.min(25, Math.max(1, Math.floor(raw))) : 10
  try {
    const result = await loadPlayerHighScores(prisma, leagueId, limit)
    if (!result) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return NextResponse.json({ leagueId, ...result })
  } catch (error) {
    console.error('[player-high-scores] GET failed', error)
    return NextResponse.json({ error: 'Could not load player high scores' }, { status: 500 })
  }
}
