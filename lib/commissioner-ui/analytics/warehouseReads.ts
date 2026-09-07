import { prisma } from '@/lib/prisma'
import { lookbackDays } from '@/lib/decision-os/behavioral/api/real-data-provider'
import type {
  CompetitiveBalanceMetric,
  ManagerActivityEntry,
  ScoringDistributionBucket,
  SeasonComparisonPoint,
  TeamPointsEntry,
  TransactionWeek,
} from './decision-os-client/types'

/**
 * The season-history half of League Analytics, read straight from Postgres.
 *
 * 🛑 THE PANELS THIS FILLS WERE BLANK WHILE THE DATA SAT IN THE SAME DATABASE. Decision OS's
 * behavioral pipeline tracks engagement and never scoring, so `analytics/live.ts` returned a
 * literal `[]` for every scoring, standings and history field. That was honest about Decision OS
 * and wrong about AllFantasy: the Sleeper importer populates a six-season warehouse per league.
 * Measured 2026-09-07 — `dw_matchup_facts` covers **213 of 287 leagues** (85,140 rows) and
 * `season_results` covers 241; 166 leagues carry two or more scored seasons. This is the single
 * richest thing an import gives us and nothing was reading it.
 *
 * ⚠ THE COMMENT IN `analytics/live.ts` NAMED THE WRONG TABLES. It proposed wiring scoring from
 * `WeeklyScore`/`WeeklyMatchup` and transactions from `AfLeagueTrade`/`WaiverClaim`. All four hold
 * **zero rows for an imported league** — imported leagues never touch AF-native tables. Building
 * to that comment produces a page that stays blank and looks correct.
 *
 * ⚠ TWO TABLES, TWO TYPES FOR `season`. `season_results.season` is TEXT and
 * `dw_matchup_facts.season` is INTEGER. Comparing one to the other raises
 * `operator does not exist: text = integer`, so every query below binds the type it needs.
 *
 * Everything here is read-only and DB-first — no provider call, nothing cached, nothing written.
 */

/** Every field is independently degradable: one empty array never blanks the others. */
export interface WarehouseAnalytics {
  /**
   * The season the season-scoped panels describe, as a label.
   *
   * 🛑 THIS IS NOT ALWAYS THE CURRENT SEASON, AND SAYING SO IS THE WHOLE POINT. A league in
   * preseason has a full fixture list with no scores — this league carries 108 scheduled 2026
   * matchups and zero points. Rendering that would draw twelve bars at zero under a panel titled
   * "Season totals per team", which reads as "your league scored nothing", the exact failure the
   * blank panels were left blank to avoid. So the panels show the newest season that actually has
   * scores and NAME it, rather than showing the current season empty or silently back-filling.
   */
  seasonLabel: string | null
  pointsForAgainst: TeamPointsEntry[]
  scoringDistribution: ScoringDistributionBucket[]
  competitiveBalance: CompetitiveBalanceMetric[]
  seasonComparison: SeasonComparisonPoint[]
  transactionsByWeek: TransactionWeek[]
  managerActivity: ManagerActivityEntry[]
}

const EMPTY: WarehouseAnalytics = {
  seasonLabel: null,
  pointsForAgainst: [],
  scoringDistribution: [],
  competitiveBalance: [],
  seasonComparison: [],
  transactionsByWeek: [],
  managerActivity: [],
}

/**
 * Runs one panel's read, containing its failure to that panel.
 *
 * 🛑 THIS EXISTS BECAUSE THE FIRST VERSION DID NOT HAVE IT AND ITS DOC COMMENT SAID IT DID. A
 * single outer try/catch around `Promise.all` meant one bad query blanked all six panels — and
 * the failure that proved it was a real one (`make_interval(days => bigint)`), so the page went
 * from six populated panels to six "not wired" notes with nothing in the UI to say why. A
 * containment claim that only exists in a comment is worse than no claim: it stops the next
 * person looking.
 */
async function panel<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error(`[warehouseReads] ${label} failed; other panels unaffected`, error)
    return fallback
  }
}

/**
 * Coerces every numeric shape Prisma's raw driver returns into a plain number.
 *
 * 🛑 THE `object` ARM IS THE LOAD-BEARING ONE AND IT WAS MISSING. Postgres `numeric` — which is
 * what `season_results.pointsFor` and every `avg()` over it are — comes back as a **Decimal
 * object**, not a string or a number. Without this arm `num()` fell through to `0`, so a team
 * that scored 2,488 points read as 0, and the `pointsFor > 0` filter downstream then deleted the
 * row entirely. Three panels rendered as "no scoring totals for this league" while six seasons of
 * real points sat in the table.
 *
 * That failure mode is the reason this is a shared helper rather than a cast at each call site:
 * it is silent, it looks exactly like absent data, and `count(*)` columns (BigInt) coerce fine, so
 * half the queries kept working and masked it.
 */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof value === 'object') {
    const parsed = Number((value as { toString(): string }).toString())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round(value: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/** The newest season with real scores — never merely the newest season. See `seasonLabel`. */
async function latestScoredSeason(leagueId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ season: number | null }>>`
    SELECT max(season) AS season
    FROM dw_matchup_facts
    WHERE "leagueId" = ${leagueId} AND "scoreA" > 0
  `
  const season = rows[0]?.season
  return season == null ? null : Number(season)
}

async function readPointsForAgainst(leagueId: string, season: number): Promise<TeamPointsEntry[]> {
  const rows = await prisma.$queryRaw<Array<{ teamName: string | null; ownerName: string | null; pf: unknown; pa: unknown }>>`
    SELECT lt."teamName", lt."ownerName", sr."pointsFor" AS pf, sr."pointsAgainst" AS pa
    FROM season_results sr
    JOIN league_teams lt
      ON lt."leagueId" = sr."leagueId" AND lt."externalId" = sr."rosterId"
    WHERE sr."leagueId" = ${leagueId} AND sr.season = ${String(season)}
    ORDER BY sr."pointsFor" DESC
  `
  return rows
    .map((r) => ({
      // A Sleeper team can be left unnamed, in which case the owner handle is the name people
      // actually use for it. Falling back to a placeholder would put "Team 7" on a real chart.
      teamName: r.teamName?.trim() || r.ownerName?.trim() || 'Unnamed team',
      pointsFor: round(num(r.pf)),
      pointsAgainst: round(num(r.pa)),
    }))
    .filter((t) => t.pointsFor > 0 || t.pointsAgainst > 0)
}

/**
 * Teams grouped into 100-point bands of season points.
 *
 * Bands are derived from this league's own range rather than fixed: scoring settings differ so
 * wildly between formats (this superflex TE-premium league averages ~2,050 points a season; a
 * standard league is far lower) that any hard-coded band set would put every team in one bucket
 * for most leagues.
 */
async function readScoringDistribution(leagueId: string, season: number): Promise<ScoringDistributionBucket[]> {
  const rows = await prisma.$queryRaw<Array<{ pf: unknown }>>`
    SELECT sr."pointsFor" AS pf
    FROM season_results sr
    WHERE sr."leagueId" = ${leagueId} AND sr.season = ${String(season)} AND sr."pointsFor" > 0
  `
  const points = rows.map((r) => num(r.pf)).filter((v) => v > 0)
  if (points.length === 0) return []

  const lo = Math.min(...points)
  const hi = Math.max(...points)
  // One band when every team landed inside 100 points — a five-band axis over a 40-point spread
  // would invent precision the data does not have.
  const width = Math.max(100, Math.ceil((hi - lo) / 5 / 100) * 100)
  const base = Math.floor(lo / width) * width

  const buckets = new Map<number, number>()
  for (const p of points) {
    const start = base + Math.floor((p - base) / width) * width
    buckets.set(start, (buckets.get(start) ?? 0) + 1)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, teamCount]) => ({
      rangeLabel: `${start.toLocaleString()}–${(start + width - 1).toLocaleString()}`,
      teamCount,
    }))
}

/**
 * Balance metrics, each one a count of real games rather than an index.
 *
 * Deliberately no Gini coefficient or parity score: a single synthesised number is unarguable on a
 * dashboard and unexplainable in a league chat. "56 of 98 games were decided by 30+" is a fact a
 * commissioner can check against their own memory of the season, which is the standard the rest of
 * this page is held to.
 */
async function readCompetitiveBalance(leagueId: string, season: number): Promise<CompetitiveBalanceMetric[]> {
  const [margins] = await prisma.$queryRaw<Array<{ games: unknown; blowouts: unknown; onescore: unknown; avgmargin: unknown }>>`
    SELECT count(*) AS games,
           count(*) FILTER (WHERE abs("scoreA" - "scoreB") >= 30) AS blowouts,
           count(*) FILTER (WHERE abs("scoreA" - "scoreB") < 10)  AS onescore,
           avg(abs("scoreA" - "scoreB")) AS avgmargin
    FROM dw_matchup_facts
    WHERE "leagueId" = ${leagueId} AND season = ${season} AND "scoreA" > 0
  `
  const [spread] = await prisma.$queryRaw<Array<{ hi: unknown; lo: unknown }>>`
    SELECT max("pointsFor") AS hi, min("pointsFor") AS lo
    FROM season_results
    WHERE "leagueId" = ${leagueId} AND season = ${String(season)} AND "pointsFor" > 0
  `
  const [titles] = await prisma.$queryRaw<Array<{ champs: unknown; seasons: unknown }>>`
    SELECT count(DISTINCT "rosterId") AS champs, count(*) AS seasons
    FROM season_results
    WHERE "leagueId" = ${leagueId} AND champion
  `

  const metrics: CompetitiveBalanceMetric[] = []
  const games = num(margins?.games)

  if (games > 0) {
    const blowouts = num(margins.blowouts)
    const onescore = num(margins.onescore)
    metrics.push({
      label: 'Blowouts',
      value: `${blowouts} of ${games}`,
      interpretation: `${Math.round((blowouts / games) * 100)}% of games were decided by 30 points or more.`,
    })
    metrics.push({
      label: 'One-score games',
      value: `${onescore} of ${games}`,
      interpretation: `${Math.round((onescore / games) * 100)}% were decided by under 10 points.`,
    })
    metrics.push({
      label: 'Average margin',
      value: `${round(num(margins.avgmargin))} pts`,
      interpretation: 'Mean winning margin across every completed matchup this season.',
    })
  }

  const hi = num(spread?.hi)
  const lo = num(spread?.lo)
  if (hi > 0 && lo > 0) {
    metrics.push({
      label: 'Scoring spread',
      value: `${round(hi - lo).toLocaleString()} pts`,
      interpretation: `Between the highest-scoring team (${round(hi).toLocaleString()}) and the lowest (${round(lo).toLocaleString()}).`,
    })
  }

  const champs = num(titles?.champs)
  const titleSeasons = num(titles?.seasons)
  if (titleSeasons > 0) {
    metrics.push({
      label: 'Title spread',
      value: `${champs} of ${titleSeasons}`,
      interpretation:
        champs === titleSeasons
          ? `A different team has won each of the last ${titleSeasons} seasons.`
          : `${champs} different ${champs === 1 ? 'team has' : 'teams have'} won the last ${titleSeasons} seasons.`,
    })
  }

  return metrics
}

/** Average points per team per season — the honest season-over-season comparison. */
async function readSeasonComparison(leagueId: string): Promise<SeasonComparisonPoint[]> {
  const rows = await prisma.$queryRaw<Array<{ season: string; v: unknown }>>`
    SELECT season, avg("pointsFor") AS v
    FROM season_results
    WHERE "leagueId" = ${leagueId} AND "pointsFor" > 0
    GROUP BY season
    ORDER BY season
  `
  return rows.map((r) => ({ seasonLabel: String(r.season), value: round(num(r.v)) }))
}

/**
 * Transactions bucketed by CALENDAR week, not NFL week.
 *
 * The imported activity for a dynasty league is mostly offseason — this league's runs January to
 * August — and there is no NFL week 34. Labelling these "Wk 1…" would put draft-season trades
 * under regular-season week numbers, which is a worse lie than a plain date.
 */
async function readTransactionsByWeek(leagueId: string, providerLeagueId: string | null, provider: string | null): Promise<TransactionWeek[]> {
  const rows = await prisma.$queryRaw<Array<{ wk: string; trades: unknown; waivers: unknown }>>`
    SELECT to_char(date_trunc('week', "occurredAt"), 'Mon DD') AS wk,
           count(*) FILTER (WHERE "activityType" = 'trade')  AS trades,
           count(*) FILTER (WHERE "activityType" = 'waiver') AS waivers
    FROM decision_os_imported_activity
    WHERE ("afLeagueId" = ${leagueId}
           OR (${provider}::text IS NOT NULL AND provider = ${provider}::text
               AND "providerLeagueId" = ${providerLeagueId}::text))
      AND "activityType" IN ('trade', 'waiver')
    GROUP BY date_trunc('week', "occurredAt")
    ORDER BY date_trunc('week', "occurredAt")
  `
  return rows.map((r) => ({
    weekLabel: r.wk.replace(/\s+/g, ' ').trim(),
    tradeCount: num(r.trades),
    waiverClaimCount: num(r.waivers),
  }))
}

/**
 * Per-manager action rate over the lookback window, against the window immediately before it.
 *
 * ⚠ THE MANAGER KEY IS INSIDE THE JSON, NOT IN A COLUMN. `stableExternalManagerKey`,
 * `externalManagerId`, `rosterId` and `appUserId` are null on 100% of imported rows; the identity
 * lives in `normalized.managerKeys` as `sleeper:<ownerId>`. A `GROUP BY` on any of those columns
 * returns one bucket and looks like it worked.
 *
 * ⚠ AND THE NAME MAP MUST COME FROM THE NEWEST SEASON ONLY. Rosters change hands, so a map built
 * across all seasons attributes a departed manager's activity to whoever holds their roster now.
 * Measured while building this: two different Sleeper owner ids both resolved to "Peter
 * Nincompoop". Restricting to the newest snapshot season gives 12 ids to 12 distinct teams, and
 * an owner who has left simply does not resolve — which is correct, not a gap.
 */
async function readManagerActivity(
  leagueId: string,
  providerLeagueId: string | null,
  provider: string | null,
): Promise<ManagerActivityEntry[]> {
  const days = lookbackDays()
  const weeks = days / 7

  const nameRows = await prisma.$queryRaw<Array<{ owner_id: string | null; teamName: string | null; ownerName: string | null }>>`
    WITH newest AS (SELECT max(season) AS s FROM dw_roster_snapshots WHERE "leagueId" = ${leagueId})
    SELECT DISTINCT rp->>'ownerId' AS owner_id, lt."teamName", lt."ownerName"
    FROM dw_roster_snapshots s,
         jsonb_array_elements(s.roster_players) rp
    JOIN league_teams lt
      ON lt."leagueId" = ${leagueId} AND lt."externalId" = rp->>'rosterId'
    WHERE s."leagueId" = ${leagueId} AND s.season = (SELECT s FROM newest)
  `
  const names = new Map<string, string>()
  for (const r of nameRows) {
    if (!r.owner_id) continue
    const label = r.teamName?.trim() || r.ownerName?.trim()
    if (label) names.set(r.owner_id, label)
  }
  if (names.size === 0) return []

  const counts = await prisma.$queryRaw<Array<{ mgr: string; current: unknown; prior: unknown }>>`
    SELECT k AS mgr,
           count(*) FILTER (WHERE a."occurredAt" > now() - make_interval(days => ${days}::int))          AS current,
           count(*) FILTER (WHERE a."occurredAt" <= now() - make_interval(days => ${days}::int)
                              AND a."occurredAt" >  now() - make_interval(days => ${days * 2}::int))     AS prior
    FROM decision_os_imported_activity a,
         jsonb_array_elements_text(a.normalized->'managerKeys') k
    WHERE (a."afLeagueId" = ${leagueId}
           OR (${provider}::text IS NOT NULL AND a.provider = ${provider}::text
               AND a."providerLeagueId" = ${providerLeagueId}::text))
      AND a."occurredAt" > now() - make_interval(days => ${days * 2}::int)
    GROUP BY k
  `

  return counts
    .map((r) => {
      const ownerId = String(r.mgr).replace(/^[a-z]+:/, '')
      const managerName = names.get(ownerId)
      if (!managerName) return null
      return {
        managerName,
        actionsPerWeek: round(num(r.current) / weeks, 2),
        priorActionsPerWeek: round(num(r.prior) / weeks, 2),
      }
    })
    .filter((r): r is ManagerActivityEntry => r !== null)
    .sort((a, b) => b.actionsPerWeek - a.actionsPerWeek)
}

/**
 * Reads every warehouse-backed panel for one league.
 *
 * Each panel is fetched independently and a failure in one is contained: the caller gets the
 * others rather than a blank page. Returning `null` is reserved for "this league has no scored
 * season at all", which is genuinely different from "the season is young".
 */
export async function readWarehouseAnalytics(leagueId: string): Promise<WarehouseAnalytics> {
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true },
    })
    const provider = league?.platform ?? null
    const providerLeagueId = league?.platformLeagueId ?? null

    const season = await panel('latestScoredSeason', () => latestScoredSeason(leagueId), null)

    const [pointsForAgainst, scoringDistribution, competitiveBalance, seasonComparison, transactionsByWeek, managerActivity] =
      await Promise.all([
        season == null ? [] : panel('pointsForAgainst', () => readPointsForAgainst(leagueId, season), []),
        season == null ? [] : panel('scoringDistribution', () => readScoringDistribution(leagueId, season), []),
        season == null ? [] : panel('competitiveBalance', () => readCompetitiveBalance(leagueId, season), []),
        panel('seasonComparison', () => readSeasonComparison(leagueId), []),
        panel('transactionsByWeek', () => readTransactionsByWeek(leagueId, providerLeagueId, provider), []),
        panel('managerActivity', () => readManagerActivity(leagueId, providerLeagueId, provider), []),
      ])

    return {
      seasonLabel: season == null ? null : String(season),
      pointsForAgainst,
      scoringDistribution,
      competitiveBalance,
      seasonComparison,
      transactionsByWeek,
      managerActivity,
    }
  } catch {
    // Never let the history half break the KPI half — the page degrades to what it showed before.
    return EMPTY
  }
}
