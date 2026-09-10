import 'server-only'

import { prisma } from '@/lib/prisma'
import { createPsychologyOsLoaders } from '@/lib/decision-os/psychology-os'
import type { PsychologyProfileFact } from '@/lib/decision-os/psychology-os'
import { resolveProfileAccessForUser } from '@/lib/psychological-profiles/ProfileAccess'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { leagueDisplayName, type SectionState } from './leagueHome'

/**
 * Scout — the first room of the War Room.
 *
 * "A place users could go to scout out the competition." Every manager in the
 * league, with league competition and coverage — and your next opponent pinned to
 * the top of it.
 *
 * 🛑 IT NO LONGER RENDERS WHAT THEIR BEHAVIOUR SAYS ABOUT THEM, and that sentence
 * used to be this file's opening promise. See the entitlement section below: raw
 * characterisation is now withheld from every viewer, so the header states what
 * the screen shows rather than what it once did.
 *
 * ── 🛑 THIS READS THE DECISION OS SEAM, IT DOES NOT REIMPLEMENT IT ──────────
 *
 * `lib/psychological-profiles/` is a 16-module engine across seven sports with a
 * 15-label vocabulary, an evidence floor and a scheduled writer. `psychology-os`
 * is the Decision OS feed over it — cached at a 12h TTL, gated scores only,
 * trajectory batched into one query for the whole league. Both already existed
 * and neither had a user-facing reader.
 *
 * So this file is a JOIN, not a derivation: profiles from the feed, names from
 * `LeagueTeam`, opponent from the week's schedule. Nothing here recomputes a
 * score, re-derives the evidence floor, or invents a label. This repo has paid
 * more than once for two implementations of one rule — see the SQL-normalizer
 * note in CLAUDE.md, which disagreed with its JS original on 7.2% of rows.
 *
 * ── ⚠ COVERAGE IS A FIRST-CLASS OUTPUT, NOT A FOOTNOTE ──────────────────────
 *
 * `profiledCount` / `teamCount` / `lastRefreshedAt` are returned ALWAYS, and the
 * screen states them. The most expensive recurring bug in this codebase is a
 * surface pointed at a table nothing fills — `ingestCFBDStats` had no scheduled
 * caller for months and `/api/market-alerts` looked correct the whole time. A
 * Scout that silently renders three profiles for a twelve-team league is that
 * bug wearing a new hat, so the denominator is on the screen.
 *
 * ⚠ AND AN UNPROFILED MANAGER IS LISTED, NOT DROPPED. Omitting them would make
 * the roster of rivals look shorter than the league is, which is the same class
 * of lie as dropping an unnamed draft pick from the board.
 *
 * ── 🛑 THE MEMBERSHIP GATE IS NOT OPTIONAL, AND THIS FILE SHIPPED WITHOUT IT ──
 *
 * `ProfileAccess.ts` is the one place that decides, and it exists because all five
 * psych API routes were once completely unauthenticated — any caller could read a
 * character read on any named manager in any league just by knowing a league id.
 *
 * The first version of this loader read `psychology-os` directly and handed back
 * every manager's labels, scores and trajectory to every caller. That is the same
 * hole, reopened from a new direction, and neither a typecheck nor a test would
 * have shown it. So `resolveProfileAccessForUser` still decides MEMBERSHIP — a
 * non-member gets nothing, because this loader takes a league id from the URL and
 * must not assume the page gated it.
 *
 * ── 🛑 AND ENTITLEMENT NO LONGER OPENS THE CHARACTERISATION AT ALL ────────────
 *
 * This section used to read "manager psychology is asymmetric by design: YOUR OWN
 * profile is a mirror and is free; anyone else's is competitive intelligence about
 * a real person and is sold on Pro, War Room and Supreme." That was the rule, and
 * Milestone 32 replaces it: raw behavioural profiles are unavailable through every
 * public API path, and a paid plan is not an exception to that. An entitlement
 * decides who PAYS; it does not decide what counts as a raw dossier.
 *
 * ⚠ SO THE LOCKED STATE IS NOW UNCONDITIONAL, not a plan boundary. Every card with
 * a profile behind it reports the same thing: the profile EXISTS, how much was
 * observed, and nothing else. That is still `redactForLock`'s split — coverage
 * crosses, characterisation does not — applied to everyone rather than to
 * non-payers. Your own profile is withheld too, which is the part that changed.
 *
 * ⚠ THE DECISION IS STILL IMPORTED, NOT REIMPLEMENTED. Re-deriving "may this viewer
 * see opponents" from plan names would be a second gate that drifts from the first,
 * which is how five routes came to be ungated — so the entitlement fields are left
 * unread here rather than reinterpreted.
 */

/** One manager's psychological read, in the shape the screen renders. */
export type ScoutProfile = {
  labels: string[]
  scores: PsychologyProfileFact['scores']
  evidenceCount: number
  /** Named, so the screen can say WHICH read is missing rather than hedging all of them. */
  unmeasuredDimensions: string[]
  /** True when at least one dimension clears its floor — i.e. anything may be asserted at all. */
  anySufficient: boolean
  /** How their recorded seasons have moved, or an honest refusal. Never invented. */
  trajectory: PsychologyProfileFact['trajectory']
  updatedAt: string
}

/**
 * Three states, and they are three because the alternatives are all lies.
 *
 * ⚠ "NOT PROFILED YET", "PROFILED BUT NOTHING CLEARS THE FLOOR" and "PROFILED,
 * BUT YOUR PLAN CANNOT SEE IT" are different facts. The first is our gap; the
 * second is a measured answer about a manager who has not done enough for us to
 * say anything; the third is a sales boundary. Flattening the first two turns our
 * missing data into a claim about a person, and flattening the third into either
 * of them tells a paying-eligible user their league is unprofiled when it is not.
 */
export type ScoutProfileState =
  | { available: true; data: ScoutProfile }
  /**
   * Locked. Mirrors `redactForLock`: the profile EXISTS and this says how much was
   * observed, but names no label, no score and no trajectory.
   */
  | { available: false; locked: true; evidenceCount: number; reason: string }
  | { available: false; locked: false; reason: string }

export type ScoutedManager = {
  /** `LeagueTeam.externalId || LeagueTeam.id` — the key the profile writer uses. */
  managerId: string
  teamName: string
  ownerName: string | null
  avatarUrl: string | null
  isYou: boolean
  /** True for the manager you play this week, when the schedule names one. */
  isNextOpponent: boolean
  record: { wins: number; losses: number; ties: number } | null
  profile: ScoutProfileState
}

export type ScoutData = {
  league: { id: string; name: string; sport: string }
  /** Who you are in this league, when a team is claimed. */
  you: { managerId: string; teamName: string } | null
  /** This week, when the league's schedule carries one. */
  week: { seasonYear: number; week: number } | null
  managers: SectionState<ScoutedManager[]>
  coverage: {
    teamCount: number
    profiledCount: number
    /** Newest profile write across the league. Null when nothing is profiled. */
    lastRefreshedAt: string | null
    /**
     * How many profiled managers this viewer's plan cannot read.
     *
     * ⚠ COUNTED SEPARATELY FROM `profiledCount`, so the screen can say "9 of 12
     * profiled, 8 locked" rather than folding the locked ones into the gap. A
     * paywall reported as missing data is a bug report waiting to happen, and it
     * makes the profiler look broken when it is working.
     */
    lockedCount: number
  }
}

/**
 * How much was observed about a manager, whether or not this viewer may read it.
 *
 * ⚠ A LOCKED PROFILE STILL COUNTS, and that leaks nothing: `redactForLock` shows
 * the evidence summary on purpose. Treating locked as unprofiled would sort every
 * paywalled manager to the bottom, which is a different order for a free account
 * than a paid one and makes the screen look emptier than the league is.
 */
function evidenceOf(p: ScoutedManager['profile']): number {
  if (p.available) return p.data.evidenceCount
  return p.locked ? p.evidenceCount : -1
}

/** Sort: your next opponent, then everyone else best-evidenced first, then you. */
function scoutOrder(a: ScoutedManager, b: ScoutedManager): number {
  if (a.isNextOpponent !== b.isNextOpponent) return a.isNextOpponent ? -1 : 1
  if (a.isYou !== b.isYou) return a.isYou ? 1 : -1
  const ae = evidenceOf(a.profile)
  const be = evidenceOf(b.profile)
  if (ae !== be) return be - ae
  return a.teamName.localeCompare(b.teamName)
}

export async function getScoutData(leagueId: string, userId: string): Promise<ScoutData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, platformLeagueId: true },
  })
  if (!league) return null

  const sport = String(league.sport ?? 'NFL')
  const base = {
    league: { id: league.id, name: leagueDisplayName(league.name), sport },
  }

  /*
   * 🛑 MEMBERSHIP AND ENTITLEMENT, BEFORE ANY PROFILE IS READ. See the header.
   * `leagueId` arrives from the URL and this loader must not assume the page
   * gated it — `resolveProfileAccessForUser` runs `resolveLeagueMembership`,
   * which is the same predicate the psych API routes enforce.
   */
  const access = await resolveProfileAccessForUser(leagueId, userId).catch(() => null)
  if (!access || !access.ok) {
    return {
      ...base,
      you: null,
      week: null,
      managers: {
        available: false,
        reason:
          'scouting reads the managers of a league you are in, and this account is not a member of this one',
      },
      coverage: { teamCount: 0, profiledCount: 0, lastRefreshedAt: null, lockedCount: 0 },
    }
  }

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId },
      select: {
        id: true,
        externalId: true,
        ownerName: true,
        teamName: true,
        avatarUrl: true,
        wins: true,
        losses: true,
        ties: true,
        claimedByUserId: true,
      },
    })
    .catch(() => [])

  if (teams.length === 0) {
    return {
      ...base,
      you: null,
      week: null,
      managers: {
        available: false,
        reason: 'no teams have been imported for this league, so there is nobody to scout',
      },
      coverage: { teamCount: 0, profiledCount: 0, lastRefreshedAt: null, lockedCount: 0 },
    }
  }

  /*
   * ⚠ `externalId || id`, WHICH IS EXACTLY WHAT THE PROFILE WRITER USES.
   * `ProfileRefreshService` keys each profile on `team.externalId || team.id`, so
   * matching on `externalId` alone silently loses every team whose platform
   * roster id was never populated — a native AllFantasy league, most obviously.
   */
  const managerIdOf = (t: { externalId: string; id: string }) => t.externalId || t.id

  const mine = teams.find((t) => t.claimedByUserId === userId) ?? null
  const myManagerId = mine ? managerIdOf(mine) : null

  /*
   * This week's opponent.
   *
   * ⚠ `WeeklyMatchup.leagueId` IS `League.platformLeagueId`, NOT `League.id`.
   * They are different id spaces and the mistake is silent — the query simply
   * returns nothing, which reads as "no game this week" for every league in the
   * product. `nextMatchup.ts` carries the same warning on its own arguments.
   */
  const week = league.platformLeagueId
    ? await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null)
    : null

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
        const oppTeam = teams.find((t) => t.externalId === other.rosterId)
        if (oppTeam) opponentManagerId = managerIdOf(oppTeam)
      }
    }
  }

  /*
   * The profiles, through the Decision OS feed rather than the engine directly —
   * so this read shares the 12h cache with every other Decision OS consumer
   * instead of opening a second, uncoordinated path to the same rows.
   *
   * Null means the league has no profiles at all. That is NOT the same as an
   * empty league and is reported as our gap, not as a fact about the managers.
   */
  const { loadProfiles } = createPsychologyOsLoaders()
  const facts = await loadProfiles({ leagueId, sport }).catch(() => null)
  const byManager = new Map((facts ?? []).map((f) => [f.managerId, f]))

  const managers: ScoutedManager[] = teams.map((t) => {
    const managerId = managerIdOf(t)
    const fact = byManager.get(managerId)

    /*
     * 🛑 THE ENTITLEMENT BRANCH IS GONE, AND ITS ABSENCE IS THE POINT. Scout used to
     * ask `isSelf || access.canSeeOpponents` and serve the full characterisation —
     * labels, the five scores, trajectory — to whoever cleared it. Milestone 32 says
     * raw behavioural profiles are unavailable through every public API path, and an
     * entitlement is not an exception to that; it decides who PAYS, not what a raw
     * dossier is. So no caller reaches the characterisation here, the manager
     * themselves included.
     *
     * ⚠ THE MEMBERSHIP GATE ABOVE IS UNTOUCHED. Closing a data leak must not quietly
     * relax a check that was already correct — `access.ok` still refuses a non-member
     * outright, which is the hole all five psych routes once had.
     *
     * ⚠ AND COVERAGE SURVIVES WHERE CHARACTERISATION DOES NOT — the same split
     * `redactForLock` makes. "44 observations" says nothing about the person; a label
     * says everything. So `evidenceCount` still crosses and nothing else does.
     */
    const profile: ScoutProfileState = !fact
      ? {
          available: false,
          locked: false,
          reason:
            facts === null
              ? 'no manager has been profiled in this league yet — the profiler runs on a schedule and has not covered it'
              : 'this manager has no profile yet, though others in the league do',
        }
      : {
          available: false,
          locked: true,
          evidenceCount: fact.evidenceCount,
          reason: 'Open a trade, draft or waiver decision for Competitive Edge guidance.',
        }

    return {
      managerId,
      teamName: t.teamName?.trim() || t.ownerName?.trim() || 'Unnamed team',
      ownerName: t.ownerName?.trim() || null,
      avatarUrl: t.avatarUrl ?? null,
      isYou: managerId === myManagerId,
      isNextOpponent: opponentManagerId != null && managerId === opponentManagerId,
      /*
       * ⚠ A 0-0-0 RECORD IS SUPPRESSED, NOT SHOWN. `LeagueTeam` defaults every
       * one of these columns to 0, so a league whose standings were never synced
       * reports twelve managers at 0-0 — which reads as "nobody has played" and
       * is indistinguishable from a genuine preseason.
       */
      record:
        t.wins || t.losses || t.ties
          ? { wins: t.wins, losses: t.losses, ties: t.ties }
          : null,
      profile,
    }
  })

  managers.sort(scoutOrder)

  /*
   * ⚠ PROFILED COUNTS THE LOCKED ONES TOO. The question this line answers is "has
   * the profiler covered this league", which is about our data and not about the
   * viewer's plan. Reporting "1 of 12 profiled" to a free account whose league is
   * fully covered would be a false claim about the product's state — and the
   * cheapest possible way to make a working system look broken.
   */
  const profiledCount = managers.filter((m) => m.profile.available || m.profile.locked).length
  const lockedCount = managers.filter((m) => !m.profile.available && m.profile.locked).length
  const lastRefreshedAt =
    (facts ?? []).reduce<string | null>(
      (newest, f) => (newest == null || f.updatedAt > newest ? f.updatedAt : newest),
      null,
    ) ?? null

  return {
    ...base,
    you: mine && myManagerId ? { managerId: myManagerId, teamName: mine.teamName } : null,
    week: week ? { seasonYear: week.seasonYear, week: week.week } : null,
    managers: { available: true, data: managers },
    coverage: { teamCount: teams.length, profiledCount, lastRefreshedAt, lockedCount },
  }
}
