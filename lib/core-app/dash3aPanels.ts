import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The three 3a panels that were shipped as "no engine exists".
 *
 * ⚠ ALL THREE CLAIMS WERE WRONG, AND THIS FILE IS THE CORRECTION. Player
 * exposure, rivalry records and the opponent's identity were each described in
 * the screen as needing an engine nobody had built. Every one of them is
 * derivable from tables this codebase already reads on other screens:
 *
 *   - EXPOSURE  `Roster.playerData` holds `players` / `starters` / `reserve` /
 *               `taxi` as platform ids, and `dash34` already resolves those ids
 *               to names through `SportsPlayer.sleeperId`. Counting how many of
 *               your rosters contain a player IS the exposure number.
 *   - RIVALS    `WeeklyMatchup.matchupId` pairs two `rosterId`s inside a week, so
 *               the opponent is the other row with the same `matchupId`. Walking
 *               every stored week gives a real head-to-head record.
 *
 * `lib/core-app/matchupProjections.ts` already carries this exact lesson in its
 * header — sections marked "not ingested" over data that was sitting right
 * there. Writing "we don't have this" when we do is its own kind of lie, and it
 * is more expensive than a missing feature because nobody goes back to check.
 *
 * WHAT IS STILL HONESTLY MISSING is narrower and named where it applies: when a
 * rival is usually online (nothing records it), and per-player weekly scoring for
 * imported leagues.
 */

export type PanelState<T> = { available: true; data: T } | { available: false; reason: string }

export type ExposureRow = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  /** Rosters of yours holding this player. */
  count: number
  /** Rosters of yours we could actually read. The "N of M" denominator. */
  of: number
  /** True when they start for you everywhere they are rostered. */
  everyStart: boolean
}

export type ExposureData = {
  rows: ExposureRow[]
  /** Rosters read. Smaller than your league count when a league has no roster. */
  rostersRead: number
  /** Plain-language concentration callout, or null when nothing is concentrated. */
  note: string | null
}

export type RivalRow = {
  key: string
  name: string
  wins: number
  losses: number
  meetings: number
  sharedLeagues: number
  /** Their most recent margin against you, when the last meeting was a loss. */
  lastResult: string | null
}

export type RivalsData = { rows: RivalRow[]; leaguesRead: number }

/**
 * Candidates for `Roster.platformUserId`.
 *
 * ⚠ `userId` BELONGS IN THIS LIST. Measured on production by `myTeam`: with only
 * the platform ids, 38 of 106 claimed teams joined to a roster. Adding our own
 * User uuid takes it to 93, and matches more than one roster for exactly zero
 * teams — recall without ever showing someone another manager's roster.
 */
function rosterCandidates(
  team: { platformUserId: string | null; externalId: string | null },
  userId: string,
): string[] {
  return [team.platformUserId, team.externalId, userId].filter(Boolean) as string[]
}

function asIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String).filter((s) => s.length > 0) : []
}

/**
 * A starter stored as `"name:Lamar Jackson:QB:BAL"` is the importer's fallback
 * when it could not resolve a platform id. It can never join to a player row, so
 * it is dropped from exposure rather than counted as a distinct "player".
 */
function isResolvableId(raw: string): boolean {
  return raw.length > 0 && !raw.startsWith('name:')
}

/**
 * Cross-league player exposure: how many of your rosters hold each player.
 *
 * Deliberately counts EVERY rostered player, not just starters — the question the
 * panel answers is "how much of my season rides on this one player", and a bench
 * stash is still exposure. `everyStart` carries the sharper signal separately.
 */
export async function getCrossLeagueExposure(
  userId: string,
  leagueIds: string[],
  limit = 6,
): Promise<PanelState<ExposureData>> {
  if (leagueIds.length === 0) {
    return { available: false, reason: 'no leagues imported yet' }
  }

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: { in: leagueIds }, claimedByUserId: userId },
      select: { leagueId: true, platformUserId: true, externalId: true },
    })
    .catch(() => [])

  if (teams.length === 0) {
    return {
      available: false,
      reason: 'none of your leagues have a team claimed by you, so there is no roster to read',
    }
  }

  const rosters = await prisma.roster
    .findMany({
      where: {
        OR: teams.map((t) => ({
          leagueId: t.leagueId,
          platformUserId: { in: rosterCandidates(t, userId) },
        })),
      },
      select: { leagueId: true, playerData: true },
    })
    .catch(() => [])

  if (rosters.length === 0) {
    return {
      available: false,
      reason: 'your teams are claimed but no roster rows were imported for them yet',
    }
  }

  // One roster per league — a league should only produce one for a given user,
  // and overwriting on a duplicate would silently pick an arbitrary one.
  const seen = new Set<string>()
  const held = new Map<string, { count: number; starts: number }>()
  let rostersRead = 0

  for (const r of rosters) {
    if (seen.has(r.leagueId)) continue
    seen.add(r.leagueId)
    rostersRead += 1

    const pd = (r.playerData ?? {}) as Record<string, unknown>
    const starters = new Set(asIds(pd.starters).filter(isResolvableId))
    const all = new Set(
      [...asIds(pd.players), ...starters, ...asIds(pd.reserve), ...asIds(pd.taxi)].filter(
        isResolvableId,
      ),
    )
    for (const id of all) {
      const prev = held.get(id) ?? { count: 0, starts: 0 }
      held.set(id, { count: prev.count + 1, starts: prev.starts + (starters.has(id) ? 1 : 0) })
    }
  }

  if (held.size === 0) {
    return { available: false, reason: 'your rosters imported with no resolvable player ids' }
  }

  const ranked = [...held.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, limit)
  const ids = ranked.map(([id]) => id)

  /*
   * `SportsPlayer.sleeperId` is the right join and it is populated — 99,290 rows,
   * 15,043 carrying a sleeperId, measured on the test database. `myTeam` reads the
   * same table, so the two surfaces cannot disagree about a player's name.
   *
   * An id that does not resolve is NOT a broken join. Rosters imported from some
   * paths store a descriptor (`"name:Lamar Jackson:QB:BAL"`) instead of a platform
   * id, and seeded fixtures carry neither; those are filtered out above and any
   * survivor that still misses is labelled honestly rather than dropped, because
   * dropping it would understate exposure.
   */
  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: ids } },
      select: { sleeperId: true, name: true, position: true, team: true },
    })
    .catch(() => [])
  const byId = new Map(players.map((p) => [p.sleeperId, p]))

  const rows: ExposureRow[] = ranked.map(([id, agg]) => {
    const p = byId.get(id)
    return {
      playerId: id,
      // An unresolved id still counts — dropping it would understate exposure.
      // It is labelled honestly rather than rendered as a blank row.
      name: p?.name ?? 'Unmatched player',
      position: p?.position ?? null,
      team: p?.team ?? null,
      count: agg.count,
      of: rostersRead,
      everyStart: agg.count > 1 && agg.starts === agg.count,
    }
  })

  const top = rows[0]
  const note =
    top && top.count > 1 && top.count === rostersRead
      ? `${top.name} is on every roster you own — one hamstring and your whole Sunday moves.`
      : top && top.count > 1
        ? `${top.name} is on ${top.count} of your ${rostersRead} rosters.`
        : null

  return { available: true, data: { rows, rostersRead, note } }
}

/**
 * Head-to-head records against the managers you actually play.
 *
 * Built from `WeeklyMatchup`: rows sharing a `matchupId` inside one week are the
 * two sides of a game, so the opponent is the other row. Walking every stored
 * week and season gives a real record rather than an impression.
 *
 * ⚠ `WeeklyMatchup.leagueId` IS THE PLATFORM LEAGUE ID, NOT `League.id`. They are
 * different id spaces and joining the wrong one returns zero rows while looking
 * perfectly correct — the failure mode this repo has hit repeatedly.
 */
export async function getRivalRecords(
  userId: string,
  leagueIds: string[],
  limit = 4,
): Promise<PanelState<RivalsData>> {
  if (leagueIds.length === 0) {
    return { available: false, reason: 'no leagues imported yet' }
  }

  const leagues = await prisma.league
    .findMany({
      // `platformLeagueId` is NON-NULLABLE in the schema, so the absent case is
      // an empty string, not null. Filtering on `{ not: null }` does not compile
      // and would also have silently matched every row.
      where: { id: { in: leagueIds }, platformLeagueId: { not: '' } },
      select: { id: true, platformLeagueId: true },
    })
    .catch(() => [])
  if (leagues.length === 0) {
    return {
      available: false,
      reason: 'none of your leagues carry a platform id, so their weekly results cannot be located',
    }
  }

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: { in: leagues.map((l) => l.id) } },
      select: { leagueId: true, externalId: true, teamName: true, ownerName: true, claimedByUserId: true },
    })
    .catch(() => [])

  const agg = new Map<string, { name: string; wins: number; losses: number; leagues: Set<string>; last: string | null }>()
  let leaguesRead = 0

  for (const league of leagues) {
    const platformLeagueId = league.platformLeagueId

    const leagueTeams = teams.filter((t) => t.leagueId === league.id)
    const mine = leagueTeams.find((t) => t.claimedByUserId === userId)
    if (!mine?.externalId) continue

    const myRosterId = Number.parseInt(String(mine.externalId), 10)
    if (!Number.isFinite(myRosterId)) continue

    const rows = await prisma.weeklyMatchup
      .findMany({
        where: { leagueId: platformLeagueId },
        select: { seasonYear: true, week: true, rosterId: true, matchupId: true, pointsFor: true },
      })
      .catch(() => [])
    if (rows.length === 0) continue
    leaguesRead += 1

    const nameByRoster = new Map(
      leagueTeams.map((t) => [String(t.externalId), t.ownerName || t.teamName || 'Unknown manager']),
    )

    // Index by week so the opponent lookup is not O(n^2) across a full history.
    type WeekRowLite = {
      seasonYear: number
      week: number
      rosterId: number
      matchupId: number | null
      pointsFor: number
    }
    const byWeek = new Map<string, WeekRowLite[]>()
    for (const r of rows) {
      const k = `${r.seasonYear}:${r.week}`
      const list = byWeek.get(k)
      if (list) list.push(r)
      else byWeek.set(k, [r])
    }

    /*
     * ⚠ WALKED IN CHRONOLOGICAL ORDER ON PURPOSE. `lastResult` is overwritten as
     * meetings are visited, so iterating the map in insertion order made "last
     * meeting" whichever row the query happened to return last — frequently an
     * older game presented as the most recent one.
     */
    const orderedWeeks = [...byWeek.entries()].sort((a, b) => {
      const [sa, wa] = a[0].split(':').map(Number)
      const [sb, wb] = b[0].split(':').map(Number)
      return sa - sb || wa - wb
    })

    for (const [, weekRows] of orderedWeeks) {
      const mineRow = weekRows.find((r) => r.rosterId === myRosterId)
      if (!mineRow || mineRow.matchupId == null) continue
      const opp = weekRows.find(
        (r) => r.matchupId === mineRow.matchupId && r.rosterId !== mineRow.rosterId,
      )
      if (!opp) continue

      // An all-zero pairing is a scheduled week, not a result. Counting it would
      // invent a tie — or a loss — out of a game that has not been played.
      if (mineRow.pointsFor === 0 && opp.pointsFor === 0) continue

      const name = nameByRoster.get(String(opp.rosterId)) ?? 'Unknown manager'
      /*
       * ⚠ KEYED ON THE MANAGER, NOT ON `league:roster`. Keying by league made
       * `sharedLeagues` structurally always 1 — the design's "shares 2 leagues"
       * could never once have been true, and the same person in two leagues showed
       * up as two separate rivals with split records.
       *
       * Identity here is the display name, lowercased. It is the only manager
       * identifier that spans leagues on imported data: roster ids are per-league
       * and `LeagueTeam.platformUserId` is nullable. Two different people sharing a
       * display name would merge, which is the accepted trade — the alternative
       * silently fragments every real rival.
       */
      const key = name.trim().toLowerCase()
      const prev = agg.get(key) ?? { name, wins: 0, losses: 0, leagues: new Set<string>(), last: null }
      const iWon = mineRow.pointsFor > opp.pointsFor
      prev.wins += iWon ? 1 : 0
      prev.losses += iWon ? 0 : 1
      prev.leagues.add(league.id)
      prev.last = iWon
        ? `you won by ${(mineRow.pointsFor - opp.pointsFor).toFixed(1)}`
        : `beat you by ${(opp.pointsFor - mineRow.pointsFor).toFixed(1)}`
      agg.set(key, prev)
    }
  }

  if (leaguesRead === 0) {
    return {
      available: false,
      reason: 'no weekly results are stored for any league where you have claimed a team',
    }
  }
  if (agg.size === 0) {
    return {
      available: false,
      reason: 'weeks are on file but none have been scored yet, so there is no head-to-head record',
    }
  }

  /*
   * Ranked by how much they have actually beaten you — a rival is someone with a
   * losing record against you, not merely someone you have played often. Ties on
   * losses fall back to total meetings.
   */
  const rows: RivalRow[] = [...agg.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      wins: v.wins,
      losses: v.losses,
      meetings: v.wins + v.losses,
      sharedLeagues: v.leagues.size,
      lastResult: v.last,
    }))
    .sort((a, b) => b.losses - a.losses || b.meetings - a.meetings)
    .slice(0, limit)

  return { available: true, data: { rows, leaguesRead } }
}
