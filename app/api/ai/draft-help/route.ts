import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueAccess, requireSleeper } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { fetchSleeperLeagueBundle } from '@/lib/ai/league-settings-ai/sleeper'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const league = await assertLeagueAccess(leagueId, userId)
  if (!league) {
    return NextResponse.json({ error: 'League not found or forbidden' }, { status: 403 })
  }

  const gated = await aiCostGate(req, 'draft_ai', userId)
  if (gated) return gated

  try {
    let sleeperExtra = ''
    const sid = requireSleeper(league)
    if (sid) {
      const bundle = await fetchSleeperLeagueBundle(sid)
      sleeperExtra = JSON.stringify(
        {
          name: bundle.league.name,
          sport: bundle.sport,
          season: bundle.league.season,
          rosterPositions: bundle.league.roster_positions,
          status: bundle.league.status,
        },
        null,
        2
      )
    }

    const system = `You are Chimmy, AllFantasy's draft assistant. Give practical draft tips for this league's format. Respond with ONLY valid JSON (no markdown):
{"tips":string[],"positionalPriorities":string,"avoid":string}`

    const userPayload = `League: ${league.name ?? leagueId}\nSport: ${league.sport}\nSleeper context:\n${sleeperExtra || '(not a Sleeper league or fetch failed)'}\nLocal settings:\n${JSON.stringify(league.settings ?? {}, null, 2).slice(0, 6000)}`

    const raw = await callClaudeJson({ system, user: userPayload, userId })
    return NextResponse.json(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Draft help failed'
    console.error('[api/ai/draft-help]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
