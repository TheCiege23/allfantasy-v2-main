import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveSleeperPlayerIdentities } from '@/lib/players/sleeperPlayerCrosswalk'

/**
 * One team's roster, for the Trade Value Console.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * The console could list a league's TEAMS and nothing about what they own. `league-teams` returns
 * `teamName`/`ownerName`/`platformUserId` only, and the modal's sole way to fill a side was
 * `player-search` — you typed a player's name from memory. Building a trade therefore meant
 * opening Sleeper in another tab to see who was on each roster, which defeats the point of the
 * tool.
 *
 * ⚠ It is also upstream of the Decision OS parity work. With no roster the canonical value engine
 * cannot price a deal, returns `confidenceScore: 0`, and the verdict reads "even" with no signal —
 * exactly the hollow agreement the Phase 3 flip gate must not count. Users who cannot easily build
 * a realistic trade cannot generate a useful parity sample.
 *
 * ── Two sources, in order, because neither covers everything ──────────────────────────────────
 *
 * Measured on production 2026-09-04, of 3,202 league teams carrying a `platformUserId`:
 *
 *     3,044 (95%) link to a RedraftRoster via ownerId
 *     2,577 (80%) have RedraftRosterPlayer rows
 *
 * 1. `RedraftRosterPlayer` — PREFERRED. Carries `playerName`, `position`, `team`, `slotType`,
 *    `injuryStatus` and `byeWeek` already resolved, so no id crosswalk is needed and the names are
 *    whatever the import recorded rather than whatever a fuzzy match produces.
 * 2. `Roster.playerData.players` — FALLBACK for the ~20% with no redraft rows. That column holds
 *    Sleeper ids, so it needs `resolveSleeperPlayerIdentities`, which reports what it could not
 *    resolve rather than dropping it.
 *
 * The response says which source answered (`source`), because a caller comparing two teams should
 * be able to see that one came from resolved rows and the other from an id crosswalk.
 *
 * 🛑 UNRESOLVED PLAYERS ARE REPORTED, NEVER DROPPED. A roster of 22 that renders 20 rows with no
 * explanation is indistinguishable from a 20-player roster. Silence about a gap is the failure
 * mode this codebase keeps paying for.
 */

type RosterRow = {
  kind: 'player'
  sport: string
  playerId: string | null
  name: string
  position: string
  team: string
  headshotUrl: string | null
  slot: string
  injuryStatus?: string | null
  byeWeek?: number | null
  resolved: boolean
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req as any) || 'unknown'
  const rl = rateLimit(`trade-value-league-roster:${ip}`, 40, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  const platformUserId = req.nextUrl.searchParams.get('platformUserId')?.trim()
  if (!leagueId || !platformUserId) {
    return NextResponse.json({ error: 'Missing leagueId or platformUserId' }, { status: 400 })
  }

  // The same gate `league-teams` uses. A roster is more than a team name, so this must not be
  // looser than the endpoint that merely lists who is in the league.
  const access = await assertLeagueMember(leagueId, userId)
  if (!access.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
  const sport = (league?.sport ?? 'NFL').toUpperCase()

  // ── Source 1: RedraftRosterPlayer, names already resolved ───────────────────────────────────
  const redraftRoster = await prisma.redraftRoster.findFirst({
    where: { leagueId, ownerId: platformUserId },
    select: {
      id: true,
      players: {
        where: { droppedAt: null },
        select: {
          playerId: true,
          playerName: true,
          position: true,
          team: true,
          slotType: true,
          injuryStatus: true,
          byeWeek: true,
        },
        orderBy: [{ slotType: 'asc' }, { playerName: 'asc' }],
      },
    },
  })

  if (redraftRoster && redraftRoster.players.length > 0) {
    const players: RosterRow[] = redraftRoster.players.map((p) => ({
      kind: 'player',
      sport,
      playerId: p.playerId,
      name: p.playerName,
      position: p.position ?? '',
      team: p.team ?? '',
      headshotUrl: null,
      slot: p.slotType ?? 'bench',
      injuryStatus: p.injuryStatus,
      byeWeek: p.byeWeek,
      resolved: true,
    }))
    return NextResponse.json({
      players,
      resolved: players.length,
      unresolved: 0,
      unresolvedIds: [],
      synced: true,
      source: 'redraft_roster_players',
    })
  }

  // ── Source 2: Roster.playerData, Sleeper ids needing a crosswalk ────────────────────────────
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId },
    select: { playerData: true },
  })

  if (!roster) {
    // A real answer, not an error: some teams genuinely have no synced roster, and the caller must
    // be able to say so rather than render an empty list that looks like an empty team.
    return NextResponse.json({
      players: [],
      resolved: 0,
      unresolved: 0,
      unresolvedIds: [],
      synced: false,
      source: 'none',
    })
  }

  const data = (roster.playerData ?? {}) as Record<string, unknown>
  const asIds = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

  const allIds = asIds(data.players)
  const starterIds = new Set(asIds(data.starters))
  const taxiIds = new Set(asIds(data.taxi))
  const reserveIds = new Set(asIds(data.reserve))

  if (allIds.length === 0) {
    return NextResponse.json({
      players: [],
      resolved: 0,
      unresolved: 0,
      unresolvedIds: [],
      synced: true,
      empty: true,
      source: 'roster_player_data',
    })
  }

  const crosswalk = await resolveSleeperPlayerIdentities(allIds, sport)

  const players: Array<RosterRow & { sleeperId: string }> = allIds.map((sleeperId) => {
    const hit = crosswalk.byId.get(sleeperId)
    return {
      kind: 'player',
      sport,
      // Retained so an unresolved row can name ITSELF. Deriving the id afterwards from a filtered
      // array's index reads the wrong element — the index is into the filtered list, not allIds.
      sleeperId,
      playerId: hit?.canonicalPlayerId ?? null,
      // An unresolved id keeps its id as the label rather than rendering blank — the row is still a
      // real roster slot, and hiding it would under-report the team.
      name: hit?.name ?? `Unknown player (${sleeperId})`,
      position: hit?.position ?? '',
      team: hit?.team ?? '',
      headshotUrl: hit?.imageUrl ?? null,
      slot: starterIds.has(sleeperId)
        ? 'starter'
        : taxiIds.has(sleeperId)
          ? 'taxi'
          : reserveIds.has(sleeperId)
            ? 'reserve'
            : 'bench',
      resolved: Boolean(hit?.name),
    }
  })

  return NextResponse.json({
    players,
    resolved: crosswalk.resolved,
    unresolved: crosswalk.unresolved,
    // The ids themselves, so a support question about a missing player is answerable without a
    // database session.
    unresolvedIds: players.filter((p) => !p.resolved).map((p) => p.sleeperId),
    synced: true,
    source: 'roster_player_data',
  })
}
