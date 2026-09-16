import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { importTournamentFromLeagues } from '@/lib/tournament/importTournamentFromLeagues'

/**
 * Stand a tournament up from leagues the caller already has imported.
 *
 * ⚠ NOT UNDER `/api/tournament/[tournamentId]/` — there is no tournament yet.
 * That whole tree takes an id in the path and would have to invent one to reach
 * the route that creates it.
 *
 * ⚠ OWNERSHIP IS ENFORCED IN THE SERVICE, on the query that resolves the league
 * ids from the body. Checking here would mean fetching them twice and trusting
 * the second read to match the first.
 */
export async function POST(request: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: {
    name?: string
    sport?: string
    openingWeekStart?: number
    openingWeekEnd?: number
    conferences?: Array<{ name?: string; leagueIds?: string[] }>
    advancersPerLeague?: number
    wildcardCount?: number
    bubbleEnabled?: boolean
    bubbleSize?: number
    /*
     * 🛑 THE REST OF THE CALENDAR. The form has always sent these four and this
     * type did not list them, so they were dropped here — the importer received
     * nothing, laid out a single "Regular season" round, and `executeAdvancement`
     * marked the tournament COMPLETE at the first cut because it found no next
     * play round. Nothing failed and nothing warned; the tournament simply ended
     * in week 9. `SettingsPanel` has no week fields, so it could not be repaired
     * afterwards either.
     */
    bubbleWeek?: number
    redraftWeek?: number
    eliteRedraftWeek?: number
    championshipWeek?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const toInt = (value: unknown, fallback: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : fallback
  }

  /*
   * ⚠ ABSENT IS NOT ZERO, WHICH IS WHY THIS IS NOT `toInt(x, 0)`. A commissioner
   * who has not decided the championship week yet sends nothing, and week 0 is
   * not "undecided" — it is a week before the regular season starts, which the
   * scaffold rejects as out of order. Null leaves that stage unscheduled, which
   * is what the importer expects.
   */
  const toWeek = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }

  const result = await importTournamentFromLeagues({
    commissionerUserId: userId,
    name: String(body.name ?? ''),
    sport: body.sport,
    openingWeekStart: toInt(body.openingWeekStart, 1),
    openingWeekEnd: toInt(body.openingWeekEnd, 9),
    conferences: (body.conferences ?? []).map((c) => ({
      name: String(c?.name ?? ''),
      leagueIds: (c?.leagueIds ?? []).map((id) => String(id)),
    })),
    advancersPerLeague: toInt(body.advancersPerLeague, 0),
    wildcardCount: toInt(body.wildcardCount, 0),
    bubbleEnabled: Boolean(body.bubbleEnabled),
    bubbleSize: toInt(body.bubbleSize, 0),
    bubbleWeek: toWeek(body.bubbleWeek),
    redraftWeek: toWeek(body.redraftWeek),
    eliteRedraftWeek: toWeek(body.eliteRedraftWeek),
    championshipWeek: toWeek(body.championshipWeek),
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    tournamentId: result.tournamentId,
    leagueCount: result.leagueCount,
    participantCount: result.participantCount,
    renamedLeagues: result.renamedLeagues,
    orphanTeamCount: result.orphanTeamCount,
    note: 'Nothing was created on any platform — this records that these leagues are one tournament.',
  })
}
