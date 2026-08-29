import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { loadSideProjections, winProbabilityFor } from './matchupProjections'
import { myRosterCandidates } from './myRoster'
import { normalizePositionForSport, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { startingSlotTemplate } from './rosterSlots'
import { identityGapNote } from './identityGap'
import { resolveSourceLink, type SourceLink } from '@/lib/league-links/sourceLinkResolver'

/**
 * A crest we can actually render, or null.
 *
 * ⚠ SLEEPER STORES AN AVATAR *ID* IN THE SAME COLUMN AS A URL. Production
 * carries both spellings, so a bare id is expanded to its CDN path and anything
 * else unresolvable returns null — which renders initials rather than a broken
 * <img>. Same rule as `imageOf` in dash34.ts and `asImageUrl` in matchupPulse.ts.
 */
function asImageUrl(raw: string | null | undefined, platform: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (String(platform ?? '').toLowerCase() === 'sleeper') {
    return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(v)}`
  }
  return null
}

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT = '0'

/**
 * A headshot we can actually put in a `src`.
 *
 * ⚠ 959 OF 16,362 NFL ROWS CARRY A BARE FILENAME, NOT A URL — production values
 * include `915a6006-e2da-5f51-a7a7-85de69ccc088.png` (Patrick Mahomes). Rendered
 * straight into `<img src>` those resolve against the current route and 404, and
 * a broken-image glyph is worse than the initial it would have replaced.
 */
function asHeadshotUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  return /^(https?:)?\/\//i.test(v) || v.startsWith('/') ? v : null
}

/**
 * Long-form positions, as several ingest paths store them.
 *
 * ⚠ `normalizePositionForSport` FOLDS ABBREVIATIONS AND NOTHING ELSE, so
 * "Quarterback" comes back as "QUARTERBACK" — which then becomes the slot label
 * and reads as a different position from the "QB" beside it. Measured on
 * production: 415 Wide Receiver, 216 Running Back, 135 Quarterback and so on,
 * so this is the common spelling rather than an edge case.
 */
const LONG_POSITION: Record<string, string> = {
  QUARTERBACK: 'QB',
  'RUNNING BACK': 'RB',
  FULLBACK: 'RB',
  'WIDE RECEIVER': 'WR',
  'TIGHT END': 'TE',
  KICKER: 'K',
  'PLACE KICKER': 'K',
  PUNTER: 'P',
  LINEBACKER: 'LB',
  CORNERBACK: 'DB',
  SAFETY: 'DB',
  'DEFENSIVE END': 'DL',
  'DEFENSIVE TACKLE': 'DL',
  'OFFENSIVE TACKLE': 'OL',
  GUARD: 'OL',
  CENTER: 'OL',
  'DEFENSIVE BACK': 'DB',
  'DEFENSIVE LINEMAN': 'DL',
}

function displayPosition(raw: string | null | undefined, sport: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  const long = LONG_POSITION[v.toUpperCase()]
  return long ?? normalizePositionForSport(sport ?? 'NFL', v) ?? v.toUpperCase()
}

/**
 * Slot labels in the order fantasy lineups conventionally read.
 *
 * Mirrors `inferSlotLabel` in myTeam.ts deliberately: the two screens render the
 * same lineup and must not disagree about what a slot is called.
 */
function inferSlotLabel(position: string | null, index: number): string {
  const p = (position ?? '').toUpperCase()
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'].includes(p)) return p === 'DST' ? 'DEF' : p
  return p || `SLOT ${index + 1}`
}

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
  /**
   * The manager's own crest, as the platform published it. Already a full URL
   * on every row production carries — 984 of 1,130 `LeagueTeam` rows have one —
   * and a bare Sleeper hash is expanded before it reaches here.
   */
  avatarUrl: string | null
}

/**
 * One player in one side of a slot row.
 *
 * ⚠ `projected` AND `actual` ARE DIFFERENT CLAIMS AND ARE NEVER MERGED. A
 * projection is what we expect; an actual is what the source platform scored.
 * Collapsing them into one "points" field is how a projection ends up rendered
 * in a live column, showing a player scoring in a game that has not kicked off.
 */
export type MatchupPlayerCell = {
  playerId: string
  /** Null when the id does not resolve to a player row — a bridge failure, shown as such. */
  name: string | null
  position: string | null
  team: string | null
  /** The league's sport, so the club crest resolves off the right CDN. */
  sport: string | null
  imageUrl: string | null
  /** Priced under THIS league's own scoring. Null means unpriced, never zero. */
  projected: number | null
  /** Points as the SOURCE PLATFORM scored them. Null when none is ingested. */
  actual: number | null
  /** The platform recorded an unfilled starting slot. A hole, not a player. */
  empty: boolean
}

export type MatchupSlot = {
  slotLabel: string
  you: MatchupPlayerCell | null
  opponent: MatchupPlayerCell | null
}

export type MatchupData = {
  league: {
    id: string
    name: string
    platform: string
    /** The league crest, when the platform published one. */
    logoUrl: string | null
    /**
     * Where to go to actually CHANGE something.
     *
     * ⚠ AllFantasy is READ-ONLY for an imported league, so every action ends on
     * the source platform. Resolved server-side through the one hardened
     * resolver — an exact-host HTTPS allowlist, never a URL built at the call
     * site. Null for a native league, where there is no source to open.
     */
    sourceLink: SourceLink | null
  }
  week: SectionState<{ week: number; season: number; isFinal: boolean }>
  sides: SectionState<{ you: MatchupSide; opponent: MatchupSide }>
  /**
   * The slot-by-slot board — your starter against theirs, at the same slot.
   *
   * Built from the two rosters' stored lineups and priced under this league's
   * own scoring. Live points are laid over the top wherever
   * `league_player_weekly_scores` carries them; where it does not, the row shows
   * the projection and `playerScoring` states that that is what it is.
   */
  lineups: SectionState<MatchupSlot[]>
  /**
   * Why the board carries unnamed rows, said ONCE.
   *
   * ⚠ A PLATFORM-LEVEL FAILURE MUST NOT RENDER AS N BROKEN PLAYERS. On an ESPN
   * league not one starter id resolves (0 of 145 across production), so without
   * this the board is a column of "Unresolved player" rows that look like a
   * roster problem. Null when every id resolved.
   */
  identityNote: string | null
  /**
   * Whether per-player LIVE scoring exists for this league and week.
   *
   * ⚠ THIS FIELD USED TO SAY "not ingested for imported leagues" UNCONDITIONALLY
   * AND THAT IS NO LONGER TRUE. `league_player_weekly_scores` has a writer
   * (`ingestSleeperPlayerScoresForWeek`, called from the connected-Sleeper
   * collector) and a reader. Measured on production 2026-08-29 the table is
   * still EMPTY — so the honest statement is per-league-and-week, resolved from
   * the rows themselves, not a blanket claim about the product.
   */
  playerScoring: SectionState<{ playersScored: number; source: string }>
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
    select: {
      id: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      season: true,
      sport: true,
      logoUrl: true,
      avatarUrl: true,
      settings: true,
    },
  })
  if (!league) return null

  const platform = String(league.platform ?? 'manual').toLowerCase()
  const sport = league.sport ?? null

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform,
      logoUrl: asImageUrl(league.logoUrl, platform) ?? asImageUrl(league.avatarUrl, platform),
      sourceLink: resolveSourceLink({
        platform: league.platform,
        sourceLeagueId: league.platformLeagueId,
        leagueName: leagueDisplayName(league.name),
        season: league.season,
        action: 'matchup',
      }),
    },
    lineups: {
      available: false as const,
      reason: 'no matchup resolved, so there are no lineups to pair',
    },
    identityNote: null as string | null,
    // Each of these needs per-player weekly scoring, which no writer produces for
    // imported leagues. A win probability invented from a points ratio is the
    // most authoritative-looking wrong number this product could print.
    playerScoring: {
      available: false as const,
      reason: 'no matchup resolved, so no per-player scoring was looked for',
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
      platformUserId: true, avatarUrl: true,
    },
  })

  /*
   * ⚠ THE EARLIEST UNPLAYED WEEK, NOT `max(week)`. This screen named your
   * WEEK-18 opponent as this week's for as long as the sync bootstrapped a
   * full unscored season ahead of kickoff — a wrong answer delivered with
   * total confidence, which is worse than the empty state it replaced. An
   * explicit ?week= still wins; only the inference changed. See
   * lib/core-app/currentWeek.ts.
   */
  const latest = await resolveCurrentWeekForLeague(platformLeagueId, weekParam ?? null)

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
      platformUserId: true, avatarUrl: true,
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
  /*
   * ⚠ AND `externalId` IS THE THIRD CANDIDATE, NOT AN OPTIONAL EXTRA. This list
   * was `[platformUserId, userId]` and it is now `myRosterCandidates` — the
   * repo's canonical set, whose own note records that dropping one key took the
   * join from 93 claimed teams to 38. The cross-league pulse hit exactly this:
   * keyed on `platformUserId` alone it resolved every OPPONENT's roster and not
   * one of the user's own.
   */
  const yourCandidates = myRosterCandidates(
    { platformUserId: myTeam.platformUserId, externalId: myTeam.externalId },
    userId,
  )
  const theirCandidates = [oppTeam?.platformUserId, opponentRow ? String(opponentRow.rosterId) : null]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  const rosterCandidates = [...new Set([...yourCandidates, ...theirCandidates])]

  const rosterRows = rosterCandidates.length
    ? await prisma.roster.findMany({
        where: { leagueId: league.id, platformUserId: { in: rosterCandidates } },
        select: { platformUserId: true },
      })
    : []
  const rosterIds = new Set(rosterRows.map((r) => r.platformUserId))
  const yourRosterKey = yourCandidates.find((c) => rosterIds.has(c)) ?? null
  /*
   * ⚠ THE OPPONENT MUST NOT RESOLVE TO THE KEY THE USER JUST TOOK. `externalId`
   * and a roster id are both small integers, so without this the two sides of a
   * matchup can land on the same roster and the screen renders a team playing
   * itself.
   */
  const oppRosterKey = theirCandidates.find((c) => c !== yourRosterKey && rosterIds.has(c)) ?? null

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
          ? sideProjections.leagueScoring.available === false
            ? sideProjections.leagueScoring.reason
            : `no starter could be priced for ${latest.seasonYear} week ${latest.week} — the feed does not cover this week, or this league's rules cannot score its stat lines`
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

  /* ── The slot-by-slot board ─────────────────────────────────────────────
   *
   * Your starter against theirs at the same slot, with a headshot on each.
   *
   * ⚠ THE TWO LINEUPS ARE PAIRED BY INDEX, NOT MATCHED BY POSITION. That is how
   * every platform stores a lineup — `starters[3]` is the same slot for both
   * teams because the league's roster template defines it — and it is the only
   * pairing that survives a FLEX. Matching by position instead would put your
   * WR3 against their RB2 whenever the two teams flex differently, which reads
   * as a scoring comparison and is not one.
   *
   * ⚠ AND THE COLUMNS ARE PROJECTIONS UNTIL THE PLATFORM SCORES THEM. `actual`
   * is filled only from `league_player_weekly_scores`, which is the source
   * platform's own number. Nothing here ever promotes a projection into that
   * field — see the note on MatchupPlayerCell.
   */
  const lineupIds = sideProjections
    ? [
        ...sideProjections.you.lineup.map((s) => s.playerId),
        ...sideProjections.opponent.lineup.map((s) => s.playerId),
      ].filter((id) => id !== EMPTY_SLOT && !id.startsWith('name:'))
    : []

  const [identityRows, scoreRows] = await Promise.all([
    lineupIds.length
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: [...new Set(lineupIds)] } },
            select: { sleeperId: true, name: true, position: true, team: true, imageUrl: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    lineupIds.length
      ? prisma.leaguePlayerWeeklyScore
          .findMany({
            where: {
              leagueId: platformLeagueId,
              seasonYear: latest.seasonYear,
              week: latest.week,
              playerId: { in: [...new Set(lineupIds)] },
            },
            select: { playerId: true, points: true, source: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  /*
   * ⚠ `sleeperId` IS NOT UNIQUE IN `SportsPlayer` — 501 distinct roster ids
   * resolved to 1,231 rows elsewhere in this codebase. First row wins, same as
   * dash34.ts, so one athlete cannot occupy a slot twice.
   */
  const identityBy = new Map<string, (typeof identityRows)[number]>()
  for (const r of identityRows) {
    if (!r.sleeperId || identityBy.has(r.sleeperId)) continue
    identityBy.set(r.sleeperId, r)
  }
  const actualBy = new Map(scoreRows.map((r) => [r.playerId, r.points]))

  const cellFor = (
    entry: { playerId: string; projected: number | null } | undefined,
  ): MatchupPlayerCell | null => {
    if (!entry) return null
    if (entry.playerId === EMPTY_SLOT) {
      return {
        playerId: entry.playerId,
        name: null,
        position: null,
        team: null,
        sport,
        imageUrl: null,
        projected: null,
        actual: null,
        empty: true,
      }
    }
    /*
     * ⚠ A `name:` DESCRIPTOR IS A REAL PLAYER WE COULD NOT ID, NOT AN EMPTY
     * SLOT. The importer writes `name:Lamar Jackson:QB:BAL` when it cannot
     * resolve a platform id; the name in it is the best identity we have and
     * throwing it away would render a filled slot as a hole.
     */
    if (entry.playerId.startsWith('name:')) {
      const [, rawName, rawPos, rawTeam] = entry.playerId.split(':')
      return {
        playerId: entry.playerId,
        name: rawName || null,
        position: displayPosition(rawPos, sport),
        team: rawTeam ? normalizeTeamAbbrev(rawTeam) : null,
        sport,
        imageUrl: null,
        projected: entry.projected,
        actual: actualBy.get(entry.playerId) ?? null,
        empty: false,
      }
    }
    const identity = identityBy.get(entry.playerId)
    return {
      playerId: entry.playerId,
      name: identity?.name ?? null,
      position: displayPosition(identity?.position, sport),
      /*
       * ⚠ NORMALISED, BECAUSE THE CREST LOOKUP UPPERCASES WHAT IT IS GIVEN AND
       * DOES NOT NORMALISE. `SportsPlayer.team` holds "Kansas City Chiefs" on 32
       * distinct values in production; `teamLogoUrl` would hand
       * "KANSAS CITY CHIEFS" to the CDN resolver and get nothing back.
       */
      team: normalizeTeamAbbrev(identity?.team),
      sport,
      imageUrl: asHeadshotUrl(identity?.imageUrl),
      projected: entry.projected,
      actual: actualBy.get(entry.playerId) ?? null,
      empty: false,
    }
  }

  const lineups: MatchupData['lineups'] = sideProjections
    ? (() => {
        const yourLine = sideProjections.you.lineup
        const oppLine = sideProjections.opponent.lineup
        const depth = Math.max(yourLine.length, oppLine.length)
        if (depth === 0) {
          return {
            available: false as const,
            reason: 'neither roster has a starting lineup stored for this week',
          }
        }
        const template = startingSlotTemplate(league.settings)
        const slots: MatchupSlot[] = []
        for (let i = 0; i < depth; i++) {
          const you = cellFor(yourLine[i])
          const opponent = cellFor(oppLine[i])
          slots.push({
            slotLabel:
              template?.[i] ?? inferSlotLabel(you?.position ?? opponent?.position ?? null, i),
            you,
            opponent,
          })
        }
        return { available: true as const, data: slots }
      })()
    : {
        available: false as const,
        reason: 'we could not match both sides of this matchup to an imported roster',
      }

  /*
   * Coverage is counted over YOUR side only. Both lineups come from the same
   * league and therefore the same id space, so counting both would double a
   * single platform's failure and make "0 of 12" read as "0 of 24".
   */
  const identityNote = lineups.available
    ? identityGapNote({
        platform,
        total: lineups.data.filter((s) => s.you && !s.you.empty).length,
        resolved: lineups.data.filter((s) => s.you && !s.you.empty && s.you.name != null).length,
      })
    : null

  const playerScoring: MatchupData['playerScoring'] = scoreRows.length
    ? {
        available: true,
        data: {
          playersScored: actualBy.size,
          source: scoreRows[0]?.source ?? 'unknown',
        },
      }
    : {
        available: false,
        reason: lineupIds.length
          ? `no per-player scoring has been ingested for ${latest.seasonYear} week ${latest.week}, so each column below is a projection priced under this league's rules — not a live score`
          : 'we could not match both sides of this matchup to an imported roster',
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
      lineups,
      playerScoring,
      identityNote,
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
    avatarUrl: asImageUrl(myTeam.avatarUrl, platform),
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
            avatarUrl: null,
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
    lineups,
    playerScoring,
    identityNote,
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
          avatarUrl: asImageUrl(oppTeam?.avatarUrl, platform),
        },
      },
    },
  }
}
