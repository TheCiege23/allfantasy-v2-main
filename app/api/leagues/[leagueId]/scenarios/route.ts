/**
 * Scenario explainer (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 8) — any member of the league.
 * Head-to-head leagues: the #1 pick over the rest of the season. Guillotine leagues: surviving the chop.
 * The playoff half lives on Season Outlook, which already answers "what do I need".
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { readScenarios } from '@/lib/scenario-explainer/scenarioService'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return NextResponse.json({ error: membership.status === 404 ? 'Not found' : 'Forbidden' }, { status: membership.status })
  const result = await readScenarios(leagueId, userId)
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
