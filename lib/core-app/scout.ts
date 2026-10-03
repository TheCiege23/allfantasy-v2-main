import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { resolveLeagueStage } from '@/lib/league-stage/leagueStage'
import { currentFantasySeason } from './connectLeague'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { leagueContextFor, type LeagueContext } from './leagueContext'
import { getLeagueStandings } from './leagueStandings'
import type { Record3, ResultCode, Zone } from './standingsModel'

/**
 * Scout — the first room of the War Room.
 *
 * "A place users could go to scout out the competition." Every manager in the league, where they
 * stand, how they have been playing lately, and the one you play this week pinned to the top with
 * your head-to-head record against them.
 *
 * ── 🛑 FACTS, NEVER LABELS ───────────────────────────────────────────────────
 *
 * This screen once rendered manager psychology — labels, five scores, a trajectory. Milestone 32
 * withheld that from every viewer, which left each card a name and "N observations on file", and
 * the 2026-09-30 ruling retired every psychology leftover. What replaced it is the contract in
 * docs/DECISION_OS_COMPETITIVE_EDGE_PRIVACY_STATUS.md: state the observable fact, never the
 * classification. Every number here is one a manager can check on their own Standings screen.
 *
 * ⚠ THE STANDINGS ARE READ, NOT RE-DERIVED. `getLeagueStandings` is the Standings screen's own
 * loader — the official order with its tiebreakers, the power ranking, the head-to-head matrix —
 * reached through the render's shared league context. A second ranking rule here would disagree
 * with Standings on exactly the tiebreak a manager is looking at.
 *
 * ⚠ NOTHING THIS LOADER RETURNS IS COMPETITIVE EDGE. A manager's trade and waiver history is the
 * paid depth (coreDepthAccess.ts). Scout shows it to a plan holder (owner's decision 2026-10-02), but
 * it is loaded separately and gated on the server — lib/competitive-edge/scoutEdgeLoader.ts — so
 * this free read can never carry it by accident.
 *
 * ── 🛑 THE MEMBERSHIP GATE IS NOT OPTIONAL ──────────────────────────────────
 *
 * `leagueId` arrives from the URL. `resolveLeagueMembership` is the canonical predicate, and a
 * non-member gets the league's name and nothing else — no team, no record, no standing.
 */

export type ScoutStanding = {
  /** Official seed, 1 = top of the table. */
  seed: number
  record: Record3
  pointsFor: number
  pointsAgainst: number | null
  /** Last five head-to-head results, oldest first. */
  form: ResultCode[]
  zone: Zone
  /** Games behind the last playoff spot (negative = ahead). Null without head-to-head games. */
  gamesBack: number | null
  powerRank: number
}

export type ScoutedManager = {
  /** `LeagueTeam.externalId || LeagueTeam.id` — the platform roster id where there is one. */
  managerId: string
  teamName: string
  ownerName: string | null
  avatarUrl: string | null
  isYou: boolean
  /** True for the manager you play this week, when the schedule names one. */
  isNextOpponent: boolean
  /** Where they stand, from the Standings screen's own table. Null when that table cannot be drawn. */
  standing: ScoutStanding | null
}

export type ScoutOpponent = {
  managerId: string
  teamName: string
  /** Your record against them this season, from the standings' head-to-head matrix. Null without a game between you. */
  headToHead: Record3 | null
}

export type ScoutData = {
  league: { id: string; name: string; sport: string }
  /** Who you are in this league, when a team is claimed. */
  you: { managerId: string; teamName: string; standing: ScoutStanding | null } | null
  /** This week, when the league's schedule carries one and the season is still being played. */
  week: { seasonYear: number; week: number } | null
  /** The manager you play this week. Null when the schedule names nobody, or the season is over. */
  opponent: ScoutOpponent | null
  managers: SectionState<ScoutedManager[]>
  /**
   * What the standings facts are measured over — stated before the cards, as the coverage line was,
   * because "through week 3" changes how a 2-1 record reads. Unavailable when nothing can be ranked
   * yet, with the Standings loader's own reason.
   */
  basis: SectionState<{ season: number; throughWeek: number; seasonComplete: boolean; orderBasis: string }>
}

/** Sort: your opponent, then the table's own order, then anyone the table does not place. */
function scoutOrder(a: ScoutedManager, b: ScoutedManager): number {
  if (a.isNextOpponent !== b.isNextOpponent) return a.isNextOpponent ? -1 : 1
  const sa = a.standing?.seed ?? Number.MAX_SAFE_INTEGER
  const sb = b.standing?.seed ?? Number.MAX_SAFE_INTEGER
  if (sa !== sb) return sa - sb
  return a.teamName.localeCompare(b.teamName)
}

/** The stages `portfolioClassify.stageOf` reads as 'complete'. */
const SEASON_OVER_STAGES = new Set(['complete', 'completed', 'season_over', 'archived'])

/**
 * True when the resolved week cannot be "this week" — see the note where it is used.
 * Exported for the test; pure.
 */
export function weekIsBehindLeague(
  week: { seasonYear: number },
  league: { sport?: string | null; season?: number | null; status?: string | null; lifecycleState?: string | null },
  now: Date,
): boolean {
  if (SEASON_OVER_STAGES.has(resolveLeagueStage(league) ?? '')) return true
  if (league.season != null && week.seasonYear < league.season) return true
  if (String(league.sport ?? 'NFL').toUpperCase() === 'NFL' && week.seasonYear < currentFantasySeason(now)) return true
  return false
}

export async function getScoutData(
  leagueId: string,
  userId: string,
  /** The render's shared league context — see `leagueContext.ts`. */
  ctx?: LeagueContext | null,
): Promise<ScoutData | null> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  const league = await lc.league()
  if (!league) return null

  const sport = String(league.sport ?? 'NFL')
  const base = {
    league: { id: league.id, name: leagueDisplayName(league.name), sport },
  }
  const nothing = (reason: string): ScoutData => ({
    ...base,
    you: null,
    week: null,
    opponent: null,
    managers: { available: false, reason },
    basis: { available: false, reason },
  })

  /*
   * 🛑 MEMBERSHIP, BEFORE ANY TEAM IS READ. A failed check is reported as a failed check — the old
   * `.catch(() => null)` folded an outage into "this account is not a member", which is a claim
   * about the viewer we had not established.
   */
  const membership = await resolveLeagueMembership(leagueId, userId).catch(() => null)
  if (!membership) return nothing('membership in this league could not be checked just now — try again in a moment')
  if (!membership.ok) {
    return nothing('scouting reads the managers of a league you are in, and this account is not a member of this one')
  }

  const [teams, standings] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: { id: true, externalId: true, ownerName: true, teamName: true, avatarUrl: true, claimedByUserId: true },
      })
      .then((rows) => ({ ok: true as const, rows }))
      .catch(() => ({ ok: false as const, rows: [] as never[] })),
    getLeagueStandings(leagueId, userId, ctx).catch(() => null),
  ])

  if (!teams.ok) return nothing('the teams in this league could not be read just now — try again in a moment')
  if (teams.rows.length === 0) return nothing('no teams have been imported for this league, so there is nobody to scout')

  const managerIdOf = (t: { externalId: string; id: string }) => t.externalId || t.id
  const mine = teams.rows.find((t) => t.claimedByUserId === userId) ?? null
  const myManagerId = mine ? managerIdOf(mine) : null

  /*
   * The board's `rosterId` is the platform roster id — `LeagueTeam.externalId`. A team without one
   * (a native league's row before its first sync) has no place on the board and reads as unplaced.
   */
  const board = standings?.available ? standings.board : null
  const standingOf = (externalId: string): ScoutStanding | null => {
    const t = board?.teams.find((row) => row.rosterId === externalId)
    if (!t) return null
    return {
      seed: t.seed,
      record: t.record,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      form: t.form,
      zone: t.zone,
      gamesBack: t.gamesBack,
      powerRank: t.powerRank,
    }
  }

  /*
   * ⚠ `WeeklyMatchup.leagueId` IS `League.platformLeagueId`, NOT `League.id`.
   * They are different id spaces and the mistake is silent — the query simply
   * returns nothing, which reads as "no game this week" for every league in the
   * product. `nextMatchup.ts` carries the same warning on its own arguments.
   */
  const resolvedWeek = league.platformLeagueId
    ? await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null)
    : null
  /*
   * 🛑 A FINISHED SEASON HAS NO "THIS WEEK". When every week is scored the resolver answers
   * with the LAST week — honest for a standings table, wrong here: all off-season Scout read
   * "Week 17 of 2025" and tagged last season's final opponent THIS WEEK. So the week is
   * dropped, and no opponent is named, when the league says its season is over, when the
   * rows on file are an older season than the league's own, or (NFL, whose season year we
   * can date) when they belong to a fantasy season that has already ended.
   */
  const week =
    resolvedWeek && !weekIsBehindLeague(resolvedWeek, league, new Date()) ? resolvedWeek : null

  let opponentManagerId: string | null = null
  if (week && league.platformLeagueId && mine?.externalId) {
    const rows = await prisma.weeklyMatchup
      .findMany({
        where: {
          leagueId: league.platformLeagueId,
          seasonYear: week.seasonYear,
          week: week.week,
        },
        select: { rosterId: true, matchupId: true },
      })
      .catch(() => [])

    const me = rows.find((r) => r.rosterId === mine.externalId)
    /*
     * A null `matchupId` cannot be paired — the league recorded scores without a
     * schedule. Leaving the opponent unnamed is honest; pairing on anything else
     * would invent a fixture.
     */
    if (me?.matchupId != null) {
      const other = rows.find(
        (r) => r.matchupId === me.matchupId && r.rosterId !== me.rosterId,
      )
      if (other) {
        const oppTeam = teams.rows.find((t) => t.externalId === other.rosterId)
        if (oppTeam) opponentManagerId = managerIdOf(oppTeam)
      }
    }
  }

  const managers: ScoutedManager[] = teams.rows.map((t) => {
    const managerId = managerIdOf(t)
    return {
      managerId,
      teamName: t.teamName?.trim() || t.ownerName?.trim() || 'Unnamed team',
      ownerName: t.ownerName?.trim() || null,
      avatarUrl: t.avatarUrl ?? null,
      isYou: managerId === myManagerId,
      isNextOpponent: opponentManagerId != null && managerId === opponentManagerId,
      standing: t.externalId ? standingOf(t.externalId) : null,
    }
  })
  managers.sort(scoutOrder)

  const opponentRow = managers.find((m) => m.isNextOpponent) ?? null
  /*
   * ⚠ ONLY A RECORD WITH A GAME IN IT. `h2h[a][b]` exists for every pair on some boards; 0-0-0 is
   * "you have not played them", which the banner says in words rather than as a zero record.
   */
  const h2h = board?.hasHeadToHead && mine?.externalId && opponentRow ? board.h2h[mine.externalId]?.[opponentRow.managerId] : null
  const headToHead = h2h && h2h.wins + h2h.losses + h2h.ties > 0 ? h2h : null

  return {
    ...base,
    you:
      mine && myManagerId
        ? { managerId: myManagerId, teamName: mine.teamName?.trim() || 'Your team', standing: mine.externalId ? standingOf(mine.externalId) : null }
        : null,
    week: week ? { seasonYear: week.seasonYear, week: week.week } : null,
    opponent: opponentRow ? { managerId: opponentRow.managerId, teamName: opponentRow.teamName, headToHead } : null,
    managers: { available: true, data: managers },
    basis: standings?.available
      ? {
          available: true,
          data: {
            season: standings.board.season,
            throughWeek: standings.board.throughWeek,
            seasonComplete: standings.seasonComplete,
            orderBasis: standings.board.orderBasis,
          },
        }
      : {
          available: false,
          reason: standings
            ? standings.reason
            : 'the standings could not be read just now, so the table order and records are missing',
        },
  }
}
