import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildSeasonTimeline,
  leagueWeekFromSettings,
  regularSeasonWeeks,
  type TimelinePhase,
} from './seasonTimeline'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { getLeagueActivity } from './leagueActivity'
import { getAllPlayBoard, type AllPlayBoard } from './allPlay'
import type { ActivityPlayer } from './leagueActivity'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { getLeagueScoreboard, type LeagueScoreboard } from './leagueScoreboard'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { latestProjectionWeek } from './playerProjections'
import { getRecentTrades } from './recentTrades'
import { getMatchupData } from '@/lib/core-app/matchup'
import { getRivalRecords } from '@/lib/core-app/dash3aPanels'
import { getDraftHqAll } from './draftHqAll'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import { resolveLeagueStage, isPreDraftOrDrafting } from '@/lib/league-stage/leagueStage'

/**
 * Everything the league-selected dashboard (screen 2) renders, read from the
 * database.
 *
 * The handoff's screen shows a season timeline, a live matchup with a win
 * probability, a Draft HQ card, a Commissioner Hub card, standings, Chimmy
 * intelligence and a league buzz feed. Only some of that is computable from what
 * we actually store for an imported league, so each section returns either real
 * values or an explicit unavailable reason — never a placeholder that looks like
 * a reading.
 *
 * This matters more here than on the all-leagues home. A win probability is the
 * single most authoritative-looking number in the product; rendering one from
 * absent data would be the exact failure this codebase keeps having to undo.
 */

export type SectionState<T> =
  | { available: true; data: T }
  | { available: false; reason: string }

/**
 * A section with NO DATA PATH AT ALL — nothing computes it yet, so it is
 * unavailable on every code path, for every league, always.
 *
 * ⚠ THIS IS A DIFFERENT CLAIM FROM `SectionState<T>`, WHICH MEANS "sometimes
 * available". These were written as `SectionState<never>`, which is technically
 * that same union with an uninhabitable success branch — so every screen that read
 * `.reason` off one failed to compile (21 errors), because TypeScript still had to
 * consider an `available: true` case that can never occur. Narrowing each site
 * would have silenced it while leaving the type lying about what exists.
 *
 * Naming it is the point: `UnavailableSection` is a standing inventory of what
 * still needs an engine. When one gets built, its field changes to
 * `SectionState<T>` and the compiler finds every screen that has to handle real
 * data — which is exactly the reminder you want at that moment.
 */
export type UnavailableSection = { available: false; reason: string }

/**
 * A league's display name, with a stated fallback.
 *
 * ⚠ THIS EXISTS BECAUSE `League.name` IS `String?` IN THE SCHEMA WHILE EVERY
 * core-app surface declares `name: string`. That single mismatch produced 38 type
 * errors across seven resolvers and six screens: each resolver's return object
 * failed to satisfy its own *Data type, TypeScript widened the whole object, and
 * the screens then saw `SectionState<never>` and could not narrow `.reason`. One
 * nullable column, thirty-eight errors, none of them where the problem was.
 *
 * Coalescing here rather than loosening the types to `string | null` is
 * deliberate: every consumer needs something renderable, and six screens each
 * inventing their own fallback is how you end up with a league called "undefined"
 * on one tab and blank on another.
 *
 * Measured before choosing the fallback: 0 of 120 production leagues have a null
 * or empty name, so this is a type-safety guard for a case the data does not
 * currently produce — not a label anyone should expect to see.
 */
export function leagueDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : 'Untitled league'
}

export type LeagueStanding = {
  teamId: string
  teamName: string
  ownerName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  rank: number | null
  isYou: boolean
  /**
   * FAAB left, from `Roster.faabRemaining` — written at import as
   * `league.settings.waiver_budget − roster.settings.waiver_budget_used`.
   *
   * ⚠ NULL MEANS UNKNOWN AND MUST RENDER AS A DASH. The importer stores null
   * whenever either half of that subtraction was missing, and a league that
   * does not use FAAB at all stores null for everyone. Printing "$0" would tell
   * a manager with a full budget that they are broke, which is the worst
   * direction for this particular error to point.
   */
  faabRemaining: number | null
}

/**
 * One phase of the season timeline.
 *
 * Now an alias of the timeline builder's own type rather than a second
 * declaration of the same shape — two structurally identical types drift, and
 * the drift shows up as a panel that silently renders nothing.
 */
export type SeasonStage = TimelinePhase

export type LeagueHomeData = {
  league: {
    id: string
    name: string
    platform: string
    format: string | null
    sport: string
    season: number | null
    currentWeek: number | null
  }
  /** The signed-in user's own team in this league, when we can identify it. */
  yourTeam: SectionState<{
    teamName: string
    record: string
    rank: number | null
    pointsFor: number
  }>
  /**
   * Where this league is in its year, and whether the season has started.
   *
   * The screen renders the same six sections for every league, so a league three weeks
   * from its draft got the in-season layout and five panels correctly reporting they had
   * nothing. A drafting league has no standings because no game has been played -- that
   * is not a gap in ingestion, and saying so matters: one reads as "we are broken", the
   * other as "come back after the draft".
   */
  stage: string | null
  preSeason: boolean
  /**
   * The week the scoreboard is showing, and the weeks it could show.
   *
   * `selected` is what is on screen; `current` is where the league actually is.
   * They differ whenever someone has picked a week, and the screen says so —
   * a future week rendered exactly like the live one is the same failure as a
   * projected scoreboard that looks played.
   */
  weekPicker: {
    weeks: number[]
    selected: number
    current: number | null
    /** Ahead of where the league is, so nothing here has happened yet. */
    isFuture: boolean
  } | null
  standings: SectionState<LeagueStanding[]>
  timeline: SectionState<SeasonStage[]>
  /*
   * ⚠ THIS WAS `UnavailableSection` AND ITS REASON WAS FALSE. It read "no weekly
   * matchup or scoring data ingested for imported leagues" while
   * `lib/core-app/matchup.ts` was already resolving exactly that for the Matchup
   * screen: WeeklyMatchup rows for the week, both lineups priced against
   * fantasy_projections, and a real win probability. Promoting it is the move
   * this file's own UnavailableSection comment prescribes — the compiler then
   * finds every screen that has to handle real data.
   */
  matchup: SectionState<{
    week: number
    season: number
    you: { name: string; points: number }
    opponent: { name: string; points: number }
    /** Absent when both lineups could not be priced. Never a hedged number. */
    winProbability: { pWin: number; detail: string; confidence: string } | null
  }>
  draftHq: SectionState<{
    headline: string
    detail: string
    /** Where the board or results live, when there is something to open. */
    href: string | null
    linkLabel: string | null
  }>
  /**
   * A preview of what the commissioner can do here, for commissioners only.
   *
   * THE PANEL WAS PERMANENTLY BLANK, with a reason claiming commissioner tasks
   * are not ingested. League health and manager activity are both real and both
   * work on imported leagues; nothing was reading them.
   */
  commissioner: SectionState<{
    /** Managers who have not touched their team inside the idle window. */
    inactiveCount: number
    atRiskCount: number
    totalManagers: number
    /** Named, because "3 inactive" is a statistic and a name is an action. */
    inactiveNames: string[]
    /** Deep link into the full commissioner surface. */
    href: string
  }>
  buzz: SectionState<
    Array<{
      id: string
      actor: string
      text: string
      at: Date | null
      /** The manager's own avatar, so the feed reads as people not rows. */
      avatarUrl?: string | null
      /**
       * Who moved, with headshots. The sentence in `text` already names them;
       * these are for the faces beside it, so a claim is recognisable before
       * it is read.
       */
      players?: ActivityPlayer[]
      /** What the claim cost. Null is UNKNOWN — render nothing, never $0. */
      bid?: number | null
    }>
  >
  /**
   * Every game in the league this week.
   *
   * ⚠ THE PAGE SHOWED ONE MATCHUP — THE VIEWER'S — on a screen whose whole
   * subject is the league. The other games were invisible.
   */
  scoreboard: SectionState<LeagueScoreboard>
  /**
   * All-play records and power rankings.
   *
   * ⚠ THE STANDINGS PANEL ALONE CANNOT TELL A GOOD TEAM FROM A LUCKY ONE. A
   * 12-team league plays one opponent a week, so a team can post the
   * second-highest score in the league and lose. All-play removes the schedule
   * and the gap between the two is luck — measured, not felt.
   */
  powerBoard: SectionState<AllPlayBoard>
  /*
   * 3b draws a "Rivalry radar · this league" panel: head-to-head record against
   * each opponent, plus when that manager is usually active. Neither is stored.
   * `LeagueMatchup` carries no per-opponent history for imported leagues, and
   * nothing records manager session times at all — the handoff's "he's usually
   * on Sun 10a–12p" has no source anywhere in the schema.
   *
   * Declared here rather than omitted from the screen so it stays on the
   * standing inventory of what needs an engine, and so the panel says what is
   * missing instead of the section quietly not existing.
   */
  /*
   * ⚠ ALSO PROMOTED. Head-to-head IS stored: `WeeklyMatchup.matchupId` pairs the
   * two rosters inside a week, so every past meeting is recoverable. What is
   * genuinely missing is only WHEN a manager is usually online — so that single
   * line is dropped rather than guessed.
   */
  rivalry: SectionState<
    Array<{
      key: string
      name: string
      wins: number
      losses: number
      meetings: number
      lastResult: string | null
    }>
  >
  syncAge: { label: string; stale: boolean }
}

function recordOf(t: { wins: number; losses: number; ties: number }): string {
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`
}

/** Reads an integer out of the settings blob, tolerating string values. */
function settingWeek(settings: unknown, ...keys: string[]): number | null {
  if (!settings || typeof settings !== 'object') return null
  const bag = settings as Record<string, unknown>
  for (const key of keys) {
    const raw = bag[key]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (Number.isFinite(n) && n > 0 && n < 30) return Math.floor(n)
  }
  return null
}

/*
 * ⚠ `buildTimeline` LIVED HERE AND HAS BEEN DELETED, not merely bypassed.
 *
 * It fell back to a hardcoded playoff week 15 and a championship at +2
 * whenever a league had no playoff start on file, so a league that trades all
 * season — or has no bracket at all — was shown a typical 12-team redraft
 * calendar as if it were its own. Leaving it in place unused would let the
 * next person wire it back up.
 *
 * Replaced by `buildSeasonTimeline` in ./seasonTimeline, which reads the
 * league's own settings and omits any phase whose setting is absent.
 */

export async function getLeagueHomeData(
  leagueId: string,
  userId: string,
  /**
   * A week the viewer picked, from `?week=`. Ignored unless it is a real week
   * of this league's regular season — a hand-edited URL must not be able to
   * ask for week 40 and get an empty scoreboard that looks like missing data.
   */
  requestedWeek?: number | null,
): Promise<LeagueHomeData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      platform: true,
      sport: true,
      season: true,
      leagueType: true,
      /* The trade-grade cache is keyed by the platform's league id. */
      platformLeagueId: true,
      updatedAt: true,
      // Where the league is in its year. `status` is written by the platform import;
      // `lifecycleState` is our own state machine, which has never run for imported
      // leagues and sits at its in_season default. resolveLeagueStage prefers the
      // former -- see lib/league-stage/leagueStage.ts.
      status: true,
      lifecycleState: true,
      // The timeline used to be built from the week number alone. These two keys
      // are present in League.settings on production Sleeper leagues, so the
      // deadline and playoff stages can be placed from the league's OWN
      // configuration instead of a generic NFL calendar.
      settings: true,
      // The one affirmative signal for an elimination format: a Sleeper import
      // can only ever write 'IDP', 'DYNASTY_IDP', 'legacy_summary' or null into
      // leagueVariant, so the format cannot be read from there.
      guillotineMode: true,
    },
  })
  if (!league) return null

  /*
   * A PRE-SEASON LEAGUE IS NOT A LEAGUE WITH MISSING DATA.
   *
   * Measured on a real drafting league: 12 teams, all with avatars, 13 rosters, synced
   * hours earlier -- and every in-season panel reporting "not ingested". Each message was
   * true and all of them were misleading, because the league has not played a game yet.
   * "Not ingested" reads as a broken pipeline; "the season has not started" reads as a
   * calendar, and only one of those is what is actually happening.
   *
   * Computed here rather than at the return so every section below can use it.
   */
  const stage = resolveLeagueStage(league)
  const preSeason = isPreDraftOrDrafting(league)

  /*
   * League buzz, from the trades the grade sweep has already resolved. One
   * cache read; nothing is recomputed here. A pick is named as a pick — the
   * two managers traded the pick, and resolving it to whoever it later became
   * would rewrite the deal they made.
   */
  const recentTrades = await getRecentTrades(
    [{ id: league.id, name: league.name ?? 'League', platformLeagueId: league.platformLeagueId }],
    new Date(),
    6,
  ).catch(() => [])
  /*
   * ⚠ AND THE WAIVERS THE PANEL SAID WERE "NOT READ". They are read — the
   * Decision-OS activity cron writes completed Sleeper waivers, free-agent
   * moves and trades daily, league-wide. The old copy blamed the data for a
   * query nobody had written.
   */
  const activity = await getLeagueActivity({
    leagueId: league.id,
    platformLeagueId: league.platformLeagueId,
    limit: 8,
  }).catch(() => null)

  const activityRows = (activity?.items ?? [])
    // Trades already arrive through the grade sweep below, with valuations
    // attached. Listing them twice would double the feed.
    .filter((i) => i.kind !== 'trade')
    .map((i) => {
      const moved = [
        i.adds.length > 0 ? `added ${i.adds.map((pl) => pl.label).join(', ')}` : null,
        i.drops.length > 0 ? `dropped ${i.drops.map((pl) => pl.label).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        id: i.id,
        /*
         * The team name is what people call each other in a league; the
         * manager's handle is the fallback. "A manager" is the last resort and
         * now genuinely rare — it used to be EVERY row, because the attribution
         * joined on a column the writer hardcodes to null.
         */
        actor: i.teamName ?? i.managerName ?? 'A manager',
        text: moved || (i.kind === 'waiver' ? 'a waiver claim' : 'a roster move'),
        at: i.occurredAt,
        avatarUrl: i.avatarUrl,
        /*
         * Adds lead: the interesting half of a waiver is who you got. Drops
         * follow so a straight swap still shows both faces.
         */
        players: [...i.adds, ...i.drops],
        bid: i.bid,
      }
    })

  const powerBoard =
    league.season != null
      ? await getAllPlayBoard({
          leagueId: league.id,
          platformLeagueId: league.platformLeagueId,
          seasonYear: league.season,
        }).catch(() => null)
      : null

  const buzzRows = recentTrades.map((t) => ({
    id: t.id,
    actor: t.sides.map((sd) => sd.teamName || sd.managerName).join(' ⇄ '),
    text: t.sides
      .map(
        (sd) =>
          `${sd.teamName || sd.managerName} got ${
            sd.received.length > 0
              ? sd.received.map((a) => a.name).join(', ')
              : 'nothing we can name'
          }`,
      )
      .join(' · '),
    at: new Date(t.acceptedAt),
  }))

  /*
   * Rosters, for two unrelated jobs: how many exist (evidence a draft happened,
   * even when the draft object itself was never ingested) and how much FAAB
   * each has left.
   *
   * Joined to teams on `platformUserId`, which is the owner id on both sides.
   * A miss here costs one dash in one column — it is a display join, not a
   * gate, so it does not need the three-candidate fallback the scoreboard uses.
   */
  const rosterRows = await prisma.roster
    .findMany({
      where: { leagueId },
      select: { platformUserId: true, faabRemaining: true },
    })
    .catch((): Array<{ platformUserId: string; faabRemaining: number | null }> => [])

  const rosterCountForDraft = rosterRows.length
  const faabBy = new Map(rosterRows.map((r) => [r.platformUserId, r.faabRemaining]))

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      id: true,
      teamName: true,
      ownerName: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      currentRank: true,
      claimedByUserId: true,
      // The platform's roster id, so the scoreboard can mark your own game.
      externalId: true,
      // Both flags: a co-commissioner is exactly who the hub preview is for.
      isCommissioner: true,
      isCoCommissioner: true,
      // The owner id, which is how Roster rows (and their FAAB) are found.
      platformUserId: true,
    },
    orderBy: [{ currentRank: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }],
  })

  const yours = teams.find((t) => t.claimedByUserId === userId) ?? null

  /*
   * Commissioner status decides whether the hub preview exists at all.
   *
   * NOT `lib/commissioner/permissions.ts`. That family gates on `League.userId`
   * alone, which 403s every CO-commissioner — exactly the people this panel is
   * for. The team's own flags are the complete answer and are already loaded.
   */
  const viewerIsCommissioner = Boolean(yours?.isCommissioner || yours?.isCoCommissioner)

  const managerHealth = viewerIsCommissioner
    ? await getLeagueManagerHealth(league.id).catch(() => null)
    : null

  /*
   * Did this league draft, whatever we captured of the board? Populated rosters
   * are the evidence. Without this, a league with full rosters on screen was
   * told "no draft has been set up".
   */
  const draftedAlready = rosterCountForDraft > 0


  // A league whose teams all sit at 0-0 has been imported but never had results
  // read. Showing that as a standings table would present "everyone is 0-0" as a
  // finding rather than as an absence.
  const anyResults = teams.some((t) => t.wins > 0 || t.losses > 0 || t.ties > 0 || t.pointsFor > 0)

  /*
   * ⚠ STANDINGS AND THE POWER BOARD READ DIFFERENT TABLES, and only one of them
   * was being consulted. `LeagueTeam.wins/losses` comes from the import and sits
   * at 0-0 for plenty of leagues that have absolutely been played; the power
   * board derives its records from `WeeklyMatchup`, week by week. So the panel
   * said "no results read yet" while a full record for every team sat one
   * section above it.
   *
   * The import's own numbers still win when it has them — they are the
   * platform's official record, including any commissioner correction we would
   * never see in the weekly rows. This is only a fallback.
   */
  const standingsFromPowerBoard: LeagueStanding[] | null =
    !anyResults && powerBoard
      ? powerBoard.rows.map((r) => ({
          teamId: String(r.rosterId),
          teamName: r.teamName ?? r.managerName ?? `Roster ${r.rosterId}`,
          ownerName: r.managerName ?? '',
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          pointsFor: r.pointsFor,
          rank: r.powerRank,
          isYou: yours?.externalId != null && String(yours.externalId) === String(r.rosterId),
          /*
           * The power board is keyed on roster id and carries no owner id, so
           * FAAB cannot be joined on this path. Null is the honest answer —
           * better than joining on a key that means something else.
           */
          faabRemaining: null,
        }))
      : null

  const standings: SectionState<LeagueStanding[]> =
    teams.length === 0
      ? { available: false, reason: 'no teams imported for this league' }
      : !anyResults && standingsFromPowerBoard && standingsFromPowerBoard.length > 0
        ? { available: true, data: standingsFromPowerBoard }
        : !anyResults
        ? preSeason
          ? { available: false, reason: 'no standings until the season starts — this league has not drafted' }
          : { available: false, reason: 'teams imported but no results read yet — every record is 0-0' }
        : {
            available: true,
            data: teams.map((t) => ({
              teamId: t.id,
              teamName: t.teamName,
              ownerName: t.ownerName,
              wins: t.wins,
              losses: t.losses,
              ties: t.ties,
              pointsFor: t.pointsFor,
              rank: t.currentRank,
              isYou: t.id === yours?.id,
              faabRemaining: t.platformUserId ? faabBy.get(t.platformUserId) ?? null : null,
            })),
          }

  const yourTeam: SectionState<{ teamName: string; record: string; rank: number | null; pointsFor: number }> =
    yours == null
      ? { available: false, reason: 'we cannot tell which team is yours in this league yet' }
      : // Same test the standings block uses. Without it the header printed a
        // confident "0-0" directly above a panel saying no results had been read
        // — the screen contradicting itself, and "0-0" reading as a real record
        // rather than as the absence of one.
        !anyResults
        ? { available: false, reason: 'no results read for this league yet' }
        : {
          available: true,
          data: {
            teamName: yours.teamName,
            record: recordOf(yours),
            rank: yours.currentRank,
            pointsFor: yours.pointsFor,
          },
        }

  const age = describeAge('roster', league.updatedAt)

  /*
   * Current week comes from the ingested schedule, not from the League row —
   * which has no week column — and not from the calendar, which cannot know a
   * league's own week numbering.
   *
   * This is the first real consumer of the TheSportsDB games ingest: find the
   * next game for this sport and season that has not kicked off, and take its
   * week. If the sport's schedule was never ingested, currentWeek stays null and
   * the timeline reports itself unavailable rather than guessing.
   */
  /*
   * ⚠ THIS ASKED THE NFL CALENDAR A QUESTION ONLY THE LEAGUE CAN ANSWER.
   *
   * It used to take the next `SportsGame` kickoff, with no `seasonType` filter,
   * and render that row's `week` as the fantasy week. On 2026-08-24 the next
   * NFL fixture was PRESEASON week 3, so the header said "You are here · week 3"
   * for a season that had not kicked off. The number was real; it was a
   * preseason round number wearing a fantasy week's clothes.
   *
   * A real-world kickoff cannot answer this in principle — it knows nothing
   * about this league. Sleeper's own `leg` does, and is read first. The matchup
   * rows are the fallback, resolved as the earliest week still holding an
   * unscored row (sync bootstraps all 18 weeks at 0-0, so `max(week)` returns
   * 18 in August).
   */
  const currentWeek =
    leagueWeekFromSettings(league.settings) ??
    (league.platformLeagueId
      ? (await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null))?.week ?? null
      : null)

  /*
   * Which weeks this league plays, and which one to show.
   *
   * The picker is offered only when we know the season's length from the
   * league's own settings. Offering 1..18 to a 14-week league would invite
   * someone to select a week that does not exist and read the empty result as
   * broken ingestion.
   */
  const seasonWeeks = regularSeasonWeeks(league.settings)
  const weekOptions =
    seasonWeeks != null && seasonWeeks > 0 && seasonWeeks <= 30
      ? Array.from({ length: seasonWeeks }, (_, i) => i + 1)
      : null

  const viewWeek =
    requestedWeek != null && weekOptions != null && weekOptions.includes(requestedWeek)
      ? requestedWeek
      : currentWeek

  /*
   * The whole league's games. Scoped to the week the LEAGUE is in, not the NFL
   * calendar's — see the currentWeek note above — unless the viewer picked
   * another one.
   */
  const board =
    viewWeek != null && league.season != null
      ? await getLeagueScoreboard({
          leagueId: league.id,
          platformLeagueId: league.platformLeagueId,
          seasonYear: league.season,
          week: viewWeek,
          yourRosterId: yours?.externalId != null ? Number(yours.externalId) : null,
          scoringSettings: extractScoringSettings(league.settings),
          projectionWeek: await latestProjectionWeek().catch(() => null),
        }).catch(() => null)
      : null


  // One league through the shared aggregator — three set-based queries, and the
  // same status vocabulary handling (including `complete` vs `completed`).
  const draftAll = await getDraftHqAll(userId, [
    { id: league.id, name: league.name, platform: league.platform },
  ]).catch(() => null)
  const draftRow = draftAll?.rows?.[0] ?? null

  /*
   * Both of these were previously hardcoded as unavailable with reasons that were
   * not true. Reusing the SAME resolvers the other screens use, rather than a
   * second query, so two surfaces cannot disagree about one league's matchup.
   */
  const [matchupData, rivalData] = await Promise.all([
    preSeason ? Promise.resolve(null) : getMatchupData(league.id, userId).catch(() => null),
    preSeason ? Promise.resolve(null) : getRivalRecords(userId, [league.id]).catch(() => null),
  ])

  const resolvedMatchup: LeagueHomeData['matchup'] = preSeason
    ? { available: false, reason: 'no matchups yet \u2014 this league has not drafted' }
    : matchupData?.sides.available && matchupData.week.available
      ? {
          available: true,
          data: {
            week: matchupData.week.data.week,
            season: matchupData.week.data.season,
            you: {
              name: matchupData.sides.data.you.teamName,
              points: matchupData.sides.data.you.points,
            },
            opponent: {
              name: matchupData.sides.data.opponent.teamName,
              points: matchupData.sides.data.opponent.points,
            },
            /*
             * Carried only when the engine actually produced one. A matchup whose
             * lineups could not both be priced shows scores and NO percentage,
             * rather than a hedged one — a hedged probability still reads as a
             * probability.
             */
            winProbability: matchupData.winProbability.available
              ? {
                  pWin: matchupData.winProbability.data.pWin,
                  detail: matchupData.winProbability.data.detail,
                  confidence: matchupData.winProbability.data.confidence,
                }
              : null,
          },
        }
      : {
          available: false,
          // The resolver's OWN reason, not a blanket claim about ingestion.
          reason:
            (matchupData && !matchupData.sides.available ? matchupData.sides.reason : null) ??
            'no weekly result is stored for this league yet',
        }

  const resolvedRivalry: LeagueHomeData['rivalry'] = preSeason
    ? { available: false, reason: 'no head-to-head yet \u2014 this league has not drafted' }
    : rivalData?.available
      ? {
          available: true,
          data: rivalData.data.rows.map((r) => ({
            key: r.key,
            name: r.name,
            wins: r.wins,
            losses: r.losses,
            meetings: r.meetings,
            lastResult: r.lastResult,
          })),
        }
      : {
          available: false,
          reason: rivalData?.reason ?? 'no scored weeks are stored for this league yet',
        }

  return {
    stage,
    preSeason,
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
      sport: String(league.sport ?? 'NFL'),
      season: league.season ?? null,
      currentWeek,
    },
    yourTeam,
    weekPicker:
      weekOptions != null && viewWeek != null
        ? {
            weeks: weekOptions,
            selected: viewWeek,
            current: currentWeek,
            isFuture: currentWeek != null && viewWeek > currentWeek,
          }
        : null,
    standings,
    /*
     * The timeline marks "you are here" against a week number. Before a draft there is no
     * meaningful week, and the League.lifecycleState default of in_season is exactly what
     * made an undrafted league render as WEEK 2. Withheld rather than pointed at a week
     * the league has not reached.
     */
    /*
     * ⚠ NO LONGER WITHHELD IN THE PRESEASON, AND NO LONGER INVENTED.
     *
     * The old builder fell back to a hardcoded playoff week 15 and a
     * championship at +2 whenever the league had no playoff start on file, so a
     * league that trades all season, or has no bracket at all, was shown a
     * typical 12-team redraft calendar as if it were its own. It also hid
     * itself entirely before the draft — which is exactly when a manager most
     * wants to see the draft and preseason ahead of them.
     *
     * `buildSeasonTimeline` reads the league's own settings, omits any phase
     * whose setting is absent, and reshapes for leagues with no playoffs.
     */
    timeline: (() => {
      const t = buildSeasonTimeline({
        settings: league.settings,
        currentWeek,
        status: league.status,
        variant: league.leagueType,
        guillotineMode: league.guillotineMode,
      })
      return { available: true as const, data: t.phases }
    })(),
    matchup: resolvedMatchup,
    powerBoard: powerBoard
      ? { available: true, data: powerBoard }
      : {
          available: false,
          reason: 'no week has been scored yet, so there is nothing to rank on',
        },
    scoreboard: board
      ? { available: true, data: board }
      : {
          available: false,
          reason:
            currentWeek == null
              ? 'we cannot tell which week this league is in yet'
              : `no week ${currentWeek} matchups are on file for this league`,
        },
    /*
     * ⚠ THIS REASON WAS STALE. It said "pick inventory and lottery odds are not
     * ingested", which is true of the handoff's LOTTERY ODDS and false of the
     * draft itself: DraftSession and DraftPick are populated and already feed
     * Draft Season HQ on the all-leagues dashboard. Reusing that aggregator for
     * one league rather than writing a second query, so the two surfaces cannot
     * disagree about the same draft.
     */
    draftHq: draftRow
      ? {
          available: true,
          data: {
            href: `/core/draft-hq?league=${league.id}`,
            linkLabel:
              draftRow.phase === 'done'
                ? 'Open the draft board'
                : draftRow.phase === 'live'
                  ? 'Go to the draft room'
                  : 'Open Draft HQ',
            headline:
              draftRow.phase === 'unknown'
                ? draftRow.rawStatus
                : draftRow.phase === 'live'
                  ? 'Draft is live'
                  : draftRow.phase === 'done'
                    ? // The season is the useful half. "Draft complete" on a
                      // dynasty league says nothing about WHICH draft.
                      `${league.season ?? ''} draft has ended`.trim()
                    : 'Draft not started',
            detail: [
              draftRow.teamCount != null ? `${draftRow.teamCount} teams` : null,
              draftRow.rounds != null ? `${draftRow.rounds} rounds` : null,
              draftRow.draftType,
              draftRow.picksMade != null
                ? `${draftRow.picksMade} ${draftRow.picksMade === 1 ? 'pick' : 'picks'} recorded`
                : null,
              // Pick inventory and lottery odds genuinely are not ingested — the
              // part of the old reason that was right, kept.
            ]
              .filter(Boolean)
              .join(' · '),
          },
        }
      : draftedAlready
        ? {
            /*
             * WE DID NOT INGEST A DRAFT OBJECT, BUT THE LEAGUE HAS OBVIOUSLY
             * DRAFTED — there are populated rosters sitting on the same screen.
             * "No draft has been set up" is then a false statement about the
             * league rather than a true one about our data, which is the exact
             * failure the buzz panel had.
             */
            available: true,
            data: {
              headline: `${league.season ?? ''} draft has ended`.trim(),
              detail:
                'Rosters are populated, so this league drafted \u2014 but we did not capture the board itself.',
              href: null,
              linkLabel: null,
            },
          }
        : { available: false, reason: 'no draft on file for this league' },
    /*
     * THE OLD REASON WAS FALSE AND THE PANEL WAS PERMANENTLY BLANK. It claimed
     * commissioner tasks are not ingested for imported leagues. League health
     * and manager activity are both real, both work on imported leagues, and
     * nothing was reading either.
     *
     * This is a PREVIEW, deliberately: the two facts a commissioner would open
     * the app for — is anybody checked out, and who — plus a way through to the
     * full surface. Anything more belongs behind that link.
     */
    commissioner: !viewerIsCommissioner
      ? {
          available: false,
          reason: 'the commissioner hub is visible to this league\u2019s commissioner and co-commissioners',
        }
      : managerHealth && managerHealth.totalManagers > 0
        ? {
            available: true,
            data: {
              inactiveCount: managerHealth.inactiveCount,
              atRiskCount: managerHealth.atRiskCount,
              totalManagers: managerHealth.totalManagers,
              /*
               * Named, not counted. "3 inactive" is a statistic; three names is
               * something a commissioner can act on this afternoon.
               */
              inactiveNames: managerHealth.rows
                .filter((r) => r.status === 'inactive')
                .map((r) => r.teamName || r.managerName)
                .filter(Boolean)
                .slice(0, 4) as string[],
              href: `/league/${league.id}/intelligence`,
            },
          }
        : {
            available: false,
            reason: 'no managers read for this league yet, so there is nothing to report on',
          },
    rivalry: resolvedRivalry,
    /*
     * ⚠ THIS WAS HARD-CODED UNAVAILABLE, AND ITS STATED REASON WAS FALSE:
     * "league transactions are not ingested for this platform yet". They are.
     * The trade-grade sweep resolves both sides of every trade in every
     * imported Sleeper league every 30 minutes and caches the result; this
     * screen simply never looked. The remaining honest gap is narrower and now
     * says so — waivers and roster moves are not read, only completed trades.
     */
    /*
     * ⚠ THE OLD REASON WAS FALSE. It said "waivers and roster moves are not
     * read". They are — `decision_os_imported_activity` carries completed
     * Sleeper waivers, free-agent moves and trades, league-wide, refreshed
     * daily. A panel that blames the data for a query nobody wrote is worse
     * than an empty panel, because it stops anyone looking again.
     *
     * Trades keep their valuations from the grade sweep; waivers and roster
     * moves come from the activity feed. Newest first, both merged.
     */
    buzz: (() => {
      const merged = [...buzzRows, ...activityRows].sort((a, b) => {
        const at = a.at?.getTime() ?? 0
        const bt = b.at?.getTime() ?? 0
        return bt - at
      })
      if (merged.length > 0) return { available: true as const, data: merged.slice(0, 10) }
      return {
        available: false as const,
        reason: preSeason
          ? 'no league activity yet — trades and waivers start after the draft'
          : 'nothing has moved in this league recently — no completed trades, waivers or roster moves on file',
      }
    })(),
    syncAge: { label: age.label, stale: age.stale },
  }
}
