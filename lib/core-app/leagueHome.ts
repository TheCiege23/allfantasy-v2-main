import 'server-only'

import { prisma } from '@/lib/prisma'
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
}

export type SeasonStage = {
  key: string
  label: string
  when: string
  state: 'past' | 'now' | 'future'
}

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
  draftHq: SectionState<{ headline: string; detail: string }>
  commissioner: SectionState<{ openCount: number }>
  buzz: SectionState<Array<{ id: string; actor: string; text: string; at: Date | null }>>
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

/**
 * The season timeline.
 *
 * ⚠ THE DEADLINE AND PLAYOFF STAGES ARE THE LEAGUE'S OWN, NOT A GENERIC NFL
 * CALENDAR. This was previously built from the week number alone, on the stated
 * grounds that those are "league-configured dates we do not store". That is
 * true of the handoff's Offseason and Rookie draft stages and NOT true of the
 * other two: `trade_deadline_week` and `playoff_start_week` are both present in
 * League.settings on production Sleeper leagues. A 12-team league with a Week 11
 * deadline and a 14-team league with a Week 13 deadline are different seasons,
 * and hardcoding 14/15/17 told both of them the same thing.
 *
 * ⚠ OFFSEASON AND ROOKIE DRAFT ARE STILL OMITTED. The handoff draws them with
 * real dates ("AUG 14"). Nothing stores a draft date — DraftSession carries no
 * scheduled time — so those stages would be decoration with a made-up date
 * under them. A shorter true timeline beats a complete invented one.
 */
function buildTimeline(
  currentWeek: number | null,
  settings: unknown,
): SectionState<SeasonStage[]> {
  if (currentWeek == null) {
    return { available: false, reason: 'no current week on file for this league' }
  }

  const playoffStart =
    settingWeek(settings, 'playoff_start_week', 'playoffStartWeek') ??
    settingWeek((settings as Record<string, unknown> | null)?.playoffSettings, 'playoffStartWeek')
  const deadline = settingWeek(settings, 'trade_deadline_week', 'tradeDeadlineWeek')

  // Fall back only where the league told us nothing; each fallback is labelled
  // in `when` so the reader is not shown a guess dressed as a setting.
  const playoffWeek = playoffStart ?? 15
  const finalWeek = playoffWeek + 2
  const configured = playoffStart != null

  const stages: Array<{ key: string; label: string; when: string; startWeek: number; endWeek: number }> = []

  stages.push({
    key: 'regular',
    label: `Weeks 1–${Math.max(1, (deadline ?? playoffWeek) - 1)}`,
    when: 'REGULAR SEASON',
    startWeek: 1,
    endWeek: Math.max(1, (deadline ?? playoffWeek) - 1),
  })

  if (deadline != null) {
    stages.push({
      key: 'deadline',
      label: 'Trade deadline',
      when: `WK ${deadline}`,
      startWeek: deadline,
      endWeek: deadline,
    })
  }

  if ((deadline ?? 0) + 1 <= playoffWeek - 1) {
    stages.push({
      key: 'push',
      label: 'Playoff push',
      when: `WK ${(deadline ?? 0) + 1}–${playoffWeek - 1}`,
      startWeek: (deadline ?? 0) + 1,
      endWeek: playoffWeek - 1,
    })
  }

  stages.push({
    key: 'playoffs',
    label: 'Playoffs',
    when: configured ? `WK ${playoffWeek}–${finalWeek - 1}` : `WK ${playoffWeek}–${finalWeek - 1} · default`,
    startWeek: playoffWeek,
    endWeek: finalWeek - 1,
  })

  stages.push({
    key: 'final',
    label: 'Championship',
    when: configured ? `WK ${finalWeek}` : `WK ${finalWeek} · default`,
    startWeek: finalWeek,
    endWeek: 30,
  })

  return {
    available: true,
    data: stages.map((s) => ({
      key: s.key,
      label: s.label,
      when: s.when,
      state: currentWeek > s.endWeek ? 'past' : currentWeek >= s.startWeek ? 'now' : 'future',
    })),
  }
}

export async function getLeagueHomeData(
  leagueId: string,
  userId: string
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
    },
    orderBy: [{ currentRank: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }],
  })

  const yours = teams.find((t) => t.claimedByUserId === userId) ?? null

  // A league whose teams all sit at 0-0 has been imported but never had results
  // read. Showing that as a standings table would present "everyone is 0-0" as a
  // finding rather than as an absence.
  const anyResults = teams.some((t) => t.wins > 0 || t.losses > 0 || t.ties > 0 || t.pointsFor > 0)

  const standings: SectionState<LeagueStanding[]> =
    teams.length === 0
      ? { available: false, reason: 'no teams imported for this league' }
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
  const nextGame = await prisma.sportsGame
    .findFirst({
      where: {
        sport: String(league.sport ?? 'NFL'),
        ...(league.season != null ? { season: league.season } : {}),
        startTime: { gte: new Date() },
        week: { not: null },
      },
      orderBy: { startTime: 'asc' },
      select: { week: true },
    })
    .catch(() => null)

  const currentWeek = nextGame?.week ?? null

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
    standings,
    /*
     * The timeline marks "you are here" against a week number. Before a draft there is no
     * meaningful week, and the League.lifecycleState default of in_season is exactly what
     * made an undrafted league render as WEEK 2. Withheld rather than pointed at a week
     * the league has not reached.
     */
    timeline: preSeason
      ? { available: false, reason: 'the season timeline starts once this league drafts' }
      : buildTimeline(currentWeek, league.settings),
    matchup: resolvedMatchup,
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
            headline:
              draftRow.phase === 'unknown'
                ? draftRow.rawStatus
                : draftRow.phase === 'live'
                  ? 'Draft is live'
                  : draftRow.phase === 'done'
                    ? 'Draft complete'
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
      : { available: false, reason: 'no draft has been set up for this league' },
    commissioner: { available: false, reason: 'votes and commissioner tasks are not ingested for imported leagues' },
    rivalry: resolvedRivalry,
    buzz: preSeason
      ? { available: false, reason: 'no league activity yet — trades and waivers start after the draft' }
      : { available: false, reason: 'league transactions are not ingested for this platform yet' },
    syncAge: { label: age.label, stale: age.stale },
  }
}
