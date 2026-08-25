import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { latestProjectionWeek, lookupProjections, summariseLineup } from './playerProjections'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'
import { isPreseason, resolveSportsWeek, type SportsWeek } from './sportsWeek'
import { describeScoringDifferences, hasIdpScoring, isIdpPosition } from './scoringNotes'
import { getTaxiTenure, type TaxiTenure } from './taxiTenure'
import { getNextMatchup, type NextMatchup } from './nextMatchup'
import { getRosterGrade, type RosterGrade } from './rosterGrade'
import { getByeWeeks } from './byeWeeks'
import { getGameWeather, type GameWeather } from './gameWeather'
import { resolveCurrentWeekForLeague } from './currentWeek'

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
  /**
   * The league's sport, carried per player so the crest resolves off the right
   * CDN. Hardcoding NFL would silently show a wrong or missing logo the day a
   * roster is anything else.
   */
  sport: string | null
  imageUrl: string | null
  /** "DEN vs LV · Sun 4:05p" — from the ingested schedule, null when unknown. */
  gameContext: string | null
  kickoff: Date | null
  /**
   * Exhibition or the real thing.
   *
   * ⚠ A PRESEASON PROJECTION IS NOT A FANTASY PROJECTION. Starters play a
   * series and sit. Showing an August game beside a number, with nothing
   * saying which kind of game it is, invites someone to read a meaningless
   * total as their week.
   */
  preseason: boolean
  /** Stadium, when the schedule carries one — the basis for the dome symbol. */
  venue: string | null
  injuryStatus: string | null
  /**
   * He is ruled out, so the projection is 0.0 rather than absent.
   *
   * ⚠ THIS IS THE ONE CASE WHERE ZERO IS HONEST. Everywhere else a zero would
   * be a claim we cannot support, which is why `projectedPoints` stays null.
   * A player the league has declared OUT will score nothing, and saying 0.0
   * next to the reason is more useful than an em dash that makes the reader
   * go and look it up.
   */
  ruledOut: boolean
  /**
   * The same projection re-scored under THIS LEAGUE'S rules.
   *
   * ⚠ THIS IS THE NUMBER THAT ACTUALLY APPLIES TO YOU. `projectedPoints` is the
   * vendor's line collapsed under a generic PPR preset — a league nobody is in.
   * This one is the vendor's per-stat components multiplied by the league's own
   * `scoring_settings`. In a TE-premium, six-point-passing-TD or IDP league the
   * two are not close, and the generic one is the one that is wrong.
   *
   * Null when the league's scoring cannot be read, or when not one of its
   * scoring keys matched the projected stat line — which is NOT a zero-point
   * projection and must never render as 0.0.
   */
  afProjectedPoints: number | null
  /**
   * He plays indoors this week, so weather is not a factor.
   *
   * Resolved from the HOME TEAM, not from `SportsGame.venue` — the rows that
   * carry a season type do not carry a venue, so reading the venue column would
   * return nothing for most games.
   *
   * ⚠ Retractable roofs are recorded as domes. Six stadiums can play open, and
   * nothing in this repo tracks whether the roof was shut, so a "dome" here
   * means "roofed", not "definitely closed".
   */
  indoors: boolean | null
  /**
   * The cached forecast for this player's game, when one exists.
   *
   * Null for a game further out than the weather cron reaches, which is the
   * common case before the week starts. The venue mark still renders from the
   * stadium alone — "outdoors, forecast not in yet" is a different statement
   * from "outdoors, and here is the forecast".
   */
  weather: GameWeather | null
  /**
   * His team is not playing this week.
   *
   * ⚠ THE MOST PREVENTABLE LOSS IN FANTASY. Starting a player on bye is a
   * guaranteed zero and nothing on this screen warned about it. Only ever set
   * when the week's schedule is complete enough to tell a bye from a gap in
   * our own data — see byeWeeks.ts.
   */
  onBye: boolean
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
    /** The manager's display name. Imported since day one, never rendered. */
    ownerName: string
    /** Their own avatar, not the league crest. Already a full URL when present. */
    managerAvatarUrl: string | null
    record: string
    rank: number | null
    pointsFor: number
    pointsAgainst: number
    teamCount: number
  }>
  starters: SectionState<LineupSlot[]>
  bench: SectionState<LineupPlayer[]>
  /**
   * Injured reserve and taxi squad, kept apart.
   *
   * ⚠ THEY WERE ONE LIST AND EVERY ROW IN IT WAS LABELLED "IR". A taxi-squad
   * rookie is not injured, and a screen that says he is tells a manager to go
   * and fix something that is not broken. They are different rules, different
   * eligibility and different deadlines, so they are different sections.
   */
  ir: SectionState<LineupPlayer[]>
  taxi: SectionState<Array<LineupPlayer & { tenure: TaxiTenure | null }>>
  /** Earliest kickoff among starters — the real lineup lock. */
  lock: SectionState<{
    at: Date
    anyEmptySlot: boolean
    /** The week this lock belongs to, so the banner can name it. */
    week: number | null
    season: number | null
    /**
     * A lock further out than a week is not a deadline, it is a coverage gap.
     *
     * ⚠ THIS IS THE 2,321-HOUR COUNTDOWN, MADE VISIBLE. Rather than silently
     * counting down to a game months away, the banner can say the schedule for
     * the coming week has not been ingested yet — which is the actual problem.
     */
    daysAway: number
  }>
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
    /**
     * The same lineup totalled under THIS LEAGUE'S scoring.
     *
     * Null when the league's scoring settings are unreadable, so the screen can
     * show one number honestly rather than two numbers that are secretly the
     * same one.
     */
    afTotal: number | null
    /** How many starters the league-scored total was built from. */
    afProjected: number
    /**
     * Whether the standard total is worth showing at all.
     *
     * ⚠ IN AN IDP LEAGUE IT IS NOT. The generic line does not score defenders,
     * so their contribution is null and the standard total is summed over only
     * the offensive half of the lineup. On a real 16-slot IDP roster that
     * printed 53.0 beside a league total of 166.7 — two numbers that look
     * comparable, measured over different players. The tile shows an em dash
     * and says why instead.
     */
    standardComparable: boolean
  }>
  /**
   * Why the two totals differ, in the league's own terms — the answer to the
   * button that offers to explain it.
   */
  projectionBasis: {
    /** e.g. "TE gets 1.5 per reception here, not 1." Empty when nothing stands out. */
    notes: string[]
    scoringKnown: boolean
  }
  /**
   * The upcoming matchup, projected.
   *
   * ⚠ THIS IS WHAT "POINTS FOR / AGAINST" SHOULD SAY BEFORE WEEK 1. Those tiles
   * showed the season's running totals, which are 0-0 for everyone until a game
   * is scored — two em dashes in the most prominent position on the screen, at
   * exactly the moment people look at their roster most.
   */
  nextMatchup: SectionState<NextMatchup>
  rosterGrade: SectionState<RosterGrade>
  /**
   * Byes coming up, so a stack is visible before the waiver wire is picked
   * over rather than on the morning it bites.
   */
  upcomingByes: Array<{ week: number; names: string[] }>
  liveScore: UnavailableSection
}

/** Slot labels in the order fantasy lineups conventionally read. */
function inferSlotLabel(position: string | null, index: number): string {
  const p = (position ?? '').toUpperCase()
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'].includes(p)) return p === 'DST' ? 'DEF' : p
  return p || `SLOT ${index + 1}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * "Sun 4:05p".
 *
 * ⚠ THE DAY IS NOT DECORATION. Without it every row on the screen read as a
 * time of day with no date attached, so a game three months away looked
 * exactly like a game this weekend — which is precisely how a November
 * kickoff sat on the roster for weeks without anyone being able to see it.
 */
function formatKickoff(d: Date | null): string | null {
  if (!d) return null
  const hours = d.getUTCHours()
  const mins = d.getUTCMinutes()
  const ampm = hours >= 12 ? 'p' : 'a'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  return `${DAYS[d.getUTCDay()]} ${h12}:${String(mins).padStart(2, '0')}${ampm}`
}

/**
 * Statuses that mean "he will not play", as distinct from "he might".
 *
 * ⚠ QUESTIONABLE AND DOUBTFUL ARE DELIBERATELY ABSENT. They keep their real
 * projection, because those players often do play and zeroing them would tell
 * a manager to bench someone on a designation that means uncertainty, not
 * absence. Only a declaration of absence produces a zero.
 */
const RULED_OUT = ['out', ' ir', 'ir ', 'injured reserve', 'suspend', 'pup', 'nfi', 'did not play']

function isRuledOut(status: string | null): boolean {
  if (!status) return false
  const t = ` ${status.trim().toLowerCase()} `
  if (t.trim() === 'ir') return true
  return RULED_OUT.some((needle) => t.includes(needle))
}

async function resolvePlayers(
  ids: string[],
  sport: string,
  projectionWeek: { season: string; week: number } | null,
  /** The real-world week to pull games for. Null means we could not resolve one. */
  week: SportsWeek | null,
  /**
   * This league's `scoring_settings`, for re-scoring the vendor's component
   * line. Null when the league never recorded any — in which case there is no
   * league-specific number to compute and the screen shows only the generic one.
   */
  scoringSettings: Record<string, unknown> | null
): Promise<Map<string, LineupPlayer>> {
  /*
   * ⚠ IN AN IDP LEAGUE THE GENERIC NUMBER IS NOT A PROJECTION OF ANYTHING for a
   * defender. Standard PPR contains no defensive scoring, so the vendor's line
   * returns whatever incidental offensive stat a defender is projected for.
   * Measured on a real roster: 0.3 for a linebacker the league projects at 18,
   * 0.6 for an edge rusher projected at 9. Those are not low estimates, they
   * are the absence of an estimate wearing a number.
   */
  const leagueScoresIdp = hasIdpScoring(scoringSettings)
  const out = new Map<string, LineupPlayer>()
  if (ids.length === 0) return out

  const rows = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: ids } },
    select: { sleeperId: true, name: true, position: true, team: true, imageUrl: true },
  })

  /*
   * ⚠ SCOPED TO A SEASON AND A WEEK, NOT TO "THE FUTURE".
   *
   * This asked for every game after now, ordered by kickoff, and took the first
   * per team. That is only correct when the schedule table is complete, and it
   * is not. On production the first matching row was in late NOVEMBER, so every
   * starter showed a November opponent and the lock counted down 97 days to it.
   * Nothing looked wrong — real teams, a real kickoff — and with no date on the
   * row there was nothing to give it away.
   *
   * ⚠ AND THE TEAM FILTER WAS RUN IN SQL AGAINST THE WRONG VOCABULARY.
   * `SportsPlayer.team` is an abbreviation ("KC"); `SportsGame.homeTeam` holds
   * whatever the provider called it — ESPN writes "Kansas City Chiefs", Rolling
   * Insights writes the mascot. `homeTeam: { in: ["KC", ...] }` therefore matched
   * only the minority of rows that happen to store an abbreviation, which is a
   * silent partial join: some players get a game, some do not, and which is
   * which depends on who ingested the row.
   *
   * So the week is filtered in SQL and the TEAMS are matched in memory through
   * the normaliser that understands all three spellings. One NFL week is about
   * sixteen fixtures — and up to four rows each, because the unique key includes
   * `source` — so this is a small set by construction.
   */
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))] as string[]
  const wanted = new Map<string, string>()
  for (const t of teams) {
    const norm = normalizeTeamAbbrev(t)
    if (norm) wanted.set(norm, t)
  }

  const weekGames =
    wanted.size > 0 && week
      ? await prisma.sportsGame
          .findMany({
            where: {
              sport,
              season: week.season,
              week: week.week,
              /*
               * ⚠ WITHOUT THIS, PRESEASON WEEK 1 AND REGULAR WEEK 1 ARE THE
               * SAME QUERY. They share a season and a week number, so the
               * lookup returned both and the `startTime asc` ordering picked
               * the exhibition game every time. Every starter was badged
               * PRESEASON and the lineup lock read "Locked" against a date in
               * mid-August, for a week that had not been played.
               */
              seasonType: week.seasonType,
            },
            orderBy: { startTime: 'asc' },
            take: 400,
            select: {
              homeTeam: true,
              awayTeam: true,
              startTime: true,
              seasonType: true,
              venue: true,
            },
          })
          .catch(() => [])
      : []

  type Candidate = {
    opponent: string
    home: boolean
    at: Date
    preseason: boolean
    venue: string | null
    /** Whether the provider row that produced this knew its season type. */
    typed: boolean
  }

  const best = new Map<string, Candidate>()

  /**
   * Is `next` a better row for this team than what we already have?
   *
   * ⚠ THE SAME FIXTURE ARRIVES UP TO FOUR TIMES, ONE PER PROVIDER, AND THEY DO
   * NOT AGREE. The unique key includes `source`, and `seasonType` is populated
   * on the Rolling Insights and ESPN rows but null on TheSportsDB's row for the
   * same game — deliberately, because that provider does not carry the field.
   * Whichever row happened to sort first would otherwise decide at random
   * whether a game could be labelled preseason at all.
   *
   * Earlier kickoff wins, because that is the one that locks the lineup. On a
   * tie — which is what duplicate rows for one fixture look like — the row that
   * knows its season type wins.
   */
  function better(next: Candidate, current: Candidate | undefined): boolean {
    if (!current) return true
    if (next.at.getTime() !== current.at.getTime()) return next.at < current.at
    if (next.typed !== current.typed) return next.typed
    // Same kickoff, same knowledge: prefer the row that carries a venue.
    return current.venue == null && next.venue != null
  }

  for (const g of weekGames) {
    if (!g.startTime) continue
    const home = normalizeTeamAbbrev(g.homeTeam)
    const away = normalizeTeamAbbrev(g.awayTeam)
    for (const [team, opponent, isHome] of [
      [home, away, true],
      [away, home, false],
    ] as const) {
      if (!team || !opponent) continue
      const rosterTeam = wanted.get(team)
      if (!rosterTeam) continue

      const candidate: Candidate = {
        opponent,
        home: isHome,
        at: g.startTime,
        preseason: isPreseason(g.seasonType),
        venue: g.venue ?? null,
        typed: g.seasonType != null,
      }
      if (better(candidate, best.get(rosterTeam))) best.set(rosterTeam, candidate)
    }
  }

  const nextGameFor = best

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
    const injuryStatus = injuryByName.get(r.name.toLowerCase()) ?? null
    const ruledOut = isRuledOut(injuryStatus)
    const projection = projections.get(r.sleeperId) ?? null
    const feedProjection = projection?.projectedPoints ?? null

    /*
     * The league-specific number. `computeLeagueProjectedPoints` returns null
     * rather than 0 when none of the league's scoring keys matched the stat
     * line, which is the difference between "this league scores him at nothing"
     * and "we cannot score this league" — only the second is ever true here.
     */
    const leagueScored =
      scoringSettings && projection?.componentStats
        ? computeLeagueProjectedPoints(projection.componentStats, scoringSettings)
        : null

    // Indoors is a fact about the home stadium, so it is resolved from whoever
    // is hosting — the player's own team when at home, his opponent when away.
    const hostTeam = g ? (g.home ? r.team : g.opponent) : null
    const venueInfo = hostTeam
      ? resolveVenueForTeam({ sport: sport as 'NFL', teamAbbrev: normalizeTeamAbbrev(hostTeam) })
      : { kind: 'none' as const }

    out.set(r.sleeperId, {
      sleeperId: r.sleeperId,
      name: r.name,
      position: r.position,
      team: r.team,
      sport,
      imageUrl: r.imageUrl,
      gameContext: g ? `${r.team} ${g.home ? 'vs' : '@'} ${g.opponent}${time ? ` · ${time}` : ''}` : null,
      kickoff: g?.at ?? null,
      preseason: g?.preseason ?? false,
      venue: g?.venue ?? null,
      injuryStatus,
      ruledOut,
      /*
       * A player the league has ruled out scores nothing, and that is a fact we
       * can stand behind — so it is the one case where a zero replaces the em
       * dash. Everywhere else null survives, because "we have no projection"
       * and "we project nothing" are different claims.
       */
      projectedPoints: ruledOut
        ? 0
        : leagueScoresIdp && isIdpPosition(r.position)
          ? null
          : feedProjection,
      afProjectedPoints: ruledOut ? 0 : leagueScored?.points ?? null,
      indoors: venueInfo.kind === 'coords' ? venueInfo.dome : null,
      // Both filled in by the caller: byes need the week's full slate, and the
      // forecast is one batched cache read for the whole roster.
      weather: null,
      onBye: false,
    })
  }

  return out
}

export async function getMyTeamData(leagueId: string, userId: string): Promise<MyTeamData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, name: true, platform: true, leagueType: true, sport: true,
      // `scoring_settings` lives in here — the basis for the league-specific number.
      settings: true,
      /*
       * ⚠ A SECOND, DIFFERENT LEAGUE ID. `WeeklyMatchup.leagueId` holds THIS
       * one, not `League.id`. Both are strings, so using the wrong one returns
       * an empty result instead of an error.
       */
      platformLeagueId: true,
      // Superflex and dynasty both change which value market applies.
      isDynasty: true,
      starters: true,
    },
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
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: {
      available: false as const,
      reason: 'no schedule on file for this league yet',
    },
    upcomingByes: [],
    rosterGrade: {
      available: false as const,
      reason: 'no roster found to grade',
    },
    liveScore: { available: false as const, reason: 'no live scoring ingested for imported leagues' },
  }

  const myTeamRow = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: {
      teamName: true, ownerName: true, wins: true, losses: true, ties: true,
      pointsFor: true, pointsAgainst: true, currentRank: true,
      platformUserId: true, externalId: true,
      // The manager's own avatar. Already imported, never rendered until now.
      avatarUrl: true,
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
      ir: unknown,
      taxi: unknown,
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
      managerAvatarUrl: myTeamRow.avatarUrl ?? null,
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
    return {
      ...base,
      team,
      starters: noRoster,
      bench: noRoster,
      ir: noRoster,
      taxi: noRoster,
      lock: noRoster,
    }
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

  /*
   * The REAL-WORLD week, which is a different question from the week the
   * projection feed last wrote. They drift, and conflating them is how a
   * roster ends up showing week-1 projections beside November opponents.
   */
  const sportsWeek = await resolveSportsWeek(sport)

  /*
   * Null here is a real state, not a failure: plenty of imported leagues never
   * recorded their scoring. The screen then shows the generic projection alone
   * and says why there is no league-specific one, rather than printing the
   * generic number twice under two different labels.
   */
  const scoringSettings = extractScoringSettings(league.settings)

  const resolved = await resolvePlayers(
    [...new Set([...starterIds, ...allIds, ...reserveIds, ...taxiIds])],
    sport,
    projectionWeek,
    sportsWeek,
    scoringSettings
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

  /*
   * ⚠ TAXI WAS MISSING FROM THIS FILTER AND EVERY TAXI PLAYER RENDERED TWICE.
   * `players` is the whole roster, so the bench is what is left after removing
   * every other section. Excluding IR but not taxi put taxi players on the
   * bench AND in the reserve list below it — the same player, twice, in two
   * places that imply different things about whether he can be started.
   */
  const starterSet = new Set(starterIds)
  const reserveSet = new Set(reserveIds)
  const taxiSet = new Set(taxiIds)
  const benchIds = allIds.filter(
    (id) => !starterSet.has(id) && !reserveSet.has(id) && !taxiSet.has(id),
  )

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
          {
            playerId: id,
            projectedPoints: p!.projectedPoints as number,
            name: p!.name,
            position: p!.position,
            team: p!.team,
            // summariseLineup only totals points; the component line is not its
            // business, and passing the roster's copy would imply it was.
            componentStats: null,
          },
        ])
    )
  )

  /*
   * The league-scored total, summed over the same starters.
   *
   * ⚠ COUNTED SEPARATELY FROM THE GENERIC TOTAL, NOT ASSUMED TO MATCH IT. A
   * player can carry a vendor projection and still fail to produce a
   * league-scored one — that is exactly what happens when a league's scoring
   * keys do not match the projected stat line. Reusing the generic coverage
   * count would report a total built from six starters as though it came from
   * eight.
   */
  let afTotal = 0
  let afProjected = 0
  for (const id of projectedIds) {
    const v = resolved.get(id)?.afProjectedPoints
    if (v == null) continue
    afTotal += v
    afProjected += 1
  }

  const scoringNotes = describeScoringDifferences(scoringSettings)

  /*
   * Null when the question cannot be answered — no recorded taxi-years limit,
   * or no season-end snapshots to count against it. The section then shows the
   * players without a countdown, because a confident "1 year left" that is
   * wrong is how someone loses a player to a deadline they thought they had.
   */
  const tenure = taxiIds.length > 0 ? await getTaxiTenure(leagueId, taxiIds) : null

  /*
   * The league's own week, which is a third clock again — distinct from both
   * the projection feed's week and the real-world NFL week. Matchups are keyed
   * by it, and it is resolved from the matchup rows themselves rather than a
   * calendar because sync bootstraps every week as an unscored 0-0 row.
   */
  const leagueWeek = league.platformLeagueId
    ? await resolveCurrentWeekForLeague(league.platformLeagueId)
    : null

  /*
   * Byes for THIS week (to flag a starter who is not playing) and the next few
   * (to show a stack forming). Null whenever the schedule is too thin to tell a
   * bye from a gap in ingestion — see byeWeeks.ts.
   */
  /*
   * One cache read for the whole roster. Keyed by the HOST team, because the
   * forecast belongs to the stadium the game is played in, not to the player.
   */
  const weather = await getGameWeather({
    sport,
    games: new Map(
      [...resolved.values()].map((p) => [
        p.sleeperId,
        {
          hostTeam: p.gameContext?.includes(' @ ')
            ? (p.gameContext.split(' @ ')[1] ?? '').split(' · ')[0]
            : p.team,
          kickoff: p.kickoff,
        },
      ]),
    ),
  }).catch(() => new Map())

  for (const [id, w] of weather) {
    const p = resolved.get(id)
    if (p) p.weather = w
  }

  const byes = sportsWeek
    ? await getByeWeeks({
        sport,
        season: sportsWeek.season,
        playerTeams: new Map([...resolved.values()].map((p) => [p.sleeperId, p.team])),
        fromWeek: sportsWeek.week,
      }).catch(() => null)
    : null

  if (byes && sportsWeek) {
    for (const id of byes.byWeek.get(sportsWeek.week) ?? []) {
      const p = resolved.get(id)
      if (!p) continue
      p.onBye = true
      /*
       * A player on bye scores nothing, and unlike "no projection on file" that
       * is a fact — the same rule as a ruled-out player. Leaving a stale number
       * beside a bye badge would be the screen arguing with itself.
       */
      p.projectedPoints = 0
      p.afProjectedPoints = 0
    }
  }

  const upcomingByes = byes
    ? [...byes.byWeek.entries()]
        .filter(([w]) => w !== sportsWeek?.week)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 4)
        .map(([week, ids]) => ({
          week,
          names: ids.map((id) => resolved.get(id)?.name).filter(Boolean) as string[],
        }))
        .filter((b) => b.names.length > 0)
    : []

  const grade = await getRosterGrade({
    leagueId,
    myPlatformUserIds: candidates,
    isDynasty: Boolean(league.isDynasty),
    starters: league.starters,
  }).catch(() => null)

  const matchup = leagueWeek
    ? await getNextMatchup({
        leagueId,
        platformLeagueId: league.platformLeagueId,
        myExternalId: myTeamRow.externalId,
        seasonYear: leagueWeek.seasonYear,
        week: leagueWeek.week,
        scoringSettings,
        projectionWeek,
      }).catch(() => null)
    : null

  return {
    ...base,
    team,
    projectionBasis: { notes: scoringNotes, scoringKnown: scoringSettings != null },
    upcomingByes,
    rosterGrade: grade
      ? { available: true, data: grade }
      : {
          available: false,
          /*
           * One reason, and it names the input that is missing. The old copy
           * said we "do not compute positional replacement levels", which
           * stopped being true and would have gone on claiming a limitation
           * that no longer existed.
           */
          reason:
            'we need prices for most of this league’s rosters to rank yours against them, and we do not have them yet',
        },
    nextMatchup: matchup
      ? { available: true, data: matchup }
      : {
          available: false,
          reason: leagueWeek
            ? `no week ${leagueWeek.week} matchup recorded for your team yet`
            : 'no schedule on file for this league yet',
        },
    projections:
      projectionWeek && projectedIds.length > 0
        ? {
            available: true,
            data: {
              ...lineup,
              season: projectionWeek.season,
              week: projectionWeek.week,
              afTotal: afProjected > 0 ? Math.round(afTotal * 100) / 100 : null,
              afProjected,
              // Comparable only when both totals were built from the same
              // players. IDP suppression is what breaks that.
              standardComparable: !hasIdpScoring(scoringSettings),
            },
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
    ir:
      reserveIds.length > 0
        ? {
            available: true,
            data: reserveIds.map((id) => resolved.get(id)).filter(Boolean) as LineupPlayer[],
          }
        : { available: false, reason: 'nobody on injured reserve' },
    taxi:
      taxiIds.length > 0
        ? {
            available: true,
            data: taxiIds
              .map((id) => {
                const p = resolved.get(id)
                return p ? { ...p, tenure: tenure?.get(id) ?? null } : null
              })
              .filter(Boolean) as Array<LineupPlayer & { tenure: TaxiTenure | null }>,
          }
        : { available: false, reason: 'nobody on the taxi squad' },
    lock:
      kickoffs.length > 0
        ? {
            available: true,
            data: {
              at: kickoffs[0],
              anyEmptySlot: starters.some((s) => s.empty),
              week: sportsWeek?.week ?? null,
              season: sportsWeek?.season ?? null,
              daysAway: Math.round((kickoffs[0].getTime() - Date.now()) / 86_400_000),
            },
          }
        : {
            available: false,
            reason: sportsWeek
              ? `no week ${sportsWeek.week} game found for any of your starters yet`
              : 'no upcoming game found for your starters, so there is no lock time to count down to',
          },
  }
}
