import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { loadSideProjections, winProbabilityFor } from './matchupProjections'

/**
 * Matchup — "live head-to-head, what's left to play, and what decides it".
 *
 * ⚠ WeeklyMatchup.leagueId IS THE PLATFORM LEAGUE ID, not our canonical
 * League.id. Querying it with a League.id returns nothing and the screen reports
 * "no matchup data" for a league that has a full season of it — the two-id-space
 * trap this codebase has fallen into repeatedly. The lookup below goes
 * League.platformLeagueId → WeeklyMatchup.leagueId deliberately.
 *
 * ⚠ Only some of that data is reachable. Of six leagues with WeeklyMatchup rows,
 * three have no canonical League row at all — including the one holding a full
 * 17-week season. That data is orphaned, not ours to show, and the screen says
 * the week is unavailable rather than pretending the league never played.
 *
 * Rosters pair by matchupId: two roster ids sharing one matchupId are the two
 * sides of a game. rosterId joins to LeagueTeam.externalId.
 */

export type MatchupSide = {
  teamName: string
  ownerName: string
  record: string | null
  points: number
  isYou: boolean
}

export type MatchupData = {
  league: { id: string; name: string; platform: string }
  week: SectionState<{ week: number; season: number; isFinal: boolean }>
  sides: SectionState<{ you: MatchupSide; opponent: MatchupSide }>
  /**
   * Per-player live scoring — the handoff's centre column.
   *
   * ⚠ STILL GENUINELY ABSENT, AND DELIBERATELY NOT FAKED FROM PROJECTIONS. A
   * projected point total is not a live score; rendering one in the live column
   * would show a player "scoring" points in a game that has not kicked off.
   */
  playerScoring: UnavailableSection
  winProbability: SectionState<{
    pWin: number
    projectedMargin: number
    confidence: string
    detail: string
  }>
  projectedFinal: SectionState<{
    you: number
    opponent: number
    /**
     * ⚠ TRAVELS WITH THE NUMBER SO A FRAGMENT CANNOT POSE AS A FINAL. A projected
     * final built from 7 of 10 starters always reads LOW, and both sides can be
     * short by different amounts — which silently tilts the comparison, not just
     * the totals.
     */
    unprojected: { you: number; opponent: number }
  }>
  yetToPlay: UnavailableSection
}

export async function getMatchupData(
  leagueId: string,
  userId: string,
  weekParam?: number | null
): Promise<MatchupData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true, season: true },
  })
  if (!league) return null

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    // Each of these needs per-player weekly scoring, which no writer produces for
    // imported leagues. A win probability invented from a points ratio is the
    // most authoritative-looking wrong number this product could print.
    playerScoring: {
      available: false as const,
      reason: 'per-player weekly scoring is not ingested for imported leagues',
    },
    winProbability: {
      available: false as const,
      reason:
        'a win probability needs both lineups priced — and a ratio of current points would not be a probability',
    },
    /*
     * The default for the early-return paths. Overridden below once both sides
     * resolve to a roster. It is deliberately NOT phrased as "no feed exists" —
     * that was the old wording and it was false: the feed carries 994 rows.
     */
    projectedFinal: {
      available: false as const,
      reason: 'no matchup resolved, so there is nothing to project',
    },
    yetToPlay: {
      available: false as const,
      reason: 'requires per-player game state, which is not ingested for imported leagues',
    },
  }

  const platformLeagueId = league.platformLeagueId
  if (!platformLeagueId) {
    const noPlatform = {
      available: false as const,
      reason: 'this league has no platform id, so its weekly results cannot be located',
    }
    return { ...base, week: noPlatform, sides: noPlatform }
  }

  // Which team is the user's, in canonical space.
  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId: league.id, claimedByUserId: userId },
    select: {
      externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true,
      platformUserId: true,
    },
  })

  const latest = await prisma.weeklyMatchup.findFirst({
    where: { leagueId: platformLeagueId, ...(weekParam ? { week: weekParam } : {}) },
    orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }],
    select: { week: true, seasonYear: true },
  })

  if (!latest) {
    const noWeek = {
      available: false as const,
      reason: 'no weekly results stored for this league',
    }
    return { ...base, week: noWeek, sides: noWeek }
  }

  const rows = await prisma.weeklyMatchup.findMany({
    where: { leagueId: platformLeagueId, seasonYear: latest.seasonYear, week: latest.week },
    select: { rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true, win: true },
  })

  // A week where every row is 0-0 has been created but never scored. Showing it
  // as a 0-0 head-to-head presents an unplayed week as a result.
  const anyPoints = rows.some((r) => r.pointsFor > 0 || r.pointsAgainst > 0)

  const week: MatchupData['week'] = {
    available: true,
    data: { week: latest.week, season: latest.seasonYear, isFinal: anyPoints },
  }

  if (!myTeam?.externalId) {
    return {
      ...base,
      week,
      sides: {
        available: false,
        reason: 'we cannot tell which team in this league is yours, so there is no matchup to show',
      },
    }
  }

  const myRosterId = Number.parseInt(String(myTeam.externalId), 10)
  const mine = rows.find((r) => r.rosterId === myRosterId)

  if (!mine) {
    return {
      ...base,
      week,
      sides: { available: false, reason: `your team has no result stored for week ${latest.week}` },
    }
  }

  const opponentRow =
    mine.matchupId != null
      ? rows.find((r) => r.matchupId === mine.matchupId && r.rosterId !== mine.rosterId)
      : undefined

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id },
    select: {
      externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true,
      platformUserId: true,
    },
  })
  const teamByExternal = new Map(teams.map((t) => [String(t.externalId), t]))

  const oppTeam = opponentRow ? teamByExternal.get(String(opponentRow.rosterId)) : undefined

  /*
   * ⚠ THE ROSTER JOIN IS RESOLVED HERE, NOT ASSUMED. `Roster.platformUserId` is
   * populated from several import paths and does not always hold the platform's
   * user id — it sometimes holds our own User uuid. Passing `LeagueTeam.
   * platformUserId` alone found a roster for 38 of 106 claimed teams elsewhere in
   * this codebase, so both candidates are tried and the ACTUAL matching
   * `Roster.platformUserId` is what gets handed on.
   */
  const rosterCandidates = [
    myTeam.platformUserId,
    userId,
    oppTeam?.platformUserId,
  ].filter(Boolean) as string[]

  const rosterRows = rosterCandidates.length
    ? await prisma.roster.findMany({
        where: { leagueId: league.id, platformUserId: { in: rosterCandidates } },
        select: { platformUserId: true },
      })
    : []
  const rosterIds = new Set(rosterRows.map((r) => r.platformUserId))
  const yourRosterKey = [myTeam.platformUserId, userId].find((c) => c && rosterIds.has(c)) ?? null
  const oppRosterKey = oppTeam?.platformUserId && rosterIds.has(oppTeam.platformUserId)
    ? oppTeam.platformUserId
    : null

  /*
   * ⚠ SEASON AND WEEK COME FROM THE MATCHUP ROW, NOT FROM THE PROJECTION FEED, and
   * that mismatch is load-bearing rather than a bug. Asking the feed for a week it
   * has not written returns nothing, every starter lands in `unprojected`, and both
   * sections below refuse — which is exactly right for a COMPLETED week. A
   * projected final for a game that already finished is not a projection, it is
   * noise printed over a result.
   */
  const sideProjections =
    yourRosterKey && oppRosterKey
      ? await loadSideProjections({
          leagueId: league.id,
          season: latest.seasonYear,
          week: latest.week,
          yourPlatformUserId: yourRosterKey,
          opponentPlatformUserId: oppRosterKey,
        }).catch(() => null)
      : null

  const anyProjected =
    sideProjections != null &&
    sideProjections.you.starters.length + sideProjections.opponent.starters.length > 0

  const projectedFinal: MatchupData['projectedFinal'] = anyProjected
    ? {
        available: true,
        data: {
          you: sideProjections!.you.projectedRemaining,
          opponent: sideProjections!.opponent.projectedRemaining,
          unprojected: {
            you: sideProjections!.you.unprojected,
            opponent: sideProjections!.opponent.unprojected,
          },
        },
      }
    : {
        available: false,
        reason: sideProjections
          ? `no projections on file for ${latest.seasonYear} week ${latest.week} — this week is not one the feed covers`
          : 'we could not match both sides of this matchup to an imported roster',
      }

  /*
   * Current points are passed in so an in-progress game is scored from what is
   * already on the board plus what is left, rather than from projections alone.
   */
  const winProbability: MatchupData['winProbability'] = sideProjections
    ? winProbabilityFor(sideProjections, {
        you: mine.pointsFor,
        opponent: opponentRow?.pointsFor ?? mine.pointsAgainst,
      })
    : {
        available: false,
        reason: 'we could not match both sides of this matchup to an imported roster',
      }


  /*
   * ⚠ THE PROJECTIONS SURVIVE THIS RETURN ON PURPOSE — AN UNPLAYED WEEK IS WHEN
   * THEY MATTER MOST. There is still no head-to-head SCORE to show (a 0-0 row is
   * a scheduled week, not a result, and rendering it as one is the lie this guard
   * exists to prevent), but "what is this matchup projected to finish" and "what
   * are my chances" are precisely the questions asked BEFORE kickoff. Returning
   * base's placeholders here would have withheld the two numbers with the most
   * value, on the grounds that the game had not started.
   */
  if (!anyPoints) {
    return {
      ...base,
      week,
      projectedFinal,
      winProbability,
      sides: {
        available: false,
        reason: `week ${latest.week} is on file but nothing has been scored — this is an unplayed week, not a 0-0 game`,
      },
    }
  }


  const recordOf = (t?: { wins: number; losses: number; ties: number }) =>
    !t || (t.wins === 0 && t.losses === 0 && t.ties === 0)
      ? null
      : t.ties > 0
        ? `${t.wins}-${t.losses}-${t.ties}`
        : `${t.wins}-${t.losses}`

  const you: MatchupSide = {
    teamName: myTeam.teamName,
    ownerName: myTeam.ownerName,
    record: recordOf(myTeam),
    points: mine.pointsFor,
    isYou: true,
  }

  if (!opponentRow) {
    // A bye, or an unpaired row. `pointsAgainst` still tells us what the other
    // side scored, so the score line is real even when the opponent is unnamed.
    return {
      ...base,
      week,
      sides: {
        available: true,
        data: {
          you,
          opponent: {
            teamName: 'Opponent not identified',
            ownerName: '',
            record: null,
            points: mine.pointsAgainst,
            isYou: false,
          },
        },
      },
    }
  }

  return {
    ...base,
    week,
    projectedFinal,
    winProbability,
    sides: {
      available: true,
      data: {
        you,
        opponent: {
          teamName: oppTeam?.teamName ?? `Roster ${opponentRow.rosterId}`,
          ownerName: oppTeam?.ownerName ?? '',
          record: recordOf(oppTeam),
          points: opponentRow.pointsFor,
          isYou: false,
        },
      },
    },
  }
}
