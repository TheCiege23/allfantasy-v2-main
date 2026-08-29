import 'server-only'

/**
 * Canonical injury read port.
 *
 * WHY THIS EXISTS: every consumer currently runs its own `sportsInjury.findMany`
 * with different rules, so the same player can be described differently on
 * different screens:
 *
 *   app/api/start-sit/injuries      — NO recency filter at all
 *   app/api/news-crawl              — updatedAt >= 48h
 *   server/.../community-insights   — updatedAt >= 48h
 *   app/api/draft/player-detail     — orderBy date desc, take 5, no recency
 *   app/api/sports/injuries         — orderBy fetchedAt desc, take 300
 *
 * None filter by `source`. `SportsInjury` is unique on
 * (sport, externalId, source), so rows from different providers COEXIST — which
 * is how a 17-day-old api_sports row could outrank a fresh rolling_insights one
 * on any surface that orders by `date` instead of `fetchedAt`.
 *
 * This module is the single reader Decision OS, the OS tree, legacy, trade
 * evaluation, waivers and Chimmy all go through. It guarantees three things no
 * ad-hoc query does:
 *
 *   1. ONE row per player — freshest source wins, deterministically.
 *   2. STALENESS IS RETURNED, NOT HIDDEN. An injury status is a claim about
 *      right now. A two-week-old "Questionable" is not stale data, it is a
 *      FALSE statement, and the caller must be able to see that.
 *   3. AMBIGUOUS NAME MATCHES REFUSE. Binding the wrong athlete's injury is the
 *      failure slice 15 exists to prevent (QB Josh Allen vs LB Josh Allen).
 */

import { prisma } from '@/lib/prisma'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import type { InjuryDesignation } from '@/lib/injuries/rollingInsightsInjuries'

/**
 * Beyond this, a status is treated as a claim we can no longer stand behind.
 * NFL injury reports move daily and hard on game day; 36h spans a normal
 * report cycle without blessing week-old data.
 */
export const INJURY_STALE_AFTER_HOURS = 36

/**
 * Beyond this, a report cannot be describing the CURRENT season and is dropped
 * outright rather than returned with a caveat.
 *
 * 120 days clears an offseason without touching in-season data. Measured against
 * production when this was added: it keeps 1,224 of 1,230 live NFL rows, and drops
 * exactly the archival items — the three NCAAF rows ESPN's college feed replays,
 * whose reports are dated 2020-11-21, 2022-11-03 and 2022-11-26 yet were being
 * served as today's college injury report on the eve of the season.
 *
 * ⚠ This is deliberately NOT `season`, which would be the obvious column: the
 * ingest stamps the CURRENT season onto whatever it pulls, so all three of those
 * 2020/2022 rows carry `season = 2026`. The report date is the only field on the
 * row that has not been overwritten with something convenient.
 */
export const INJURY_PRIOR_SEASON_AFTER_HOURS = 120 * 24

/**
 * Sports for which NO feed can currently produce a live injury designation.
 *
 * 🛑 "WE HAVE NO SOURCE" AND "NOBODY IS HURT" ARE DIFFERENT ANSWERS, AND AN EMPTY PANEL
 * TELLS THE READER THE SECOND ONE. On a Saturday in September, a college manager reading
 * an empty injury list concludes their starters are healthy. That is a false statement
 * this product cannot support, and it is worse than saying nothing.
 *
 * NCAAF, established by exhausting the sources rather than by assuming:
 *
 *   Rolling Insights  contracts/rolling-insights/ENDPOINTS.yaml:157 —
 *                     `injuries: { … NCAAFB: false … }`, and :170 says outright
 *                     "NCAAFB and NCAABB have NO injuries endpoint. College injury data
 *                     must come from another source or be omitted with an explicit
 *                     'not available' flag." This IS that flag.
 *                     ⚠ GAPS ncaa_injuries_real_404 keeps the question open — the vendor
 *                     forbids calling it, which is policy rather than a 404 guarantee —
 *                     and CLAUDE.md forbids probing to settle it. So it stays closed.
 *   TheSportsDB       no injury endpoint at all (404 on lookupinjuries).
 *   CollegeFootballData  stats and play-by-play, not injuries.
 *   ESPN              publishes football/college-football/injuries, and it is fetched
 *                     every cron tick — but on 2026-08-29, the day the season OPENED, it
 *                     still returned the same THREE rows it held in preseason, whose
 *                     reports are dated 2020-11-21, 2022-11-03 and 2022-11-26.
 *
 * ⚠ THE ESPN MODULE'S OWN HYPOTHESIS IS NOW DISPROVEN, and it is corrected there: it read
 * "the college count is small because the season has not started, not because the feed is
 * thin." The season started and the count did not move. The feed is thin.
 *
 * Underneath all of it is a domain fact no integration fixes: the NCAA does not mandate
 * injury reporting the way the NFL does, so there is no league-wide college equivalent to
 * publish.
 *
 * ⚠ NCAAB IS DELIBERATELY NOT LISTED. Its feed is equally empty today, but basketball is
 * out of season — the same evidence that convicts NCAAF is unavailable for it, and
 * claiming otherwise would be the guess this constant exists to prevent. Revisit in
 * November.
 *
 * To remove a sport from here: land a real row and check the REPORT date, not the fetch
 * date (see claimAsOf above for why those differ).
 */
const INJURY_SOURCE_UNAVAILABLE: Record<string, string> = {
  NCAAF:
    'No live college injury source. The NCAA does not mandate injury reports, and no feed we carry publishes them — so this is “we cannot know”, not “nobody is hurt”.',
}

/**
 * Can any feed answer injury questions for this sport at all?
 *
 * Callers should render `reason` instead of an empty list, so a reader can tell a missing
 * SOURCE from a missing INJURY.
 */
export function injuryCoverageFor(sport: string): { covered: boolean; reason: string | null } {
  const reason = INJURY_SOURCE_UNAVAILABLE[String(sport ?? '').trim().toUpperCase()] ?? null
  return { covered: reason == null, reason }
}

/** Source preference when the same player appears from multiple providers. */
const SOURCE_RANK: Record<string, number> = {
  rolling_insights: 100,
  // Game-window fold written by /api/cron/alert-sweep from Sleeper's live
  // players blob — trusted above api_sports, below a same-instant RI row.
  sleeper_live: 75,
  api_sports: 50,
}

export interface InjuryFact {
  playerName: string
  /** Null means "no designation stated" — NOT "healthy". Callers must not
   *  collapse the two; see parseInjuryDesignation in the RI ingest. */
  status: InjuryDesignation | string | null
  /** Body part, e.g. "Knee". */
  type: string | null
  description: string | null
  date: Date | null
  week: number | null
  source: string
  /** When WE last pulled this row. A fact about our ingest, not about the player. */
  fetchedAt: Date
  /** When the provider REPORTED it (`date`, falling back to `fetchedAt`). */
  reportedAt: Date
  /**
   * Age of the CLAIM in hours, measured from `reportedAt`. This is the number that
   * answers "can this still be true?" — see the note in toFact for why it is not
   * measured from `fetchedAt`.
   */
  ageHours: number
  /** Age of our INGEST in hours. Use for feed health ("has the importer stopped?"). */
  fetchAgeHours: number
  /**
   * True when this row is older than INJURY_STALE_AFTER_HOURS. Callers should
   * suppress or caveat the status rather than render it plainly — a stale
   * injury badge is a confident false statement, which is worse than none.
   */
  stale: boolean
}

export interface InjuryLookup {
  name: string
  position?: string | null
  team?: string | null
}

export interface InjuryResolution {
  /** Keyed by normalized player name. Absent = no injury row (i.e. no news). */
  byPlayer: Map<string, InjuryFact>
  /** Names that matched multiple candidates and were REFUSED, not guessed. */
  ambiguous: string[]
  /** Freshest row seen overall — the feed-level health signal. */
  newestFetchedAt: Date | null
  /** True when the whole feed is stale, i.e. ingestion itself has stopped. */
  feedStale: boolean
}

interface InjuryRow {
  playerName: string
  status: string | null
  type: string | null
  description: string | null
  date: Date | null
  week: number | null
  source: string
  fetchedAt: Date
  team: string | null
  position: string | null
}

/**
 * How fresh this claim can possibly be — the OLDER of when the provider says it was
 * reported and when we last actually saw it.
 *
 * ⚠ TAKING THE REPORT DATE ALONE IS WRONG, AND THE SUITE CAUGHT IT. Both bounds have
 * to hold. `date` alone lets a provider that stamps a recent timestamp on a frozen
 * row outrank a genuinely live one — the api_sports-vs-rolling_insights hazard that
 * injury-read-port.test.ts pins with a row claiming a 1-hour-old report that was
 * fetched 17 days ago. `fetchedAt` alone was the original bug: an importer re-pulling
 * a 2020 report today made it zero hours old, which is how the college feed served
 * three archival items as the current injury report.
 *
 * A row fetched 17 days ago cannot tell us anything about the last 17 days no matter
 * what its `date` says, and a report written in 2020 is not news because we pulled it
 * this morning. Taking the earlier of the two is the only reading under which both
 * statements stay true.
 */
function claimAsOf(row: InjuryRow): Date {
  const reported = row.date ?? row.fetchedAt
  return reported.getTime() < row.fetchedAt.getTime() ? reported : row.fetchedAt
}

/** The provider's stated report time, for display. Not a freshness signal on its own. */
function reportedAt(row: InjuryRow): Date {
  return row.date ?? row.fetchedAt
}

function toFact(row: InjuryRow, now: Date): InjuryFact {
  /*
   * 🛑 AGE IS MEASURED FROM THE REPORT DATE, NOT FROM `fetchedAt`.
   *
   * This used to read `now - row.fetchedAt`, which measures how recently WE PULLED
   * the row — a number the provider cannot influence and the reader does not care
   * about. Re-fetching a 2020 report today made it "0 hours old" and therefore
   * fresh, so `stale` was false for data that could not possibly describe today.
   *
   * That contradicted this field's own documented meaning ("callers should suppress
   * or caveat the status ... a stale injury badge is a confident false statement"),
   * so this is a restoration of the stated contract, not a change to it.
   *
   * Measured in production the day this was fixed: of the rows that read as fresh,
   * 91.5% of NFL (1,231 of 1,346) and 100% of NBA, NHL and NCAAF were carrying
   * reports older than the staleness horizon. The NCAAF feed served three items
   * stamped with today's date whose reports were from 2020 and 2022.
   *
   * `fetchAgeHours` keeps the old number for feed-health callers, which is the one
   * job it was ever right for: "has ingestion stopped?" is a question about us.
   */
  const fetchAgeHours = Math.max(0, (now.getTime() - row.fetchedAt.getTime()) / 3_600_000)
  const ageHours = Math.max(0, (now.getTime() - claimAsOf(row).getTime()) / 3_600_000)
  return {
    playerName: row.playerName,
    status: row.status,
    type: row.type,
    description: row.description,
    date: row.date,
    week: row.week,
    source: row.source,
    fetchedAt: row.fetchedAt,
    reportedAt: reportedAt(row),
    ageHours,
    fetchAgeHours,
    stale: ageHours > INJURY_STALE_AFTER_HOURS,
  }
}

/**
 * Deterministic winner between two rows for the same player.
 * Freshness first (an injury status is a claim about NOW), then source rank as
 * the tiebreak. Never array order — that is how "first hit wins" bugs start.
 */
function preferred(a: InjuryRow, b: InjuryRow): InjuryRow {
  /*
   * REPORT DATE FIRST, for the same reason toFact measures it: "freshest wins" has
   * to mean the freshest CLAIM. Ordering by `fetchedAt` alone meant that when two
   * providers both carried a player, the one we happened to re-pull most recently
   * won — so a provider replaying an archival item could outrank another provider's
   * report from this morning.
   */
  const ad = claimAsOf(a).getTime()
  const bd = claimAsOf(b).getTime()
  if (ad !== bd) return ad > bd ? a : b
  const at = a.fetchedAt.getTime()
  const bt = b.fetchedAt.getTime()
  if (at !== bt) return at > bt ? a : b
  const ar = SOURCE_RANK[a.source] ?? 0
  const br = SOURCE_RANK[b.source] ?? 0
  if (ar !== br) return ar > br ? a : b
  return a
}

/**
 * Resolve injuries for a specific set of players.
 *
 * `players` should carry position and team where the caller has them — they are
 * used ONLY to disambiguate name collisions, never to filter. A player with no
 * injury row simply has no entry; that is "no news", not "healthy", and callers
 * should phrase it accordingly.
 */
export async function resolveInjuryFacts(args: {
  sport: string
  players: readonly InjuryLookup[]
  now?: Date
  /** Include rows past their TTL. Default false — expired rows are excluded so
   *  the legacy api_sports rows retired by the RI ingest stay out. */
  includeExpired?: boolean
}): Promise<InjuryResolution> {
  const now = args.now ?? new Date()
  const sport = args.sport.toUpperCase()
  const empty: InjuryResolution = {
    byPlayer: new Map(),
    ambiguous: [],
    newestFetchedAt: null,
    feedStale: true,
  }
  if (args.players.length === 0) return empty

  let rows: InjuryRow[] = []
  try {
    rows = (await prisma.sportsInjury.findMany({
      where: {
        sport,
        ...(args.includeExpired ? {} : { expiresAt: { gt: now } }),
      },
      select: {
        playerName: true,
        status: true,
        type: true,
        description: true,
        date: true,
        week: true,
        source: true,
        fetchedAt: true,
        team: true,
        position: true,
      },
      orderBy: { fetchedAt: 'desc' },
      take: 5000,
    })) as InjuryRow[]
  } catch {
    return empty
  }

  if (rows.length === 0) return empty

  const newestFetchedAt = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.fetchedAt > acc ? r.fetchedAt : acc),
    null,
  )
  const feedAgeHours = newestFetchedAt ? (now.getTime() - newestFetchedAt.getTime()) / 3_600_000 : Infinity

  // Collapse to one row per player BEFORE name-matching, so a duplicate across
  // providers never presents as an ambiguous collision.
  const bestByExact = new Map<string, InjuryRow>()
  for (const r of rows) {
    const key = `${normalizeMatchName(r.playerName)}|${(r.team ?? '').toUpperCase()}`
    const existing = bestByExact.get(key)
    bestByExact.set(key, existing ? preferred(existing, r) : r)
  }

  const index = buildNameIndex(
    [...bestByExact.values()].map((r) => ({
      name: r.playerName,
      position: r.position,
      team: r.team,
      row: r,
    })),
  )

  const byPlayer = new Map<string, InjuryFact>()
  const ambiguous: string[] = []

  for (const lookup of args.players) {
    const key = normalizeMatchName(lookup.name)
    if (!key) continue
    const res = resolveVerifiedMatch(index, {
      name: lookup.name,
      position: lookup.position ?? null,
      team: lookup.team ?? null,
    })
    if (res.reason === 'ambiguous') {
      // Refusing is the point. RI supplies no position on injury rows, so a
      // genuine same-name collision often CANNOT be split — and a missing
      // injury badge is a gap, while the wrong player's badge is a falsehood.
      ambiguous.push(lookup.name)
      continue
    }
    if (!res.match) continue
    byPlayer.set(key, toFact(res.match.row, now))
  }

  return {
    byPlayer,
    ambiguous,
    newestFetchedAt,
    feedStale: feedAgeHours > INJURY_STALE_AFTER_HOURS,
  }
}

export interface InjuryFactListItem extends InjuryFact {
  /** SportsInjury row id — kept so list consumers (tickers) have a stable key. */
  id: string
  team: string | null
  position: string | null
}

export interface InjuryFactList {
  facts: InjuryFactListItem[]
  newestFetchedAt: Date | null
  /** True when the whole feed is stale, i.e. ingestion itself has stopped. */
  feedStale: boolean
}

/**
 * Canonical LIST reader — for surfaces that render "current injuries" without
 * a player set to resolve against (tickers, league-wide injury tables,
 * insights digests). Same guarantees as `resolveInjuryFacts`: TTL-respected,
 * ONE row per player (freshest source wins deterministically), staleness
 * RETURNED rather than hidden. Exists so those surfaces stop running their
 * own inconsistent `sportsInjury.findMany` variants (no recency filter /
 * 48h / order-by-date-desc — the ordering that let a 17-day-old api_sports
 * row outrank a fresh rolling_insights one).
 */
export async function listInjuryFacts(args: {
  sport: string
  now?: Date
  /** Exact team abbreviation filter (already-normalized by the caller). */
  team?: string | null
  /** Case-insensitive substring match on player name. */
  playerNameContains?: string | null
  /** Only rows fetched within this many hours (e.g. 48 for news tickers). */
  maxAgeHours?: number | null
  /**
   * Only rows whose REPORT is within this many hours. Defaults to
   * INJURY_PRIOR_SEASON_AFTER_HOURS so no caller is served last season's news by
   * accident. Pass null to opt out (historical/backfill readers only).
   */
  maxReportAgeHours?: number | null
  /** Only these designations (exact match against stored status). */
  statuses?: readonly string[] | null
  limit?: number
}): Promise<InjuryFactList> {
  const now = args.now ?? new Date()
  const sport = args.sport.toUpperCase()
  const limit = Math.max(1, Math.min(args.limit ?? 300, 1000))
  const empty: InjuryFactList = { facts: [], newestFetchedAt: null, feedStale: true }

  const maxReportAgeHours =
    args.maxReportAgeHours === undefined ? INJURY_PRIOR_SEASON_AFTER_HOURS : args.maxReportAgeHours
  const reportCutoff =
    maxReportAgeHours == null ? null : new Date(now.getTime() - maxReportAgeHours * 3_600_000)

  let rows: Array<InjuryRow & { id: string }> = []
  try {
    rows = (await prisma.sportsInjury.findMany({
      where: {
        sport,
        expiresAt: { gt: now },
        ...(args.team ? { team: args.team } : {}),
        ...(args.playerNameContains
          ? { playerName: { contains: args.playerNameContains, mode: 'insensitive' } }
          : {}),
        ...(args.maxAgeHours != null
          ? { fetchedAt: { gte: new Date(now.getTime() - args.maxAgeHours * 3_600_000) } }
          : {}),
        /*
         * Report-age horizon. `undefined` (the key absent) takes the default;
         * an explicit `null` opts out, which is why this tests for undefined
         * rather than using `!= null` like the fetch filter above.
         *
         * A row with no `date` is KEPT rather than dropped: ~6 NFL rows carry a
         * null report date, and excluding them here would silently lose them.
         * They still get judged by `stale`, which falls back to `fetchedAt`.
         */
        ...(reportCutoff
          ? { AND: [{ OR: [{ date: null }, { date: { gte: reportCutoff } }] }] }
          : {}),
        ...(args.statuses && args.statuses.length > 0 ? { status: { in: [...args.statuses] } } : {}),
      },
      select: {
        id: true,
        playerName: true,
        status: true,
        type: true,
        description: true,
        date: true,
        week: true,
        source: true,
        fetchedAt: true,
        team: true,
        position: true,
      },
      orderBy: { fetchedAt: 'desc' },
      take: 5000,
    })) as Array<InjuryRow & { id: string }>
  } catch {
    return empty
  }

  if (rows.length === 0) return empty

  const newestFetchedAt = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.fetchedAt > acc ? r.fetchedAt : acc),
    null,
  )
  const feedAgeHours = newestFetchedAt ? (now.getTime() - newestFetchedAt.getTime()) / 3_600_000 : Infinity

  // One row per player — same collapse rule as resolveInjuryFacts.
  const bestByExact = new Map<string, InjuryRow & { id: string }>()
  for (const r of rows) {
    const key = `${normalizeMatchName(r.playerName)}|${(r.team ?? '').toUpperCase()}`
    const existing = bestByExact.get(key)
    bestByExact.set(key, existing ? (preferred(existing, r) as InjuryRow & { id: string }) : r)
  }

  /*
   * Sort by REPORT date, not `fetchedAt` — the same clock toFact and preferred use.
   *
   * This mattered more than it looks: an importer stamps `fetchedAt` on everything it
   * writes in a run, so among rows from the same run this comparator was returning 0
   * and the `.slice(limit)` below kept an arbitrary subset. A caller asking for the
   * "50 most recent" injuries was getting 50 rows in whatever order the collapse map
   * happened to yield, which is how a panel of practice notes could hide the
   * designations behind it.
   */
  const facts = [...bestByExact.values()]
    .sort((a, b) => {
      const byClaim = claimAsOf(b).getTime() - claimAsOf(a).getTime()
      if (byClaim !== 0) return byClaim
      /*
       * Ties are the COMMON case, not the edge case: an importer stamps one
       * `fetchedAt` across everything it writes in a run, and rows from one provider
       * frequently share a report date. Without this tiebreak the comparator returns
       * 0 and the `.slice(limit)` below keeps whatever order the dedupe map happened
       * to yield — which is how "the 50 most recent injuries" was really "50 rows in
       * arbitrary order".
       */
      return b.fetchedAt.getTime() - a.fetchedAt.getTime()
    })
    .slice(0, limit)
    .map((r) => ({
      ...toFact(r, now),
      id: r.id,
      team: r.team,
      position: r.position,
    }))

  return {
    facts,
    newestFetchedAt,
    feedStale: feedAgeHours > INJURY_STALE_AFTER_HOURS,
  }
}

/**
 * Feed-level health, for the control room / per-feed health chip and for any
 * surface that needs to caveat itself before rendering injury data at all.
 */
export async function getInjuryFeedHealth(sport = 'NFL', now = new Date()): Promise<{
  newestFetchedAt: Date | null
  ageHours: number | null
  stale: boolean
  rowsLive: number
  bySource: Array<{ source: string; rows: number; newestFetchedAt: Date | null }>
}> {
  const s = sport.toUpperCase()
  try {
    const grouped = await prisma.sportsInjury.groupBy({
      by: ['source'],
      where: { sport: s, expiresAt: { gt: now } },
      _count: { _all: true },
      _max: { fetchedAt: true },
    })
    const bySource = grouped.map((g) => ({
      source: g.source,
      rows: g._count._all,
      newestFetchedAt: g._max.fetchedAt ?? null,
    }))
    const rowsLive = bySource.reduce((a, b) => a + b.rows, 0)
    const newest = bySource.reduce<Date | null>(
      (acc, b) => (b.newestFetchedAt && (!acc || b.newestFetchedAt > acc) ? b.newestFetchedAt : acc),
      null,
    )
    const ageHours = newest ? (now.getTime() - newest.getTime()) / 3_600_000 : null
    return {
      newestFetchedAt: newest,
      ageHours,
      stale: ageHours == null || ageHours > INJURY_STALE_AFTER_HOURS,
      rowsLive,
      bySource,
    }
  } catch {
    return { newestFetchedAt: null, ageHours: null, stale: true, rowsLive: 0, bySource: [] }
  }
}
