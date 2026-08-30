import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isIdpLeague } from '@/lib/idp'
import { getAllPlayers, type SleeperPlayer } from '@/lib/sleeper-client'
import { isIdpPosition } from '@/lib/idp-kicker-values'
import { getRosteredPlayerIdsInLeague, matchesIdpPositionFilter } from '@/lib/idp/idpRouteHelpers'
import { prisma } from '@/lib/prisma'
import { loadDefenseHub } from '@/lib/idp-projections/defenseHub'
import { loadLeagueDefenderBoard } from '@/lib/values/leagueDefenderBoard'
import { loadLeagueKickerValue } from '@/lib/kicker-values/loadLeagueKickerValue'
import {
  resolveLeagueValueSurfaces,
  resolveUserValueSurfaces,
} from '@/lib/values/valueSurfaceEligibility'
import { loadIdpMatchup } from '@/lib/idp-projections/idpMatchup'
import { loadIdpPlayerCard } from '@/lib/idp-projections/idpPlayerCard'
import { loadRosterWeekPoints } from '@/lib/idp-projections/rosterWeekPoints'
import { loadWaiverBoard } from '@/lib/waivers/waiverBoard'

export const dynamic = 'force-dynamic'

function toPublicPlayer(p: SleeperPlayer) {
  return {
    playerId: p.player_id,
    name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
    position: p.position,
    team: p.team,
    status: p.status,
  }
}

/**
 * GET /api/idp/players
 * NFL IDP player pool from Sleeper, scoped to an IDP league.
 *
 * Query:
 * - leagueId (required)
 * - pool=waiver | all — waiver = exclude anyone on a roster in this league (default waiver)
 * - position — DL | LB | DB | DE | DT | CB | S | …
 * - q — case-insensitive substring on name
 * - limit — max rows (default 50, max 150)
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const leagueId = searchParams?.get('leagueId')?.trim() ?? ''

  /*
   * ⚠ THE ONE VIEW THAT ANSWERS WITHOUT A LEAGUE, AND IT HAS TO SIT ABOVE THE GUARD BELOW.
   *
   * `/core` is the manager's home ACROSS his leagues, not one of them, so "should the values
   * link appear" is a question about him rather than about a league id he has not chosen yet.
   * Requiring `leagueId` here would make the core surface unable to ask at all.
   *
   * It is still fully scoped: the answer is derived only from leagues this user owns or has
   * claimed a team in, and it returns three booleans — never a roster, a name or a value.
   */
  if ((searchParams?.get('view') ?? '').toLowerCase() === 'value-eligibility' && !leagueId) {
    const payload = await resolveUserValueSurfaces(prisma, userId).catch(() => null)
    return NextResponse.json(payload ?? { hasIdp: false, hasKicker: false, eligible: false })
  }

  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  /*
   * The Defense Hub payload rides on this route rather than a new one: the route budget is at
   * its ceiling, and this endpoint already resolves exactly the auth and league scoping the hub
   * needs.
   *
   * ⚠ IT RETURNS BEFORE THE `isIdpLeague` GUARD BELOW, DELIBERATELY. That guard 404s a
   * non-IDP league, which is right for a player pool — there is no pool to serve. The hub has
   * something to say about that league: that it does not roster defenders, which is a state to
   * render and not an error. Answering it with a 404 would make "this page isn't for you" look
   * to the client like a failed request.
   */
  const view = (searchParams?.get('view') ?? '').toLowerCase()
  if (view === 'defense-hub') {
    const payload = await loadDefenseHub({ prisma, leagueId, userId })
    return NextResponse.json(payload)
  }
  /*
   * ⚠ ALSO BEFORE THE `isIdpLeague` GUARD, AND FOR A STRONGER REASON THAN THE HUB ABOVE.
   *
   * Kickers have nothing to do with IDP. Measured on production: 19 leagues start a kicker and
   * only 5 of them score IDP, so gating this behind the guard below would answer for a quarter
   * of the leagues that actually have the question and 404 the rest.
   *
   * It rides this route because the route budget is at its ceiling and this endpoint already
   * resolves the auth and league scoping the answer needs. A league that starts no kicker gets
   * `value: null`, which the client renders as nothing at all.
   */
  /*
   * League-scoped twin of the check above. Rides this route for the same reason everything
   * else here does — the repo is at its route ceiling — and sits before the `isIdpLeague`
   * guard because a league that scores NO IDP is exactly the case it has to answer for.
   */
  if (view === 'value-eligibility') {
    const payload = await resolveLeagueValueSurfaces(prisma, leagueId).catch(() => null)
    return NextResponse.json(payload ?? { hasIdp: false, hasKicker: false, eligible: false })
  }
  if (view === 'kicker-value') {
    const payload = await loadLeagueKickerValue({ prisma, leagueId })
    return NextResponse.json(payload ?? { value: null })
  }
  /*
   * The trade board: every defender in the league and what he is worth HERE, with the team
   * holding him.
   *
   * 🛑 THE DIFFERENCE FROM `defense-hub` IS ONE WORD, AND IT IS THE WHOLE FEATURE. The hub
   * prices the entire league — it must, because replacement level is a property of the league —
   * and then renders only the caller's own players. So a manager could see what HIS linebacker
   * was worth and had no way to ask what the one he wants to trade for is worth. The values
   * were already computed and thrown away.
   *
   * ⚠ SAME PLACEMENT LOGIC AS THE HUB: before the `isIdpLeague` guard, because "this league
   * does not roster defenders" is a state worth rendering rather than a 404, and on this route
   * rather than a new one because the repo is at its route ceiling.
   */
  if (view === 'trade-board') {
    const payload = await loadLeagueDefenderBoard({ prisma, leagueId, userId })
    return NextResponse.json(payload)
  }
  if (view === 'waiver-board') {
    const lim = Number(searchParams?.get('limit'))
    const payload = await loadWaiverBoard({
      prisma,
      leagueId,
      userId,
      limit: Number.isFinite(lim) && lim > 0 ? lim : undefined,
    })
    return NextResponse.json(payload)
  }
  if (view === 'roster-week') {
    const payload = await loadRosterWeekPoints({ prisma, leagueId, userId })
    return NextResponse.json(payload)
  }
  if (view === 'player-card') {
    const playerId = searchParams?.get('playerId')?.trim() ?? ''
    if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 })
    const seasonParam = Number(searchParams?.get('season'))
    const payload = await loadIdpPlayerCard({
      prisma,
      leagueId,
      playerId,
      season:
        Number.isFinite(seasonParam) && seasonParam > 0 ? seasonParam : new Date().getFullYear(),
    })
    return NextResponse.json(payload)
  }
  if (view === 'idp-matchup') {
    const seasonParam = Number(searchParams?.get('season'))
    const weekParam = Number(searchParams?.get('week'))
    const payload = await loadIdpMatchup({
      prisma,
      leagueId,
      userId,
      season: Number.isFinite(seasonParam) && seasonParam > 0 ? seasonParam : undefined,
      week: Number.isFinite(weekParam) && weekParam > 0 ? weekParam : undefined,
    })
    return NextResponse.json(payload)
  }

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const pool = (searchParams?.get('pool') ?? 'waiver').toLowerCase()
  const poolWaiver = pool !== 'all'
  const positionFilter = searchParams?.get('position')?.trim() ?? ''
  const q = searchParams?.get('q')?.trim().toLowerCase() ?? ''
  const limit = Math.min(150, Math.max(1, Number(searchParams?.get('limit') || '50') || 50))

  const [all, rostered] = await Promise.all([getAllPlayers(), poolWaiver ? getRosteredPlayerIdsInLeague(leagueId) : null])

  const out: ReturnType<typeof toPublicPlayer>[] = []
  for (const p of Object.values(all)) {
    if (!p?.player_id || !isIdpPosition(p.position)) continue
    if (poolWaiver && rostered?.has(p.player_id)) continue
    if (positionFilter && !matchesIdpPositionFilter(p.position, positionFilter)) continue
    const name = (p.full_name || `${p.first_name} ${p.last_name}`).toLowerCase()
    if (q && !name.includes(q)) continue
    out.push(toPublicPlayer(p))
    if (!q && out.length >= limit) break
  }
  const players = q ? out.slice(0, limit) : out

  return NextResponse.json({
    leagueId,
    pool: poolWaiver ? 'waiver' : 'all',
    count: players.length,
    players,
  })
}

