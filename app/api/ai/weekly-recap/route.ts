import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueAccess, requireSleeper } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import {
  fetchPlayersMap,
  fetchSleeperLeagueBundle,
  fetchMatchups,
  nameForPlayer,
  readSleeperStateWeek,
} from '@/lib/ai/league-settings-ai/sleeper'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string; week?: number }
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

  const gated = await aiCostGate(req, 'weekly_recap_ai', userId)
  if (gated) return gated

  const sleeperId = requireSleeper(league)
  if (!sleeperId) {
    return NextResponse.json({ error: 'Weekly recap requires a Sleeper-synced league' }, { status: 400 })
  }

  try {
    const bundle = await fetchSleeperLeagueBundle(sleeperId)
    const stateWeek = readSleeperStateWeek(bundle.state) ?? NaN
    const week =
      typeof body.week === 'number' && body.week > 0
        ? body.week
        : Number.isFinite(stateWeek)
          ? stateWeek
          : 1

    const matchups = await fetchMatchups(sleeperId, week)
    const playersMap = await fetchPlayersMap(bundle.sport)
    const users = bundle.users

    const rows = (Array.isArray(matchups) ? matchups : []).map((m) => {
      const owner = users.find((u) => {
        const r = bundle.rosters.find((x) => x.roster_id === m.roster_id)
        return r && r.owner_id === u.user_id
      })
      return {
        matchupId: m.matchup_id,
        rosterId: m.roster_id,
        points: m.points,
        team: owner?.metadata?.team_name || owner?.display_name || String(m.roster_id),
        topStarters: (m.starters ?? [])
          .slice(0, 3)
          .map((pid) => nameForPlayer(playersMap, String(pid))),
      }
    })

    const system = `You are Chimmy, AllFantasy's league columnist. Write a sports-column-style recap for the given week. Respond with ONLY valid JSON (no markdown):
{"column":string,"gameOfTheWeek":string,"topPerformer":string,"biggestBust":string,"injuryImpact":string}
injuryImpact should briefly note how injuries shaped the week (or say if none stood out).`

    const userPayload = `League: ${String(bundle.league.name ?? '')} — Week ${week} (${bundle.sport})\nMatchup snapshot:\n${JSON.stringify(rows, null, 2)}`

    const raw = await callClaudeJson({ system, user: userPayload, userId })
    return NextResponse.json(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Weekly recap failed'
    console.error('[api/ai/weekly-recap]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
