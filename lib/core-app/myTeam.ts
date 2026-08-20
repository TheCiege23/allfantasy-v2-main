import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { latestProjectionWeek, lookupProjections, summariseLineup } from './playerProjections'

/**
 * My team · roster — "read-only view of your real lineup, with the fix and where
 * to make it".
 *
 * Identifying WHICH roster is yours goes LeagueTeam.claimedByUserId → its
 * platformUserId/externalId → Roster.platformUserId. Roster.platformUserId is
 * the always-set column; LeagueTeam.platformUserId is nullable and gating on it
 * has previously locked real members out of their own league, so it is used as a
 * hint here and never as the sole key.
 *
 * The lineup itself is real: Roster.playerData carries `starters` in slot order
 * plus `players`, `reserve` and `taxi`. Each id resolves through
 * SportsPlayer.sleeperId to a name, position, team and headshot.
 *
 * Game context and the lineup lock are derived from the INGESTED SCHEDULE — the
 * kickoff of each starter's real-world game — rather than from a projection feed
 * we do not have. That makes the countdown in the handoff's lock banner a real
 * number instead of a decorative one.
 */

export type LineupPlayer = {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** "DEN vs LV · 4:05p" — from the ingested schedule, null when unknown. */
  gameContext: string | null
  kickoff: Date | null
  injuryStatus: string | null
  /**
   * Weekly projection for this player, or null when the feed does not carry him.
   *
   * ⚠ NULL IS NOT ZERO. A slot showing "—" is a player we cannot price; a slot
   * showing 0.0 would claim we expect him to score nothing. Those are different
   * statements and only one of them is true.
   */
  projectedPoints: number | null
}

export type LineupSlot = {
  slotLabel: string
  player: LineupPlayer | null
  /**
   * The slot genuinely holds nobody — the platform recorded an unfilled starter.
   * This drives the handoff's --bad-soft empty state and the lock-time urgency.
   */
  empty: boolean
  /**
   * A player IS in this slot, but we could not resolve his id to a player row.
   *
   * ⚠ Kept strictly separate from `empty`. An unresolved id means our identity
   * bridge failed; an empty slot means the user has a hole in their lineup.
   * Rendering the first as the second tells someone their FLEX is empty when a
   * player is sitting in it — and sends them to the platform to fix nothing.
   */
  unresolvedId: string | null
}

export type MyTeamData = {
  league: { id: string; name: string; platform: string; format: string | null }
  team: SectionState<{
    teamName: string
    ownerName: string
    record: string
    rank: number | null
    pointsFor: number
    pointsAgainst: number
    teamCount: number
  }>
  starters: SectionState<LineupSlot[]>
  bench: SectionState<LineupPlayer[]>
  reserve: SectionState<LineupPlayer[]>
  /** Earliest kickoff among starters — the real lineup lock. */
  lock: SectionState<{ at: Date; anyEmptySlot: boolean }>
  /**
   * The lineup's projected total.
   *
   * ⚠ CARRIES `unprojected` SO A FRAGMENT CANNOT POSE AS A TOTAL. Two of six
   * sampled production lineups are only partly priced, so this is the common case.
   * A total built from 5 of 8 starters always reads LOW — the direction that makes
   * a manager bench someone they should start.
   */
  projections: SectionState<{
    total: number
    projected: number
    unprojected: number
    season: string
    week: number
  }>
  rosterGrade: UnavailableSection
  liveScore: UnavailableSection
}

/** Slot labels in the order fantasy lineups conventionally read. */
function inferSlotLabel(position: string | null, index: number): string {
  const p = (position ?? '').toUpperCase()
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'].includes(p)) return p === 'DST' ? 'DEF' : p
  return p || `SLOT ${index + 1}`
}

function formatKickoff(d: Date | null): string | null {
  if (!d) return null
  const hours = d.getUTCHours()
  const mins = d.getUTCMinutes()
  const ampm = hours >= 12 ? 'p' : 'a'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  return `${h12}:${String(mins).padStart(2, '0')}${ampm}`
}

async function resolvePlayers(
  ids: string[],
  sport: string,
  projectionWeek: { season: string; week: number } | null
): Promise<Map<string, LineupPlayer>> {
  const out = new Map<string, LineupPlayer>()
  if (ids.length === 0) return out

  const rows = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: ids } },
    select: { sleeperId: true, name: true, position: true, team: true, imageUrl: true },
  })

  // One upcoming game per team, so a lineup row can say who the player faces and
  // when. Pulled once for the whole roster rather than per player.
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))] as string[]
  const games =
    teams.length > 0
      ? await prisma.sportsGame
          .findMany({
            where: {
              sport,
              startTime: { gte: new Date(Date.now() - 6 * 3600 * 1000) },
              OR: [{ homeTeam: { in: teams } }, { awayTeam: { in: teams } }],
            },
            orderBy: { startTime: 'asc' },
            take: 400,
            select: { homeTeam: true, awayTeam: true, startTime: true },
          })
          .catch(() => [])
      : []

  const nextGameFor = new Map<string, { opponent: string; home: boolean; at: Date | null }>()
  for (const g of games) {
    for (const [team, opponent, home] of [
      [g.homeTeam, g.awayTeam, true],
      [g.awayTeam, g.homeTeam, false],
    ] as const) {
      if (!teams.includes(team)) continue
      if (nextGameFor.has(team)) continue
      nextGameFor.set(team, { opponent, home, at: g.startTime })
    }
  }

  const injuries = await prisma.sportsInjury
    .findMany({
      where: { sport, playerName: { in: rows.map((r) => r.name) } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true },
    })
    .catch(() => [])
  const injuryByName = new Map(injuries.map((i) => [i.playerName.toLowerCase(), i.status]))

  /*
   * ⚠ PROJECTIONS ARE JOINED HERE BECAUSE THIS IS WHERE THE IDS ALREADY ARE, and
   * because the ids are the same shape the feed is keyed by — Sleeper ids. That
   * coincidence is the whole reason both screens can be priced at all; it is not a
   * given for every platform and the join will silently return nothing the day an
   * importer writes a different id space.
   */
  const projections = await lookupProjections(ids, projectionWeek)

  for (const r of rows) {
    if (!r.sleeperId) continue
    const g = r.team ? nextGameFor.get(r.team) : undefined
    const time = formatKickoff(g?.at ?? null)
    out.set(r.sleeperId, {
      sleeperId: r.sleeperId,
      name: r.name,
      position: r.position,
      team: r.team,
      imageUrl: r.imageUrl,
      gameContext: g ? `${r.team} ${g.home ? 'vs' : '@'} ${g.opponent}${time ? ` · ${time}` : ''}` : null,
      kickoff: g?.at ?? null,
      injuryStatus: injuryByName.get(r.name.toLowerCase()) ?? null,
      projectedPoints: projections.get(r.sleeperId)?.projectedPoints ?? null,
    })
  }

  return out
}

export async function getMyTeamData(leagueId: string, userId: string): Promise<MyTeamData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, leagueType: true, sport: true },
  })
  if (!league) return null

  const sport = String(league.sport ?? 'NFL')
  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
    },
    /*
     * The default for the early-return paths only — a roster we never found cannot
     * be projected. The full path overrides this with a real summary. It is
     * deliberately NOT phrased as "no feed exists", which is what it used to say
     * and was false: the feed carries 994 rows.
     */
    projections: {
      available: false as const,
      reason: 'no lineup found to project',
    },
    rosterGrade: {
      available: false as const,
      reason: 'a roster grade needs projections and positional replacement levels we do not compute yet',
    },
    liveScore: { available: false as const, reason: 'no live scoring ingested for imported leagues' },
  }

  const myTeamRow = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: {
      teamName: true, ownerName: true, wins: true, losses: true, ties: true,
      pointsFor: true, pointsAgainst: true, currentRank: true,
      platformUserId: true, externalId: true,
    },
  })

  const teamCount = await prisma.leagueTeam.count({ where: { leagueId } })

  if (!myTeamRow) {
    const unknown = {
      available: false as const,
      reason: 'we cannot tell which team in this league is yours — claim it and the lineup appears here',
    }
    return {
      ...base,
      team: unknown,
      starters: unknown,
      bench: unknown,
      reserve: unknown,
      lock: unknown,
    }
  }

  const anyResults =
    myTeamRow.wins > 0 || myTeamRow.losses > 0 || myTeamRow.ties > 0 || myTeamRow.pointsFor > 0

  const team: MyTeamData['team'] = {
    available: true,
    data: {
      teamName: myTeamRow.teamName,
      ownerName: myTeamRow.ownerName,
      // Same rule as screen 2: an all-zero record is an absence, not a result.
      record: anyResults
        ? myTeamRow.ties > 0
          ? `${myTeamRow.wins}-${myTeamRow.losses}-${myTeamRow.ties}`
          : `${myTeamRow.wins}-${myTeamRow.losses}`
        : 'no results read yet',
      rank: myTeamRow.currentRank,
      pointsFor: myTeamRow.pointsFor,
      pointsAgainst: myTeamRow.pointsAgainst,
      teamCount,
    },
  }

  /*
   * Roster.platformUserId is always set; LeagueTeam.platformUserId is not, so it
   * is one candidate among several rather than the key.
   *
   * ⚠ `userId` IS IN THIS LIST BECAUSE Roster.platformUserId SOMETIMES HOLDS OUR
   * OWN User UUID, NOT THE PLATFORM'S ID. Measured on production: with only the
   * first two candidates, 38 of 106 claimed teams joined to a roster and just 11
   * had a lineup — so My Team rendered "no roster imported" to roughly two thirds
   * of the people it was built for, over rosters that were sitting right there.
   * Adding this candidate takes it to 93 joined / 51 with lineups and matches more
   * than one roster for exactly ZERO teams, so it widens recall without ever
   * risking showing someone another manager's team.
   */
  const candidates = [
    myTeamRow.platformUserId,
    myTeamRow.externalId,
    userId,
  ].filter(Boolean) as string[]
  const roster =
    candidates.length > 0
      ? await prisma.roster.findFirst({
          where: { leagueId, platformUserId: { in: candidates } },
          select: { playerData: true },
        })
      : null

  if (!roster) {
    const noRoster = {
      available: false as const,
      reason: 'no roster rows imported for your team in this league',
    }
    return { ...base, team, starters: noRoster, bench: noRoster, reserve: noRoster, lock: noRoster }
  }

  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const asIds = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []

  const starterIds = asIds(pd.starters)
  const allIds = asIds(pd.players)
  const reserveIds = asIds(pd.reserve)
  const taxiIds = asIds(pd.taxi)

  /*
   * ⚠ THE WEEK COMES FROM THE FEED, NOT FROM THE LEAGUE'S CLOCK. `currentWeek` and
   * the week the projection cron last wrote drift apart constantly, and asking for
   * a week nobody has written yet returns nothing — which would render "no
   * projections" on a screen whose actual problem was asking the wrong question.
   */
  const projectionWeek = await latestProjectionWeek()

  const resolved = await resolvePlayers(
    [...new Set([...starterIds, ...allIds, ...reserveIds, ...taxiIds])],
    sport,
    projectionWeek
  )

  // Sleeper encodes an unfilled starting slot as "0" — that is the handoff's
  // "FLEX is empty" state, and it must survive as an empty slot rather than
  // being filtered out into a shorter lineup that looks complete.
  const starters: LineupSlot[] = starterIds.map((id, i) => {
    const isEmptySlot = id === '0'
    const player = isEmptySlot ? null : resolved.get(id) ?? null
    return {
      slotLabel: inferSlotLabel(player?.position ?? null, i),
      player,
      empty: isEmptySlot,
      // Present id, no player row — a lookup failure, NOT an empty slot.
      unresolvedId: !isEmptySlot && player == null ? id : null,
    }
  })

  const starterSet = new Set(starterIds)
  const benchIds = allIds.filter((id) => !starterSet.has(id) && !reserveIds.includes(id))

  const kickoffs = starters
    .map((s) => s.player?.kickoff)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())

  /*
   * ⚠ SUMMARISED OVER THE STARTERS AS STORED — INCLUDING THE "0" HOLES. An empty
   * slot is genuinely worth nothing to the lineup, but it is also not a player we
   * failed to price, so it must not inflate `unprojected` into a coverage problem.
   * Filtering it out here keeps the two failure modes — "you have a hole" and "we
   * can't price this guy" — separate, because the fixes are different.
   */
  const projectedIds = starterIds.filter((id) => id !== '0')
  const lineup = summariseLineup(
    projectedIds,
    new Map(
      projectedIds
        .map((id) => [id, resolved.get(id)] as const)
        .filter(([, p]) => p != null && p.projectedPoints != null)
        .map(([id, p]) => [
          id,
          { playerId: id, projectedPoints: p!.projectedPoints as number, name: p!.name, position: p!.position, team: p!.team },
        ])
    )
  )

  return {
    ...base,
    team,
    projections:
      projectionWeek && projectedIds.length > 0
        ? {
            available: true,
            data: { ...lineup, season: projectionWeek.season, week: projectionWeek.week },
          }
        : {
            available: false,
            reason: projectionWeek
              ? 'no starters to project on this roster'
              : 'no weekly projection feed has been ingested yet',
          },
    starters:
      starters.length > 0
        ? { available: true, data: starters }
        : { available: false, reason: 'no starting lineup recorded on this roster' },
    bench:
      benchIds.length > 0
        ? { available: true, data: benchIds.map((id) => resolved.get(id)).filter(Boolean) as LineupPlayer[] }
        : { available: false, reason: 'no bench players recorded on this roster' },
    reserve:
      reserveIds.length + taxiIds.length > 0
        ? {
            available: true,
            data: [...reserveIds, ...taxiIds]
              .map((id) => resolved.get(id))
              .filter(Boolean) as LineupPlayer[],
          }
        : { available: false, reason: 'no IR or taxi players on this roster' },
    lock:
      kickoffs.length > 0
        ? { available: true, data: { at: kickoffs[0], anyEmptySlot: starters.some((s) => s.empty) } }
        : {
            available: false,
            reason: 'no upcoming game found for your starters, so there is no lock time to count down to',
          },
  }
}
