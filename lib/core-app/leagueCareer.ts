import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { letterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'

/**
 * Cache key prefix owned by `sleeperTradeGradeService`.
 *
 * Duplicated as a constant rather than imported because that module is
 * server-only AND reaches the Sleeper API; importing it here to borrow one
 * string would drag a provider client into this file's graph and trip the
 * db-first boundary guard on a module that only ever reads Postgres.
 */
const TRADE_GRADES_CACHE_PREFIX = 'trade-grades:v2:'

/**
 * League Career — your record inside ONE league, across every season of it
 * (38a·6).
 *
 * ⚠ THE SOURCE IS `MatchupFact` (`dw_matchup_facts`), NOT `WeeklyMatchup`, AND
 * THAT IS NOT INTERCHANGEABLE. Sleeper league ids are per-season: a dynasty
 * league running six years is six different `platformLeagueId` values, so
 * `WeeklyMatchup` — which is keyed on the provider id — can only ever answer for
 * the current season. `MatchupFact` is keyed on OUR `League.id` with historical
 * roster ids already remapped, which makes it the only table in this repo that
 * can answer "how have I done in this league since 2019".
 *
 * ── Policies this file inherits from ADR F2.10 ───────────────────────────
 *
 * They are binding on every consumer, and three of them shape this file:
 *
 *   1. SPARSE COVERAGE IS THE NORMAL PATH. Three leagues in production have
 *      matchup facts. The unavailable branch here is the primary code path, not
 *      an edge case, and no consumer may render absence as 0 wins and 0 losses.
 *   3. Incomplete fixtures — `scoreA = 0 ∧ scoreB = 0 ∧ winnerTeamId IS NULL` —
 *      are EXCLUDED from every completed summary. They are scheduled games, not
 *      ties. 108 of the 1,186 rows are these.
 *   6. Opponent strength, strength of schedule, momentum and manager quality are
 *      never derived. Per-matchup projections were never stored, so accuracy is
 *      impossible rather than merely missing.
 *
 * The team bridge is also binding: `teamA`/`teamB` are provider roster-slot ids,
 * resolved to canonical teams through `(leagueId, externalId)` on `LeagueTeam` —
 * the scoring engine's own join. They are NOT canonical ids and joining them as
 * if they were silently matches nothing.
 */

export type CareerSeasonLine = {
  season: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  /** Completed games only — incomplete fixtures never count. */
  games: number
}

export type CareerRival = {
  name: string
  wins: number
  losses: number
  meetings: number
  /** Your average margin against them. Negative means they beat you. */
  averageMargin: number
}

export type LeagueGrade = {
  letter: GradeLetter
  /** What the letter is computed from — never rendered without it. */
  sample: string
  /** The number behind the letter, for anyone who wants it. */
  value: number
}

export type LeagueCareerData = {
  league: { id: string; name: string; platform: string }
  /** Seasons with at least one completed game, oldest first. */
  seasons: CareerSeasonLine[]
  totals: { wins: number; losses: number; pointsFor: number; games: number; winPct: number | null }
  firstSeason: number
  lastSeason: number
  /** The opponent who has beaten you most. Null until you have met someone twice. */
  toughestRival: CareerRival | null
  tradeGrade: SectionState<LeagueGrade>
  waiverGrade: SectionState<LeagueGrade>
}

export type LeagueCareerResult =
  | ({ available: true } & LeagueCareerData)
  | { available: false; leagueName: string; reason: string }

/** Below this a "rivalry" is one game, which is a result rather than a pattern. */
const MIN_RIVAL_MEETINGS = 2

/**
 * ⚠ INCOMPLETE FIXTURE, NOT A TIE. ADR F2.10 policy 3, stated as code so no
 * caller has to remember it. A 0-0 with a winner recorded IS a real completed
 * game (a double-forfeit, say) and counts normally — only the null-winner case
 * is a fixture that has not happened.
 */
function isCompleted(f: { scoreA: number; scoreB: number; winnerTeamId: string | null }): boolean {
  return !(f.scoreA === 0 && f.scoreB === 0 && f.winnerTeamId == null)
}

export async function getLeagueCareer(
  leagueId: string,
  userId: string,
): Promise<LeagueCareerResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
  })
  const leagueName = leagueDisplayName(league?.name)
  if (!league) {
    return { available: false, leagueName, reason: 'this league could not be read' }
  }

  /*
   * The ADR's port contract: two bounded find-only reads, joined in process.
   * Prisma cannot express the team bridge relationally, and the ADR measured the
   * worst-case league at 0.613 ms — this is not worth a view or a cache.
   */
  const [facts, teams] = await Promise.all([
    prisma.matchupFact
      .findMany({
        where: { leagueId },
        select: {
          season: true,
          weekOrPeriod: true,
          teamA: true,
          teamB: true,
          scoreA: true,
          scoreB: true,
          winnerTeamId: true,
        },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: { externalId: true, teamName: true, ownerName: true, claimedByUserId: true },
      })
      .catch(() => []),
  ])

  if (facts.length === 0) {
    /*
     * The normal path, per policy 1. It says what is missing and why rather than
     * rendering an identity banner reading 0—0 over "0 seasons", which is what
     * an empty-but-real history would look like and is a different claim.
     */
    return {
      available: false,
      leagueName,
      reason:
        'no multi-season history has been built for this league. Season-by-season records live in the warehouse table, which is populated by a historical backfill — this league has not had one run against it, so there is nothing behind a career record here yet.',
    }
  }

  const mySlots = new Set(
    teams.filter((t) => t.claimedByUserId === userId).map((t) => String(t.externalId)),
  )

  if (mySlots.size === 0) {
    return {
      available: false,
      leagueName,
      reason:
        'we cannot tell which team in this league is yours, and every figure on this screen is about your team specifically',
    }
  }

  const nameBySlot = new Map<string, string>()
  for (const t of teams) {
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) nameBySlot.set(String(t.externalId), label)
  }

  const bySeason = new Map<number, CareerSeasonLine>()
  const rivals = new Map<string, { wins: number; losses: number; meetings: number; marginSum: number }>()

  for (const f of facts) {
    if (!isCompleted(f)) continue
    if (f.season == null) continue

    const aIsMine = mySlots.has(String(f.teamA))
    const bIsMine = mySlots.has(String(f.teamB))
    if (!aIsMine && !bIsMine) continue

    const myScore = aIsMine ? f.scoreA : f.scoreB
    const theirScore = aIsMine ? f.scoreB : f.scoreA
    const theirSlot = String(aIsMine ? f.teamB : f.teamA)

    const line = bySeason.get(f.season) ?? {
      season: f.season,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      games: 0,
    }
    line.games += 1
    line.pointsFor += myScore
    line.pointsAgainst += theirScore
    /*
     * The winner column is authoritative where it exists — it is what the
     * provider recorded, and a league with median-based or all-play scoring can
     * have a winner that comparing two totals would get wrong. Score comparison
     * is only the fallback.
     */
    const mySlotForRow = String(aIsMine ? f.teamA : f.teamB)
    const won =
      f.winnerTeamId != null ? String(f.winnerTeamId) === mySlotForRow : myScore > theirScore
    if (won) line.wins += 1
    else line.losses += 1
    bySeason.set(f.season, line)

    const r = rivals.get(theirSlot) ?? { wins: 0, losses: 0, meetings: 0, marginSum: 0 }
    r.meetings += 1
    r.marginSum += myScore - theirScore
    if (won) r.wins += 1
    else r.losses += 1
    rivals.set(theirSlot, r)
  }

  const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season)

  if (seasons.length === 0) {
    return {
      available: false,
      leagueName,
      reason:
        'this league has matchup history on file, but none of it involves your team — either the roster was claimed after those seasons or the historical rows belong to a different manager slot',
    }
  }

  const totals = seasons.reduce(
    (acc, s) => ({
      wins: acc.wins + s.wins,
      losses: acc.losses + s.losses,
      pointsFor: acc.pointsFor + s.pointsFor,
      games: acc.games + s.games,
    }),
    { wins: 0, losses: 0, pointsFor: 0, games: 0 },
  )

  /*
   * Toughest rival is who has beaten you most, tie-broken by the margin they
   * beat you by. Not "closest record" and not "most meetings" — the question
   * this answers is which manager has actually cost you games.
   */
  const toughestRival: CareerRival | null =
    [...rivals.entries()]
      .filter(([, r]) => r.meetings >= MIN_RIVAL_MEETINGS)
      .map(([slot, r]) => ({
        name: nameBySlot.get(slot) ?? 'Unnamed team',
        wins: r.wins,
        losses: r.losses,
        meetings: r.meetings,
        averageMargin: r.marginSum / r.meetings,
      }))
      .sort((a, b) => b.losses - a.losses || a.averageMargin - b.averageMargin)[0] ?? null

  const [tradeGrade, waiverGrade] = await Promise.all([
    gradeTrades(leagueId, league.platformLeagueId, userId),
    gradeWaivers(leagueId, userId),
  ])

  return {
    available: true,
    league: {
      id: league.id,
      name: leagueName,
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    seasons,
    totals: {
      ...totals,
      winPct: totals.games > 0 ? totals.wins / totals.games : null,
    },
    firstSeason: seasons[0].season,
    lastSeason: seasons[seasons.length - 1].season,
    toughestRival,
    tradeGrade,
    waiverGrade,
  }
}

/**
 * Career trade grade for this league.
 *
 * ⚠ A LETTER NEVER SHIPS ALONE. `GRADE_THRESHOLDS` puts C across −40 to +40, so
 * a manager who has produced nothing at all lands mid-C — which means "C" and
 * "we have no data" are visually identical unless the absence is detected
 * separately. That is why this returns a `SectionState` and why `sample` is a
 * required field on the grade rather than an optional annotation.
 */
async function gradeTrades(
  leagueId: string,
  platformLeagueId: string | null,
  userId: string,
): Promise<SectionState<LeagueGrade>> {
  if (!platformLeagueId) {
    return {
      available: false,
      reason: 'this league has no platform id on file, and trade grades are keyed on it',
    }
  }

  /*
   * ⚠ READS THE CACHE, NEVER CALLS THE BUILDER. `getTradeGrades()` falls through
   * to the Sleeper API on a miss, and a provider call from a page render is
   * exactly what `scripts/check-db-first-api-boundary.mjs` exists to stop — it
   * also puts a multi-season scan on the critical path of a tab someone clicked.
   * The notifier and the trades surface populate this key; if they have not run
   * for this league, the honest answer is that it has not been graded yet.
   */
  const cached = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${TRADE_GRADES_CACHE_PREFIX}${platformLeagueId}` } })
    .catch(() => null)

  const payload =
    cached?.data && typeof cached.data === 'object'
      ? (cached.data as unknown as {
          version?: number
          seasonsScanned?: string[]
          trades?: Array<{
            tie?: boolean
            sides?: Array<{ ownerId: string | null; cumulativeNet: number }>
          }>
        })
      : null

  if (!payload || payload.version !== 2 || !Array.isArray(payload.trades)) {
    return {
      available: false,
      reason:
        'this league’s trades have not been graded yet. Grading walks every season after each trade to see what the pieces actually did, and that pass has not run here.',
    }
  }

  // Which Sleeper owner is this user, in this league?
  const me = await prisma.leagueTeam
    .findFirst({
      where: { leagueId, claimedByUserId: userId },
      select: { platformUserId: true },
    })
    .catch(() => null)

  const ownerId = me?.platformUserId ?? null
  if (!ownerId) {
    return {
      available: false,
      reason: 'we cannot match your account to a manager in this league’s trade history',
    }
  }

  let net = 0
  let count = 0
  for (const t of payload.trades) {
    const side = (t.sides ?? []).find((sd) => sd.ownerId === ownerId)
    if (!side) continue
    count += 1
    net += side.cumulativeNet
  }

  if (count === 0) {
    /*
     * Graded league, no trades of yours in it. That is a real and rather
     * different fact from an ungraded league, and it is not a bad grade — it is
     * an absent one.
     */
    return {
      available: false,
      reason:
        'you have not made a trade in this league. There is nothing to grade, which is not the same as grading badly.',
    }
  }

  /*
   * ⚠ PER SEASON, NOT PER TRADE — the bands in `gradeScale.ts` are defined on
   * average net per season, and dividing by trade count instead would put the
   * same manager in a different band purely for trading more often.
   */
  const seasons = Math.max(1, payload.seasonsScanned?.length ?? 1)
  const avgPerSeason = net / seasons

  return {
    available: true,
    data: {
      letter: letterFor(avgPerSeason),
      value: avgPerSeason,
      sample: `${count} ${count === 1 ? 'trade' : 'trades'} across ${seasons} ${
        seasons === 1 ? 'season' : 'seasons'
      }`,
    },
  }
}

/**
 * Career waiver grade — claim value over the league's own median winning bid.
 *
 * ⚠ THE SCALE IS DELIBERATELY THE TRADE SCALE. A "B" on one card and a "B" on
 * the other sitting side by side have to mean comparable things, or the pair is
 * actively misleading. So the input is normalised to the same
 * average-net-per-season axis `letterFor` already bands, rather than inventing a
 * second set of cutoffs whose letters coincidentally share an alphabet.
 *
 * ⚠ AND IT IS MEASURED AGAINST THIS ROOM, NOT A NATIONAL AVERAGE. Spending $40
 * is shrewd in a league whose median winning bid is $12 and careless in one
 * where it is $90. The comparison only means anything inside one league's own
 * bidding history.
 */
async function gradeWaivers(leagueId: string, userId: string): Promise<SectionState<LeagueGrade>> {
  const settings = await prisma.leagueWaiverSettings
    .findUnique({ where: { leagueId }, select: { waiverType: true } })
    .catch(() => null)

  const kind = String(settings?.waiverType ?? '').toLowerCase()

  if (kind && kind !== 'faab') {
    /*
     * On a priority-order league there is no bid to compare. A claim either won
     * or it did not, and grading "spent nothing, got the player" against a
     * median of nothing is arithmetic on an empty concept.
     */
    return {
      available: false,
      reason:
        'this league does not run FAAB, so claims carry no bid to measure. A waiver grade compares what you paid against what the room pays, and there is no price here.',
    }
  }

  /*
   * ⚠ FAAB BID AMOUNTS ARE NOT STORED DURABLY ANYWHERE IN THIS REPO. The
   * imported-activity ingest records that a waiver happened — type, roster,
   * player — and drops the winning bid. Without the amounts there is no
   * distribution to take a median of and nothing to score a claim against.
   *
   * This is the honest state and it is stated rather than papered over with a
   * hit-rate that would render under the same letter and mean something else.
   */
  void userId
  return {
    available: false,
    reason:
      'winning FAAB bid amounts are not stored when waiver activity is ingested, so there is no bidding history to price your claims against. The scale is defined and waiting on the amounts.',
  }
}
