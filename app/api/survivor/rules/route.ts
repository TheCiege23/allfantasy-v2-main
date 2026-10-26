import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildSurvivorRulebook } from '@/lib/survivor/survivorRulesAnswers'
import { loadSurvivorRulesContext } from '@/lib/survivor/survivorRulesContext'

export const dynamic = 'force-dynamic'

/** The league's rulebook, built from its current settings on every read. League members only. */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  // One 403 for not-found and not-member, so league existence is not leaked.
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await loadSurvivorRulesContext(leagueId)
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ sport: ctx.sport, sections: buildSurvivorRulebook(ctx) })
}
