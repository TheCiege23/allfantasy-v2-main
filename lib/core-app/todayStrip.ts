import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SectionState } from './leagueHome'

/**
 * The three cross-league cards that sit at the top of Dashboard v2: today's
 * record, league health, and the next 24 hours.
 *
 * One loader for three cards because they render as one strip and share a
 * league list — three separate resolvers would triple the round-trips for a
 * band the reader sees as a single row.
 *
 * ⚠ THIS IS THE CROSS-LEAGUE STRIP, NOT THE SEASON TIMELINE. The season
 * timeline is a per-league surface reached by choosing a league; it answers
 * "where is this league in its year". This answers "what needs me in the next
 * day, across everything". Merging them puts a playoff-start week next to a
 * waiver run and makes neither legible.
 *
 * ── WHAT WAS MEASURED (production, read-only, 2026-08-18) ─────────────────
 * Every gate below exists because a count came back empty or a column turned
 * out to be something other than its name suggests. The counts are recorded at
 * each gate so the next person can tell a deliberate omission from an oversight.
 */

/* ── Today's record ──────────────────────────────────────────────────────── */

export type TodayRecord = {
  wins: number
  losses: number
  /** How many of the user's leagues actually contributed a result. */
  leaguesCounted: number
  season: number
  week: number
}

/* ── Health ──────────────────────────────────────────────────────────────── */

export type HealthReading = {
  score: number
  /** DRIFTING / HEALTHY / AT RISK — the engine's own status, not a re-derivation. */
  label: string
  /** How many leagues the score is averaged over. */
  leaguesCounted: number
}

/* ── Next 24 hours ───────────────────────────────────────────────────────── */

export type Next24Row = {
  kind: 'game' | 'waiver'
  text: string
  /** League name for a waiver run; sport and week for a game. */
  sub: string | null
  /** ISO instant. Localised on the client — never formatted here. */
  time: string
  tone: 'accent' | 'warn' | null
}

export type TodayStripData = {
  record: SectionState<TodayRecord>
  health: SectionState<HealthReading>
  next24: Next24Row[]
}

export type TodayStripLeague = {
  id: string
  name?: string | null
  sport?: string | null
  platformLeagueId?: string | null
  lastSyncedAt?: Date | string | null
}

const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The season a date belongs to for fantasy purposes — a season that starts in
 * autumn carries its own year into the following January.
 *
 * This exists so "today's record" can refuse stale data. `getWeekAll` asks for
 * the LATEST season on file, which is right for a history module and wrong
 * here: the newest rows are season 2025 while the clock reads 2026, and
 * printing them under "today" would date a finished season as live.
 */
export function currentSeasonOf(now: Date): number {
  const year = now.getUTCFullYear()
  // August or later is already the new season; Jan–Jul is still last year's.
  return now.getUTCMonth() >= 7 ? year : year - 1
}

/**
 * Next occurrence of a weekly UTC slot, or null when it falls outside `horizon`.
 *
 * `dayOfWeek` is 0–6 with Sunday = 0, matching both `Date.getUTCDay()` and the
 * stored column, and `hhmm` is "HH:MM" in UTC.
 */
export function nextWeeklyRun(
  now: Date,
  horizon: Date,
  dayOfWeek: number,
  hhmm: string,
): Date | null {
  const [h, m] = hhmm.split(':').map((n) => Number(n))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null

  const candidate = new Date(now)
  candidate.setUTCHours(h, m, 0, 0)
  const dayDelta = (dayOfWeek - candidate.getUTCDay() + 7) % 7
  candidate.setUTCDate(candidate.getUTCDate() + dayDelta)
  // Same weekday but the slot has already passed today — go round again.
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 7)
  }
  return candidate.getTime() <= horizon.getTime() ? candidate : null
}

/**
 * Today's record — how many of your live matchups you are currently winning.
 *
 * ⚠ THE GATE IS THE SEASON, NOT THE ROW COUNT. `WeeklyMatchup` holds 262 rows on
 * production and every one of them is season 2025; `league_teams` holds 893 rows
 * and 0 carry a win, a loss or a point (the standings write-back landed in #446
 * but nothing has flowed through it yet). Either source would have produced a
 * number. Both would have been last season's.
 *
 * Returning `available: false` here is the whole point of the card: a 0–0 reads
 * as a day that was played and lost, which is a strictly worse lie than saying
 * nothing is scored yet. When a sync writes current-season rows this lights up
 * on its own — no code change, because the gate is a comparison and not a flag.
 */
async function resolveRecord(
  userId: string,
  leagues: TodayStripLeague[],
  now: Date,
): Promise<SectionState<TodayRecord>> {
  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (platformIds.length === 0) {
    return { available: false, reason: 'none of your leagues carry a platform id to score against' }
  }

  /*
   * ⚠ THE JOIN IS `League.platformLeagueId`, NOT `League.id` — WeeklyMatchup is
   * written from the provider payload and lives in the other of this repo's two
   * league-id spaces. Measured: 0 rows match on `id`, and joining on it returns
   * an empty set with no error. Same hazard `weekAll.ts` documents.
   */
  const latest = await prisma.weeklyMatchup
    .findFirst({
      where: { leagueId: { in: platformIds } },
      orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }],
      select: { seasonYear: true, week: true },
    })
    .catch(() => null)

  if (!latest) {
    return { available: false, reason: 'no matchup has been scored for your leagues yet' }
  }

  const season = currentSeasonOf(now)
  if (latest.seasonYear < season) {
    return {
      available: false,
      // Naming the season is what keeps this from reading as a bug. The data is
      // real, it is simply not today's.
      reason: `nothing is scored yet this season — the newest results on file are from ${latest.seasonYear}`,
    }
  }

  const [matchups, myTeams] = await Promise.all([
    prisma.weeklyMatchup
      .findMany({
        where: { leagueId: { in: platformIds }, seasonYear: latest.seasonYear, week: latest.week },
        select: { leagueId: true, rosterId: true, pointsFor: true, pointsAgainst: true, win: true },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: {
          league: { platformLeagueId: { in: platformIds } },
          claimedByUserId: userId,
        },
        select: { externalId: true, league: { select: { platformLeagueId: true } } },
      })
      .catch(() => []),
  ])

  // Sleeper roster ids are numeric on WeeklyMatchup and strings on LeagueTeam.
  const mine = new Set<string>()
  for (const team of myTeams) {
    const platformLeagueId = team.league?.platformLeagueId
    const roster = Number(team.externalId)
    if (!platformLeagueId || !Number.isFinite(roster)) continue
    mine.add(`${platformLeagueId}:${roster}`)
  }

  let wins = 0
  let losses = 0
  for (const m of matchups) {
    if (!mine.has(`${m.leagueId}:${m.rosterId}`)) continue // someone else's roster
    if (m.win === 1) wins += 1
    else losses += 1
  }

  if (wins + losses === 0) {
    return { available: false, reason: 'none of your teams have a scored matchup this week' }
  }

  return {
    available: true,
    data: { wins, losses, leaguesCounted: wins + losses, season: latest.seasonYear, week: latest.week },
  }
}

/**
 * League health — gated on the league having actually been looked at.
 *
 * ⚠ THE ENGINE'S OWN `dataConfidence` IS NOT A SUFFICIENT GATE, AND THIS IS THE
 * BUG THIS CARD EXISTS TO AVOID. `buildCommissionerHealthSnapshot` reports
 * `high` whenever it finds any roster rows — and production has 873 rosters
 * across 69 leagues while `lastSyncedAt` is null on all 98. So the engine would
 * have answered "high confidence, 57, DRIFTING" for leagues nobody has ever
 * read. The metrics feeding that score — missed lineups, chat volume, active
 * managers — all come back zero for an unsynced league, so the score is not
 * merely uncertain, it is biased downward. A confident 57 on a league we know
 * nothing about is a measurement nobody took.
 *
 * Freshness is therefore checked FIRST and the engine is not called at all when
 * nothing has synced — a score we are not allowed to show is a score not worth
 * computing. Both gates have to pass: the league synced, and the engine itself
 * says the reading came from the database at high confidence.
 *
 * Precedent: a "C" trade grade means no data, and this repo surfaces that rather
 * than averaging it. Same rule, same reason.
 */
async function resolveHealth(
  userId: string,
  leagues: TodayStripLeague[],
): Promise<SectionState<HealthReading>> {
  const synced = leagues.filter((l) => Boolean(l.lastSyncedAt))

  if (synced.length === 0) {
    return {
      available: false,
      reason:
        'no league has synced yet — a health score before we have read a league would be a measurement nobody took',
    }
  }

  const { getCommissionerHubHealthForUser } = await import(
    '@/lib/commissioner-hub/commissionerHubHealth'
  )

  const syncedIds = new Set(synced.map((l) => l.id))
  const snapshots = await getCommissionerHubHealthForUser(
    userId,
    // The engine takes the caller's league list and filters to commissioner
    // leagues itself. Passing only synced ones keeps a stale league from being
    // averaged in behind the engine's back.
    synced as unknown as Parameters<typeof getCommissionerHubHealthForUser>[1],
  ).catch(() => [])

  const usable = snapshots.filter(
    (s) => syncedIds.has(s.leagueId) && s.source === 'database' && s.dataConfidence === 'high',
  )

  if (usable.length === 0) {
    return {
      available: false,
      reason:
        'health needs rosters and recent activity for a league we have synced — no league clears both yet',
    }
  }

  const score = Math.round(usable.reduce((sum, s) => sum + s.healthScore, 0) / usable.length)

  /*
   * The engine's own status wording when every league agrees, and a neutral
   * "MIXED" when they do not. Averaging four statuses into one confident word
   * would hide a league that is actually on fire behind three that are fine.
   */
  const statuses = new Set(usable.map((s) => String(s.overallStatus)))
  const label = statuses.size === 1 ? [...statuses][0] : 'mixed'

  return {
    available: true,
    data: { score, label, leaguesCounted: usable.length },
  }
}

/**
 * The next 24 hours, across every league.
 *
 * TWO row kinds are real, and a third was cut:
 *
 * ✘ WAIVER RUNS — CUT, AND THIS REVERSES AN EARLIER DECISION IN THIS FILE.
 *   They were built from `LeagueWaiverSettings.processingDayOfWeek` +
 *   `processingTimeUtc` on the reasoning that this is "the ingested table",
 *   unlike `League.waiverProcessTime` (a schema `@default("02:00")`). Half of
 *   that is right: `League.waiverProcessTime` IS a default. The other half is
 *   not — `LeagueWaiverSettings` is ALSO populated from our own defaults, just
 *   less obviously.
 *
 *   Measured on production rather than argued:
 *
 *     day=2 time=10:00  ->  61 leagues
 *     day=1 time=12:00  ->  18 leagues
 *
 *   TWO distinct values across the entire database, correlated with waiverType.
 *   And 54 of those leagues have since synced from Sleeper without the values
 *   changing — if the column were ingested, syncing would have produced varied
 *   real times.
 *
 *   The code says the same thing: every writer of these columns sources from
 *   `getWaiverDefaults(sport, variant)` — a pure defaults function — via
 *   lib/waiver-defaults/ and lib/sport-defaults/. None of the eight writers is
 *   an import adapter. Nothing reads waiver timing off a provider.
 *
 *   So "Waivers process · Dynasty Dragons · 10:00" was our own creation default
 *   printed as that league's measured rule. That is the same failure as a "C"
 *   trade grade meaning no-data, and the row is cut until something genuinely
 *   ingests waiver timing.
 *
 *   TO RESTORE IT: persist Sleeper's waiver settings (its league blob does
 *   expose them) in applySleeperLeagueSync, and gate this on provenance — a
 *   value equal to the sport default is indistinguishable from an unset one, so
 *   the gate has to be "we read this from the provider", not "this is non-null".
 *
 * ✔ GAMES — from `SportsGame`, scoped to the sports the user actually plays.
 *
 * ✘ TRADE VOTES — cut. The handoff marks "trade vote closes" as buildable now
 *   from `trade_review_days` plus a proposal timestamp on `LeagueTradeHistory`.
 *   That table has no proposal timestamp: its columns are `sleeperLeagueId`,
 *   `tradesLoaded`, `totalTradesFound`, `tradingStyle` and friends — it is an
 *   ingestion-progress and trading-profile record, one row per user per league,
 *   not a list of trades. The table that DOES model a vote with a deadline is
 *   `af_league_trades` (`status`, `expiresAt`, `scheduledProcessAt`), and it
 *   holds 0 rows on production. There is no deadline to count down to, so no row
 *   is emitted rather than one derived from a review window with nothing under
 *   review.
 */
async function resolveNext24(
  leagues: TodayStripLeague[],
  now: Date,
): Promise<Next24Row[]> {
  if (leagues.length === 0) return []

  const horizon = new Date(now.getTime() + 24 * 3_600_000)
  const sports = [...new Set(leagues.map((l) => String(l.sport ?? 'NFL').toUpperCase()))]

  // The LeagueWaiverSettings read is gone with the waiver rows — see the header.
  // Querying a column we have proven we cannot trust would just invite someone to
  // render it again.
  const games = await prisma.sportsGame
    .findMany({
      where: { sport: { in: sports }, startTime: { gte: now, lte: horizon } },
      orderBy: { startTime: 'asc' },
      take: 20,
      select: { sport: true, startTime: true, week: true, homeTeam: true, awayTeam: true },
    })
    .catch(() => [])

  const rows: Next24Row[] = []

  /*
   * No waiver rows. See the header — the timing columns hold our own sport
   * defaults, not provider data, so every row would have announced a rule the
   * league never told us. `nextWeeklyRun` is kept and still tested: it is
   * correct arithmetic waiting on a trustworthy input.
   */

  for (const g of games) {
    if (!g.startTime) continue
    rows.push({
      kind: 'game',
      text: `${g.awayTeam} at ${g.homeTeam}`,
      sub: [g.sport, g.week != null ? `Week ${g.week}` : null].filter(Boolean).join(' · ') || null,
      time: g.startTime.toISOString(),
      tone: 'accent',
    })
  }

  rows.sort((a, b) => a.time.localeCompare(b.time))
  return rows.slice(0, 8)
}

export async function getTodayStrip(
  userId: string,
  leagues: TodayStripLeague[],
  now: Date,
): Promise<TodayStripData> {
  const [record, health, next24] = await Promise.all([
    resolveRecord(userId, leagues, now).catch(
      (): SectionState<TodayRecord> => ({
        available: false,
        reason: 'this week’s results could not be read',
      }),
    ),
    resolveHealth(userId, leagues).catch(
      (): SectionState<HealthReading> => ({
        available: false,
        reason: 'league health could not be read',
      }),
    ),
    resolveNext24(leagues, now).catch(() => [] as Next24Row[]),
  ])

  return { record, health, next24 }
}

export { DAY_LABEL }
