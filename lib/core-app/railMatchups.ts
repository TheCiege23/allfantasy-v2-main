import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveCurrentWeek } from './currentWeek'
import { managerArtUrl } from './leagueArt'

/**
 * This week's head-to-head for every league, for the expanded league rail.
 *
 * 2026-09-07 handoff (`AF League List.dc.html`): the desktop rail expands from a
 * column of crests into a matchup rail — your team and score against the
 * opponent's, with the league's name and crest between them.
 *
 * ── Cost, because this runs inside a shell on EVERY /core page ──────────────
 *
 * Three set-based queries, no matter how many leagues: the current week (from
 * `resolveCurrentWeek`, itself two bounded reads), every WeeklyMatchup row for
 * that week across the caller's platform league ids, and every LeagueTeam in
 * those leagues so both sides can be named. It is the same shape and roughly
 * the same cost as `getWeekAll`, which already runs on the home.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 *
 * ⚠ NO PROJECTIONS. The design draws an AF projection beside each score. Those
 * come from `getWeekBoard`, which fits a per-team distribution over completed
 * weeks — a genuinely expensive computation, and one whose output this codebase
 * requires to be rendered beside a stated basis ("projected from N completed
 * roster-weeks"). A projected number in a 300px rail with nowhere to say what it
 * is would read as a score, which is the one mistake the matchup surfaces are
 * built to avoid. Real scores here; projections on `/core/week` and
 * `/core/matchup`, where the basis line fits.
 *
 * ⚠ THE JOIN IS `League.platformLeagueId`, NOT `League.id`. WeeklyMatchup is
 * written by the Sleeper sync against Sleeper's own ids, and its `rosterId`
 * holds Sleeper's numeric roster_id. Joining on our id returns nothing, silently.
 *
 * ⚠ AN UNPLAYED FIXTURE IS KEPT, NOT SKIPPED, AND IT IS MARKED. `getWeekAll`
 * drops those rows because it reports RESULTS, and a 0-0 row there became a
 * fabricated loss. The rail is a "what is on this week" list, so a scheduled
 * game belongs on it — it just carries `scored: false`, and the rail draws a
 * dash rather than 0.00.
 */

export type RailMatchup = {
  leagueId: string
  /** Your team's name in this league, when the platform published one. */
  yourTeam: string | null
  yourAvatarUrl: string | null
  yourScore: number
  opponentTeam: string | null
  opponentAvatarUrl: string | null
  opponentScore: number
  /** False when the fixture exists but has not been played. */
  scored: boolean
  season: number
  week: number
}

export type RailMatchups = {
  byLeague: Record<string, RailMatchup>
  season: number | null
  week: number | null
}

const EMPTY: RailMatchups = { byLeague: {}, season: null, week: null }

export async function getRailMatchups(
  userId: string,
  leagues: Array<{ id: string; platformLeagueId?: string | null }>,
): Promise<RailMatchups> {
  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0) return EMPTY

  const latest = await resolveCurrentWeek(platformIds)
  if (!latest) return EMPTY

  /*
   * ⚠ BOTH ROW TYPES ARE NAMED, BECAUSE `.catch(() => [])` WIDENS TO A UNION.
   * The empty literal infers `never[]`, so `typeof matchups` becomes
   * `Row[] | never[]` and every downstream `.filter`/`.find` resolves against
   * the `never[]` overload. Naming the type collapses the union at the
   * declaration instead of at each use site — the same fix `myTeamPulse.ts`
   * carries a note about.
   */
  type MatchupRow = {
    leagueId: string
    rosterId: string
    matchupId: number | null
    pointsFor: number
    pointsAgainst: number
  }
  type TeamRow = {
    externalId: string | null
    teamName: string | null
    ownerName: string | null
    avatarUrl: string | null
    claimedByUserId: string | null
    league: { id: string; platform: string | null; platformLeagueId: string | null } | null
  }

  const [matchups, teams]: [MatchupRow[], TeamRow[]] = await Promise.all([
    prisma.weeklyMatchup
      .findMany({
        where: {
          leagueId: { in: platformIds },
          seasonYear: latest.seasonYear,
          week: latest.week,
        },
        select: {
          leagueId: true,
          rosterId: true,
          matchupId: true,
          pointsFor: true,
          pointsAgainst: true,
        },
      })
      .catch((): MatchupRow[] => []),
    prisma.leagueTeam
      .findMany({
        where: { league: { platformLeagueId: { in: platformIds } } },
        select: {
          externalId: true,
          teamName: true,
          ownerName: true,
          avatarUrl: true,
          claimedByUserId: true,
          league: {
            select: { id: true, platform: true, platformLeagueId: true },
          },
        },
      })
      .catch((): TeamRow[] => []),
  ])

  type TeamMeta = {
    leagueId: string
    platform: string | null
    name: string | null
    avatarUrl: string | null
    isYours: boolean
  }

  /** "platformLeagueId:externalId" → that team. */
  const teamByKey = new Map<string, TeamMeta>()
  /** Which roster is yours, per platform league. */
  const yourRosterByLeague = new Map<string, string>()

  for (const t of teams) {
    const pid = t.league?.platformLeagueId
    if (!pid || !t.externalId) continue
    const meta: TeamMeta = {
      leagueId: t.league!.id,
      platform: t.league?.platform ?? null,
      /*
       * ⚠ THE TEAM NAME, THEN THE OWNER'S — never the league's own name as a
       * stand-in. A roster the platform never named stays unnamed; borrowing the
       * league name would put "Dynasty Dragons vs Dynasty Dragons" in the rail.
       */
      name: t.teamName?.trim() || t.ownerName?.trim() || null,
      avatarUrl: managerArtUrl({ avatarUrl: t.avatarUrl, platform: t.league?.platform ?? null }),
      isYours: t.claimedByUserId === userId,
    }
    teamByKey.set(`${pid}:${t.externalId}`, meta)
    if (meta.isYours) yourRosterByLeague.set(pid, String(t.externalId))
  }

  /* Pair the week's rows by (league, matchupId) so an opponent can be named. */
  const pairs = new Map<string, typeof matchups>()
  for (const m of matchups) {
    if (m.matchupId == null) continue
    const key = `${m.leagueId}:${m.matchupId}`
    const list = pairs.get(key)
    if (list) list.push(m)
    else pairs.set(key, [m])
  }

  const byLeague: Record<string, RailMatchup> = {}

  for (const m of matchups) {
    const yourRoster = yourRosterByLeague.get(m.leagueId)
    if (yourRoster == null || String(m.rosterId) !== yourRoster) continue

    const you = teamByKey.get(`${m.leagueId}:${m.rosterId}`)
    if (!you) continue

    /*
     * The opponent, from the pairing when the schedule carries a matchup id.
     *
     * ⚠ `pointsAgainst` IS THE FALLBACK, NOT THE SOURCE. It is always correct as
     * a number and never carries a name, so an unpaired row still shows a real
     * scoreline with the opponent left unnamed — which is honest — rather than
     * being dropped from the rail entirely.
     */
    let opponent: TeamMeta | null = null
    if (m.matchupId != null) {
      const pair = pairs.get(`${m.leagueId}:${m.matchupId}`) ?? []
      const other = pair.find((r) => String(r.rosterId) !== String(m.rosterId))
      if (other) opponent = teamByKey.get(`${m.leagueId}:${other.rosterId}`) ?? null
    }

    byLeague[you.leagueId] = {
      leagueId: you.leagueId,
      yourTeam: you.name,
      yourAvatarUrl: you.avatarUrl,
      yourScore: m.pointsFor,
      opponentTeam: opponent?.name ?? null,
      opponentAvatarUrl: opponent?.avatarUrl ?? null,
      opponentScore: m.pointsAgainst,
      scored: m.pointsFor > 0 || m.pointsAgainst > 0,
      season: latest.seasonYear,
      week: latest.week,
    }
  }

  return { byLeague, season: latest.seasonYear, week: latest.week }
}
