import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { deriveAvailabilityCategory } from '@/lib/decision-os/world/injuryEnrichedWorld'
import { REDRAFT_WINDOW_COEFFICIENTS } from './window'
import { resolveWindowDecision, unresolvableWindowDecision, type WindowDecision } from './windowDecision'
import type { RestOfSeasonStrength, WindowFactsScope } from './windowFacts'
import { createWindowFactsPrismaPort, WindowPortReadError } from './windowFactsPrismaPort'

/**
 * Resolve the REQUESTING team's competitive window for a redraft trade preview.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────────────────────────
 * `resolveWindowDecision` is pure and takes a scope; the Prisma port is the database seam.
 * Neither knows how a redraft request identifies a team, and neither should. This adapter is the
 * one place that answers that question, for one endpoint, and it is READ-ONLY.
 *
 * ── 🛑 THE IDENTITY PROBLEM, WHICH IS THE WHOLE JOB ───────────────────────────────────────────
 * The caller arrives holding a `RedraftRoster.id`. The port wants `LeagueTeam.externalId`. Those
 * are DIFFERENT ID SPACES, so the mapping is made explicitly here or refused. Measured facts:
 *
 *   `Roster.redraftRosterId`                                 2,721/3,222 (84.5%)  partial
 *   `LeagueTeam.legacyRosterId`                              0 of 174 populated   UNUSABLE
 *   `LeagueTeam.claimedByUserId -> platformUserId -> Roster` 0 of 13              UNUSABLE
 *   `LeagueTeam.claimedByUserId === <AF user id>`            what lib/league-access.ts gates on
 *
 * The last is used, and is sound only because the route has ALREADY proved
 * `proposer.ownerId === session.user.id`.
 *
 * ⚠ EXACTLY ONE, OR REFUSE. Two claimed teams is ambiguous and is NOT resolved by taking the
 * first row. ⚠ NEVER INFER THE TEAM FROM ASSET ORDER — the assets are attacker-controlled.
 *
 * ── 🛑 `isOrphan` IS NOT AN ARCHIVE FLAG, AND TREATING IT AS ONE WAS WRONG ─────────────────────
 * An earlier revision refused a claimed team whose `isOrphan` was true, calling it "archived".
 * That was wrong twice over. `isOrphan` means a VACANT SEAT — `lib/decision-os/league-pulse.ts`
 * computes it as `isOrphan || (!claimedByUserId && !platformUserId)` — and it is a THREE-STATE
 * column (`true`, `false`, or NULL for rows the importer never decided about), which
 * `lib/commissioner-workspace/rosterReads.ts` records after counting `is true` rather than
 * truthiness across 288 leagues.
 *
 * ⚠ AND NO ARCHIVAL STATE EXISTS ON `LeagueTeam` AT ALL — no `archived`, `departed`, `deleted` or
 * `status` column. "This team is archived" is not a fact this schema can express, so asserting it
 * from `isOrphan` invented a state in order to justify a refusal. Four states a caller might care
 * about — active human-managed, active vacant, eliminated, and truly archived — are NOT currently
 * distinguishable, which is why the Platform Import state-model correction owns this and not us.
 *
 * What is done instead: a claim is treated as proof a human holds the seat, so archival status is
 * not required and is not consulted. The ONE case that still refuses is the CONTRADICTION — a row
 * claimed by this user AND flagged vacant — because that is data disagreeing with itself, and
 * `window_team_archival_state_unprovable` says exactly that rather than picking a reading.
 *
 * ── 🛑 FAILURE PROVENANCE: A FAILED QUERY IS NOT AN EMPTY RESULT ──────────────────────────────
 * Every read below is wrapped so a thrown query returns a STAGE-SPECIFIC gap. The previous
 * revision used `.catch(() => null)` and `.catch(() => [])` throughout, conflating "the database
 * refused" with "there is nothing there" — and in one place that was actively dangerous: a failed
 * SCHEDULE read produced an empty array, the empty array was passed as "no schedule", and the
 * resolver took its arithmetic fallback and reported
 * `schedule_unavailable_lookback_assumed_contiguous`. A database outage came out of the far end
 * as a confident statement about a league's calendar. That fallback is now reachable ONLY from a
 * query that SUCCEEDED and returned no rows.
 */

export const WINDOW_GAP_LEAGUE_READ_FAILED = 'window_league_read_failed'
export const WINDOW_GAP_LEAGUE_MISSING = 'window_league_not_found'
export const WINDOW_GAP_TEAM_READ_FAILED = 'window_team_identity_read_failed'
export const WINDOW_GAP_TEAM_NOT_CLAIMED = 'window_team_not_claimed'
export const WINDOW_GAP_TEAM_AMBIGUOUS = 'window_team_ambiguous'
export const WINDOW_GAP_TEAM_ID_MISSING = 'window_team_external_id_missing'
export const WINDOW_GAP_ARCHIVAL_UNPROVABLE = 'window_team_archival_state_unprovable'
export const WINDOW_GAP_SCHEDULE_READ_FAILED = 'window_schedule_read_failed'
export const WINDOW_GAP_ROSTER_READ_FAILED = 'window_roster_read_failed'
export const WINDOW_GAP_PERIOD_UNRESOLVED = 'window_scheduled_period_unresolved'
export const WINDOW_GAP_PROJECTION_READ_FAILED = 'window_projection_read_failed'
export const WINDOW_GAP_MATCHUP_READ_FAILED = 'window_matchup_read_failed'
export const WINDOW_GAP_FORECAST_READ_FAILED = 'window_forecast_read_failed'
export const WINDOW_GAP_INJURY_READ_FAILED = 'window_injury_read_failed'
/** Only for a throw the port could not attribute to a stage of its own. */
export const WINDOW_GAP_EVIDENCE_READ_FAILED = 'window_evidence_read_failed'

/**
 * The port names the stage it failed at; this turns that into the caller-facing gap.
 *
 * ⚠ THE FALLBACK IS DELIBERATELY LAST AND DELIBERATELY BROAD. An unrecognised throw is reported
 * as a generic evidence failure rather than being mapped to whichever stage seems likeliest —
 * naming the wrong read is worse than admitting the read is unknown.
 */
function gapForPortError(e: unknown): string {
  if (!(e instanceof WindowPortReadError)) return WINDOW_GAP_EVIDENCE_READ_FAILED
  switch (e.stage) {
    case 'identity': return WINDOW_GAP_TEAM_READ_FAILED
    case 'matchup': return WINDOW_GAP_MATCHUP_READ_FAILED
    case 'forecast': return WINDOW_GAP_FORECAST_READ_FAILED
    case 'dynasty': return WINDOW_GAP_PROJECTION_READ_FAILED
    case 'injury': return WINDOW_GAP_INJURY_READ_FAILED
    default: return WINDOW_GAP_EVIDENCE_READ_FAILED
  }
}

export interface RedraftWindowRequest {
  prisma: PrismaClient
  /** AllFantasy `League.id`, already proved to contain the caller by the route's membership gate. */
  leagueId: string
  /** The authenticated caller. The route has already proved they own `proposerRosterId`. */
  userId: string
  /** `RedraftRoster.id`, already proved to belong to this league and season AND to this caller. */
  proposerRosterId: string
  /** `RedraftSeason.id`, so league-relative rest-of-season strength has a denominator. */
  seasonId: string
  sport: string
  season: number
  /** The league's current scoring period. */
  week: number
  now?: Date
}

/**
 * A read that distinguishes failure from absence.
 *
 * ⚠ THE WHOLE POINT IS THE THIRD STATE. `T | null` has room for "value" and "no value" and none
 * for "we could not tell" — which is exactly why `.catch(() => null)` reads so naturally and is
 * wrong. Every stage below returns one of these rather than collapsing into the other two.
 */
type StageRead<T> = { ok: true; value: T } | { ok: false; gap: string }

async function stage<T>(gap: string, run: () => Promise<T>): Promise<StageRead<T>> {
  try {
    return { ok: true, value: await run() }
  } catch {
    return { ok: false, gap }
  }
}

/**
 * Availability for the F2.3 injury read.
 *
 * ⚠ FILTERED BY SPORT: `SportsPlayer`'s key is `@@unique([sport, externalId, source])`, so an
 * unfiltered `externalId` lookup can pull another sport's player and report them injured.
 * ⚠ Rows for one player that DISAGREE resolve to 'unknown' rather than picking a winner — the
 * port counts 'unknown' as unresolved and refuses below 50% coverage, and choosing the worst
 * status would bias every league toward rebuilding.
 * ⚠ A THROWN QUERY IS ALLOWED TO PROPAGATE rather than returning an empty map: an empty map is
 * indistinguishable from a fully-uncovered roster, which refuses for the wrong stated reason.
 */
function availabilityLoader(prisma: PrismaClient) {
  return async (sport: string, ids: string[]): Promise<Map<string, string>> => {
    const out = new Map<string, string>()
    if (ids.length === 0) return out
    const rows = await prisma.sportsPlayer.findMany({
      where: { sport, externalId: { in: ids } },
      select: { externalId: true, status: true },
    })
    const seen = new Map<string, string>()
    for (const row of rows) {
      const category = deriveAvailabilityCategory(row.status)
      const prior = seen.get(row.externalId)
      if (prior === undefined) seen.set(row.externalId, category)
      else if (prior !== category) seen.set(row.externalId, 'unknown')
    }
    for (const [id, category] of seen) out.set(id, category)
    return out
  }
}

/**
 * League-relative rest-of-season strength for the proposer's roster.
 *
 * 🛑 THE SOURCE IS `AFProjectionSnapshot.rosProjection`, AND ITS NULL MEANS "NOT COMPUTED".
 * The column's own schema comment says readers must fall back and never treat it as zero. Summing
 * a roster whose projections are half-missing produces a plausible small number, and a plausible
 * small number classifies a contender as rebuilding — so a player without a projection counts as
 * UNCOVERED, never as zero points, and the assembler refuses below 50% coverage.
 *
 * ⚠ THE SHARE IS LEAGUE-RELATIVE BECAUSE PROJECTED POINTS HAVE NO ABSOLUTE SCALE. 1,400 points is
 * strong in one league and average in another. The denominator is every roster in THIS season, so
 * the figure means "this share of what is left to be scored", with `1 / teamsCovered` as average.
 */
function restOfSeasonLoader(
  prisma: PrismaClient,
  seasonId: string,
  proposerRosterId: string,
  season: number,
) {
  return async (_scope: WindowFactsScope): Promise<RestOfSeasonStrength | null> => {
    /*
     * ⚠ `droppedAt: null` — CURRENT ROSTERS, NOT EVERY PLAYER EVER ROSTERED. `RedraftRosterPlayer`
     * RETAINS dropped rows, so without this the share sums a season-to-date union: a team that
     * dropped a strong early-season player keeps his projected points, and every team's total is
     * inflated by its own waiver churn. The distortion lands on both the numerator and the
     * denominator, so it does not cancel — and it moves `futureBase` across the 0.62/0.38
     * thresholds, which is a contender relabelled as rebuilding. 63 other reads in this repo
     * filter it; these two were the exception.
     */
    const rosterRows = await prisma.redraftRosterPlayer.findMany({
      where: { roster: { seasonId }, droppedAt: null },
      select: { rosterId: true, playerId: true },
    })
    if (rosterRows.length === 0) return null

    const playerIds = [...new Set(rosterRows.map(r => r.playerId).filter((p): p is string => !!p))]
    if (playerIds.length === 0) return null

    /*
     * ⚠ UNBOUNDED WITHOUT `distinct`. This model accumulates a row per player per recompute, so by
     * late season an unfiltered fetch of every rostered player's history is tens of thousands of
     * rows on a route that re-prices as a manager clicks. `distinct` + a playerId-major `orderBy`
     * is DISTINCT ON semantics: newest row per player.
     *
     * The JS dedupe below STAYS, and not as belt-and-braces theatre — Prisma's `distinct` is not
     * guaranteed to push down to SQL on every connector/version, and if it resolves in memory the
     * loop is what still guarantees newest-per-player. Correctness does not depend on which.
     */
    const projections = await prisma.aFProjectionSnapshot.findMany({
      where: { playerId: { in: playerIds }, season },
      select: { playerId: true, rosProjection: true, rosWeeksRemaining: true, computedAt: true },
      orderBy: [{ playerId: 'asc' }, { computedAt: 'desc' }],
      distinct: ['playerId'],
    })

    /* Newest computed row per player wins; the `desc` order makes the first seen the newest. */
    const byPlayer = new Map<string, { ros: number; weeks: number | null; at: Date }>()
    for (const p of projections) {
      if (byPlayer.has(p.playerId)) continue
      // NULL means NOT COMPUTED. Skipping leaves the player UNCOVERED rather than scoring them 0.
      if (typeof p.rosProjection !== 'number' || !Number.isFinite(p.rosProjection)) continue
      byPlayer.set(p.playerId, { ros: p.rosProjection, weeks: p.rosWeeksRemaining ?? null, at: p.computedAt })
    }
    if (byPlayer.size === 0) return null

    const totals = new Map<string, number>()
    let mineSize = 0
    let mineCovered = 0
    let newest: Date | null = null
    let weeks: number | null = null

    for (const row of rosterRows) {
      const isMine = row.rosterId === proposerRosterId
      if (isMine) mineSize += 1
      const hit = row.playerId ? byPlayer.get(row.playerId) : undefined
      if (!hit) continue
      if (isMine) mineCovered += 1
      totals.set(row.rosterId, (totals.get(row.rosterId) ?? 0) + hit.ros)
      if (!newest || hit.at > newest) {
        newest = hit.at
        weeks = hit.weeks
      }
    }

    const leagueTotal = [...totals.values()].reduce((s, v) => s + v, 0)
    const mineTotal = totals.get(proposerRosterId) ?? 0
    if (leagueTotal <= 0) return null

    return {
      share: mineTotal / leagueTotal,
      playersCovered: mineCovered,
      rosterSize: mineSize,
      teamsCovered: totals.size,
      weeksRemaining: weeks,
      source: 'AFProjectionSnapshot.rosProjection',
      generatedAt: newest ? newest.toISOString() : null,
    }
  }
}

/**
 * The canonical team for this request, or a named reason there is not one.
 *
 * Split out so the identity rules are testable without a window, a schedule or an injury feed.
 */
export async function resolveRequestingTeam(
  prisma: PrismaClient,
  leagueId: string,
  userId: string,
): Promise<{ ok: true; externalId: string } | { ok: false; gap: string }> {
  const read = await stage(WINDOW_GAP_TEAM_READ_FAILED, () =>
    prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: userId },
      select: { externalId: true, isOrphan: true },
      // Two is enough to prove ambiguity; there is no reason to read a whole league.
      take: 2,
    }),
  )
  if (!read.ok) return { ok: false, gap: read.gap }

  const teams = read.value
  if (teams.length === 0) return { ok: false, gap: WINDOW_GAP_TEAM_NOT_CLAIMED }
  if (teams.length > 1) return { ok: false, gap: WINDOW_GAP_TEAM_AMBIGUOUS }

  const team = teams[0]
  /*
   * ⚠ THE CLAIM IS THE EVIDENCE, NOT `isOrphan`. A row this user has claimed AND flagged vacant is
   * data contradicting itself; no reading of it is safe to pick, so it refuses by name.
   * `isOrphan === false` and `isOrphan === null` both proceed — NULL means the importer never
   * decided, which is not a statement that the seat is empty.
   */
  if (team.isOrphan === true) return { ok: false, gap: WINDOW_GAP_ARCHIVAL_UNPROVABLE }

  const externalId = typeof team.externalId === 'string' ? team.externalId.trim() : ''
  if (!externalId) return { ok: false, gap: WINDOW_GAP_TEAM_ID_MISSING }
  return { ok: true, externalId }
}

export async function resolveRedraftTeamWindow(req: RedraftWindowRequest): Promise<WindowDecision> {
  const { prisma, leagueId, userId, sport, season, week, seasonId, proposerRosterId } = req
  const now = req.now ?? new Date()
  /*
   * The scope echoed on a refusal. `teamId` is deliberately ABSENT until identity resolves, so it
   * echoes as null — the proposer roster id is a DIFFERENT namespace, and putting it here would be
   * the exact conflation this adapter exists to prevent.
   */
  const partialScope = { leagueId, season, week }
  /*
   * 🛑 THE COEFFICIENT SET IS PASSED, AND OMITTING IT SILENTLY UNDID THIS BATCH'S OWN FIX.
   * `unresolvableWindowDecision` defaults to `DEFAULT_WINDOW_COEFFICIENTS`, whose horizon is
   * 'dynasty', and `refusedDecision` writes `evidence.format` FROM the coefficients it was given.
   * So every adapter-level refusal in the redraft flow — period, league, identity, schedule,
   * roster — reported `format: 'dynasty'`: the exact field added in this commit to tell a reader
   * which horizon a league was judged over, answering wrong for every redraft refusal. Verified
   * before the fix: a missing-league refusal came back `evidence.format=dynasty
   * coefficients.version=window-structural-dynasty-1`.
   */
  const refuse = (gap: string) =>
    unresolvableWindowDecision(partialScope, [gap], { now, coefficients: REDRAFT_WINDOW_COEFFICIENTS })

  if (!Number.isSafeInteger(week) || week < 1) return refuse(WINDOW_GAP_PERIOD_UNRESOLVED)

  const leagueRead = await stage(WINDOW_GAP_LEAGUE_READ_FAILED, () =>
    prisma.league.findUnique({ where: { id: leagueId }, select: { platformLeagueId: true } }),
  )
  if (!leagueRead.ok) return refuse(leagueRead.gap)
  if (!leagueRead.value) return refuse(WINDOW_GAP_LEAGUE_MISSING)

  const team = await resolveRequestingTeam(prisma, leagueId, userId)
  if (!team.ok) return refuse(team.gap)

  /*
   * 🛑 A FAILED SCHEDULE READ MUST NOT BECOME "NO SCHEDULE". An EMPTY array here means the query
   * SUCCEEDED and found no rows, which legitimately selects the arithmetic fallback and its
   * `schedule_unavailable_lookback_assumed_contiguous` gap. A THROWN query refuses instead and
   * never reaches the resolver at all.
   */
  const scheduleRead = await stage(WINDOW_GAP_SCHEDULE_READ_FAILED, () =>
    prisma.redraftMatchup.findMany({
      where: { seasonId }, select: { week: true }, distinct: ['week'], orderBy: { week: 'asc' },
    }),
  )
  if (!scheduleRead.ok) return refuse(scheduleRead.gap)
  const scheduledPeriods = scheduleRead.value
    .map(r => r.week)
    .filter(w => Number.isSafeInteger(w) && w >= 1)

  const rosterRead = await stage(WINDOW_GAP_ROSTER_READ_FAILED, () =>
    // Same reason as the league-wide read: a dropped player is not on this roster, and counting
    // him drags injury COVERAGE and the unavailable SHARE toward whoever churned most.
    prisma.redraftRosterPlayer.findMany({
      where: { rosterId: proposerRosterId, droppedAt: null }, select: { playerId: true },
    }),
  )
  if (!rosterRead.ok) return refuse(rosterRead.gap)
  const rosterPlayerIds = [...new Set(
    rosterRead.value.map(r => (typeof r.playerId === 'string' ? r.playerId.trim() : '')).filter(Boolean),
  )]

  /*
   * 🛑 COMPUTED ONCE PER REQUEST, NOT ONCE PER LOOKBACK WEEK. `resolveWindowDecision` assembles
   * facts for each of WINDOW_PERSISTENCE_WEEKS weeks, and every redraft assembly calls
   * `port.restOfSeason`. Because the loader ignores the week entirely — the rest of the season is
   * the same quantity whichever prior week is being reconstructed — that fired the league-wide
   * roster read and the whole-league projection scan THREE TIMES for byte-identical data.
   * Measured before this change: `rosterPlayer:LEAGUE-WIDE` 3, `aFProjectionSnapshot` 3.
   *
   * ⚠ AND HOISTING IT BUYS SOMETHING BESIDES COST: the projection read now has its OWN failure
   * stage. Inside the assembler it ran within a `Promise.all` alongside matchups, forecast and
   * injuries, so a throw could only be reported as the broad `window_evidence_read_failed`. Out
   * here it is attributable, which is what a stage-specific projection failure was asked for.
   */
  const rosRead = await stage(WINDOW_GAP_PROJECTION_READ_FAILED, () =>
    restOfSeasonLoader(prisma, seasonId, proposerRosterId, season)({ leagueId, teamId: team.externalId, season, week }),
  )
  if (!rosRead.ok) return refuse(rosRead.gap)
  const restOfSeason = rosRead.value

  const port = createWindowFactsPrismaPort({
    prisma,
    platformLeagueId: leagueRead.value.platformLeagueId ?? null,
    sport,
    rosterPlayerIds,
    loadAvailability: availabilityLoader(prisma),
    // Already resolved above; the port hands back the one value rather than re-reading per week.
    loadRestOfSeason: async () => restOfSeason,
  })

  /*
   * ⚠ AN EARLIER REVISION REPORTED ALL OF THESE AS ONE BROAD EVIDENCE FAILURE, ON THE REASONING
   * THAT CONCURRENCY MADE THEM UNATTRIBUTABLE. That was a rationalisation: the port knows which
   * read it was in, and it now says so on the error. Every one of the seven named stages is
   * reported specifically.
   */
  let resolved: Awaited<ReturnType<typeof resolveWindowDecision>>
  try {
    resolved = await resolveWindowDecision(
      { leagueId, teamId: team.externalId, season, week },
      port,
      {
        now,
        format: 'redraft',
        coefficients: REDRAFT_WINDOW_COEFFICIENTS,
        ...(scheduledPeriods.length ? { scheduledPeriods } : {}),
      },
    )
  } catch (e) {
    /*
     * ⚠ ATTRIBUTED, NOT GUESSED. The matchup, forecast, dynasty and injury reads run concurrently
     * inside the assembler, so a plain try/catch out here could only say "something failed". The
     * port carries its own stage on the error, which is what makes a specific gap honest.
     */
    return refuse(gapForPortError(e))
  }
  return resolved
}
