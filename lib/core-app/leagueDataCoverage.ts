/**
 * What AllFantasy actually holds for one imported league, per kind of history.
 *
 * ── WHY THIS IS NOT `importCoverageSummary` ─────────────────────────────────────
 *
 * `importCoverageSummary` answers "what did the provider say it could give us", from a block
 * persisted at import time. Three things stop that being the answer to "what can I see":
 *
 * 1. Most leagues have no block. It was persisted from a later release, and the summary
 *    deliberately treats absence as "don't know" — so for most of the product it says nothing.
 * 2. It has no bucket for lineups or for adds/drops/waivers, and no seasons at all.
 * 3. A provider can publish something our importer has not fetched yet, or fetched for one
 *    season and not another.
 *
 * So this reads the tables the screens read. The provider's claim is used for exactly one
 * thing: telling "the platform does not publish this" apart from "nothing is on file".
 *
 * ── SIX ANSWERS, NOT TWO ────────────────────────────────────────────────────────
 *
 * A row is `available`, or it is empty for one of five different reasons, and each one asks
 * the reader for something different:
 *
 *   importing      wait                    — the first sync has not landed
 *   not_published  stop looking            — the platform does not give this out
 *   unsupported    not yet, and it's us    — we do not import this for that platform
 *   none           nothing to see          — we looked, and there is none
 *   unknown        try again               — the read failed, or the last sync did
 *
 * Collapsing any two of these tells someone to wait for something that will never arrive, or
 * to give up on something that lands on Sunday.
 *
 * ── ID SPACES ────────────────────────────────────────────────────────────────────
 *
 * 🛑 `WeeklyMatchup` and `LeaguePlayerWeeklyScore` key on the PROVIDER league id
 * (`League.platformLeagueId`); every `dw_*` fact table, `LeagueSeason` and
 * `LeagueDynastySeason` key on `League.id`. Checked against each writer, not assumed — see
 * `leagueDataSignals.ts` and `leagueStandings.ts`, which read the same tables the same way.
 * Querying a provider-keyed table with `League.id` returns zero rows and no error, which is
 * indistinguishable from a league that has no history.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { readImportCoverage } from '@/lib/league-import/importCoverageSummary'
import type { ImportCoverage, ImportCoverageKey } from '@/lib/league-import/types'
import { isImportedPlatform } from '@/lib/league/isNativeLeague'
import { platformLabel } from '@/lib/core-app/platformLinks'

export type LeagueDataCoverageKey = 'seasons' | 'standings' | 'drafts' | 'trades' | 'transactions' | 'lineups'

export type LeagueDataCoverageStatus = 'available' | 'importing' | 'not_published' | 'unsupported' | 'none' | 'unknown'

export type LeagueDataCoverageRow = {
  key: LeagueDataCoverageKey
  label: string
  status: LeagueDataCoverageStatus
  /** Seasons holding data, ascending. Empty for every status but `available`. */
  seasons: number[]
  /** One line under the label, in the league's own terms. */
  detail: string
}

export type LeagueDataCoverage = {
  platformLabel: string
  rows: LeagueDataCoverageRow[]
}

/**
 * A measured set of seasons, or `null` when the read failed.
 *
 * `undated` counts rows with no season on them — some writers leave `season` null, and those
 * rows are still data. Without it a league whose only trades are undated would read as having
 * none.
 */
export type SeasonRead = { seasons: number[]; undated: number } | null

export type LeagueDataCoverageInput = {
  platform: string | null | undefined
  /** `League.syncStatus` and `League.lastSyncedAt`, for the importing / failed-sync cases. */
  syncStatus: string | null | undefined
  lastSyncedAt: Date | string | null | undefined
  /** The persisted provider block, when the league has one. */
  providerCoverage: ImportCoverage | null
  standings: SeasonRead
  drafts: SeasonRead
  trades: SeasonRead
  transactions: SeasonRead
  /** Weeks with a starting lineup, per season. */
  lineups: { weeksBySeason: Map<number, number> } | null
  /** Seasons known from season records and scored matchups — only feeds the Seasons row. */
  otherSeasons: SeasonRead
}

const LABELS: Record<LeagueDataCoverageKey, string> = {
  seasons: 'Seasons',
  standings: 'Standings',
  drafts: 'Drafts',
  trades: 'Trades',
  transactions: 'Adds, drops & waivers',
  lineups: 'Weekly lineups',
}

const ORDER: readonly LeagueDataCoverageKey[] = ['seasons', 'standings', 'drafts', 'trades', 'transactions', 'lineups']

/**
 * The provider bucket that can say "we don't publish this".
 *
 * ⚠ ONLY WHERE THE BUCKET MEANS THE SAME THING AS THE ROW. `transactions` and `lineups` have
 * no bucket at all, and `previousSeasons` is not mapped to Seasons because the current season
 * is always a season — a platform without history still has one.
 */
const PROVIDER_BUCKET: Partial<Record<LeagueDataCoverageKey, ImportCoverageKey>> = {
  standings: 'currentStandings',
  drafts: 'draftHistory',
  trades: 'tradeHistory',
}

/**
 * Which platforms any writer fills a row for. Absent means every imported platform.
 *
 * ⚠ LINEUPS ARE SLEEPER-ONLY TODAY: `ingestSleeperPlayerScores` is the one writer of
 * `LeaguePlayerWeeklyScore`, and the model's own comment says espn/yahoo "would each add
 * their own". An ESPN league with no lineups is our gap, not ESPN's — `unsupported`, never
 * `not_published`.
 */
const WRITTEN_FOR: Partial<Record<LeagueDataCoverageKey, ReadonlySet<string>>> = {
  lineups: new Set(['sleeper']),
}

/** "2021–2025", or "2019, 2021 and 2023" when there are gaps. */
export function describeSeasons(seasons: readonly number[]): string {
  const sorted = [...new Set(seasons)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return String(sorted[0])
  const contiguous = sorted.every((s, i) => i === 0 || s === sorted[i - 1]! + 1)
  if (contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const NONE_DETAIL: Record<LeagueDataCoverageKey, string> = {
  seasons: 'No season records on file for this league yet.',
  standings: 'No scored weeks or final standings on file.',
  drafts: 'No draft results on file.',
  trades: 'No completed trades on file.',
  transactions: 'No adds, drops or waiver claims on file.',
  lineups: 'No weekly lineups on file.',
}

function availableDetail(key: LeagueDataCoverageKey, read: { seasons: number[]; undated: number }, weeks?: number): string {
  const range = describeSeasons(read.seasons)
  const parts: string[] = []
  if (range) {
    parts.push(read.seasons.length === 1 ? `Season ${range}` : `Seasons ${range}`)
  }
  if (key === 'lineups' && weeks != null) parts.push(plural(weeks, 'week', 'weeks'))
  if (read.undated > 0) {
    parts.push(range ? `plus ${plural(read.undated, 'record', 'records')} with no season` : 'On file, season not recorded')
  }
  return parts.join(' · ')
}

/**
 * The six rows, from what was measured. Pure — the loader below only gathers inputs.
 *
 * Returns `null` for a native league: nothing about it was imported, so "import coverage" has
 * no subject, and an all-`unsupported` panel would read as six failures.
 */
export function buildLeagueDataCoverage(input: LeagueDataCoverageInput): LeagueDataCoverage | null {
  if (!isImportedPlatform(input.platform)) return null

  const platformKey = String(input.platform ?? '').trim().toLowerCase()
  const label = platformLabel(input.platform)
  /*
   * ⚠ BOTH HALVES. `pending` is what the commit writes before the first resync, and it is
   * only still true while nothing has synced. A league stuck at `pending` with a sync time
   * has synced — `pending` there is a stale label, not an import in flight.
   */
  const importing = input.syncStatus === 'pending' && !input.lastSyncedAt
  const syncFailed = input.syncStatus === 'error'

  const lineupRead: SeasonRead = input.lineups
    ? { seasons: [...input.lineups.weeksBySeason.keys()], undated: 0 }
    : null
  const lineupWeeks = input.lineups
    ? [...input.lineups.weeksBySeason.values()].reduce((sum, n) => sum + n, 0)
    : undefined

  const reads: Record<Exclude<LeagueDataCoverageKey, 'seasons'>, SeasonRead> = {
    standings: input.standings,
    drafts: input.drafts,
    trades: input.trades,
    transactions: input.transactions,
    lineups: lineupRead,
  }

  /*
   * Seasons is the union of everything else. A season is "available" if ANY kind of history
   * exists for it — which is the question a reader scanning for "do you have 2019" is asking.
   * ⚠ A FAILED READ DOES NOT MAKE THE UNION UNKNOWN: the seasons we did read are still true.
   * Only when every read failed is the row unknown.
   */
  const allReads = [input.otherSeasons, ...Object.values(reads)]
  const seasonsRead: SeasonRead = allReads.every((r) => r == null)
    ? null
    : {
        seasons: [...new Set(allReads.flatMap((r) => r?.seasons ?? []))].sort((a, b) => a - b),
        undated: 0,
      }

  const rowFor = (key: LeagueDataCoverageKey): LeagueDataCoverageRow => {
    const read = key === 'seasons' ? seasonsRead : reads[key]
    const base = { key, label: LABELS[key], seasons: [] as number[] }

    if (read && (read.seasons.length > 0 || read.undated > 0)) {
      const seasons = [...read.seasons].sort((a, b) => a - b)
      return {
        ...base,
        status: 'available',
        seasons,
        detail: availableDetail(key, { seasons, undated: read.undated }, key === 'lineups' ? lineupWeeks : undefined),
      }
    }

    /* Nothing on file. Now say WHY, most specific reason first. */

    const writtenFor = WRITTEN_FOR[key]
    if (writtenFor && !writtenFor.has(platformKey)) {
      return {
        ...base,
        status: 'unsupported',
        detail: `AllFantasy doesn’t import ${LABELS[key].toLowerCase()} from ${label} yet.`,
      }
    }

    const bucket = PROVIDER_BUCKET[key]
    if (bucket && input.providerCoverage?.[bucket]?.state === 'missing') {
      return {
        ...base,
        status: 'not_published',
        // ⚠ Not "<Platform> doesn't publish…": `missing` only means this import did not bring it
        // across. See the header of lib/league-import/importCoverageSummary.ts.
        detail: `We couldn’t bring across ${key === 'standings' ? 'standings' : key === 'drafts' ? 'draft results' : 'trade history'} from ${label} for this league yet.`,
      }
    }

    if (importing) {
      return { ...base, status: 'importing', detail: 'Still importing — this fills in after the first sync.' }
    }

    /*
     * ⚠ UNKNOWN BEFORE NONE. A failed read is not evidence of absence, and neither is an empty
     * table behind a sync that errored — the rows may exist on the platform and simply not have
     * been read.
     */
    if (read == null) {
      return { ...base, status: 'unknown', detail: 'Couldn’t check just now.' }
    }
    if (syncFailed) {
      return {
        ...base,
        status: 'unknown',
        detail: `The last ${label} sync failed, so this may exist and not have been read.`,
      }
    }

    return { ...base, status: 'none', detail: NONE_DETAIL[key] }
  }

  return { platformLabel: label, rows: ORDER.map(rowFor) }
}

/* ── The reads ─────────────────────────────────────────────────────────────── */

type SeasonGroup = { season: number | null; _count: { _all: number } }

function toSeasonRead(groups: SeasonGroup[]): SeasonRead {
  const seasons: number[] = []
  let undated = 0
  for (const g of groups) {
    if (g.season == null) undated += g._count._all
    else seasons.push(g.season)
  }
  return { seasons, undated }
}

const orNull = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

export type LeagueDataCoverageRecord = {
  id: string
  platform: string | null
  platformLeagueId: string | null
  settings: unknown
  syncStatus: string | null
  lastSyncedAt: Date | null
}

/**
 * Reads everything `buildLeagueDataCoverage` needs for one league.
 *
 * Takes the league RECORD rather than an id: `/core` already reads this row once per render
 * for its shell, and a third read of it here is the pattern that shell read exists to end.
 *
 * Nine indexed, league-scoped aggregates, in parallel, no provider call. Each degrades to
 * `null` on its own, so one failed read marks one row unknown rather than blanking the panel.
 * Returns `null` for a native league without issuing any of them.
 */
export async function getLeagueDataCoverage(league: LeagueDataCoverageRecord): Promise<LeagueDataCoverage | null> {
  if (!isImportedPlatform(league.platform)) return null

  const leagueId = league.id
  const pid = league.platformLeagueId

  const [standingFacts, weeklySeasons, drafts, trades, transactions, lineupWeeks, seasonRows, dynastyRows, scoredMatchups] =
    await Promise.all([
      orNull(
        prisma.seasonStandingFact.groupBy({
          by: ['season'],
          where: { leagueId },
          _sum: { wins: true, losses: true, ties: true, pointsFor: true },
        }),
      ),
      pid
        ? orNull(prisma.weeklyMatchup.groupBy({ by: ['seasonYear'], where: { leagueId: pid } }))
        : Promise.resolve([] as Array<{ seasonYear: number }>),
      orNull(prisma.draftFact.groupBy({ by: ['season'], where: { leagueId }, _count: { _all: true } })),
      orNull(
        prisma.transactionFact.groupBy({
          by: ['season'],
          where: { leagueId, type: 'trade' },
          _count: { _all: true },
        }),
      ),
      orNull(
        prisma.transactionFact.groupBy({
          by: ['season'],
          where: { leagueId, type: { not: 'trade' } },
          _count: { _all: true },
        }),
      ),
      pid
        ? orNull(
            prisma.leaguePlayerWeeklyScore.groupBy({
              by: ['seasonYear', 'week'],
              where: { leagueId: pid, isStarter: true },
            }),
          )
        : Promise.resolve([] as Array<{ seasonYear: number; week: number }>),
      orNull(prisma.leagueSeason.findMany({ where: { leagueId }, select: { season: true } })),
      orNull(prisma.leagueDynastySeason.findMany({ where: { leagueId }, select: { season: true } })),
      orNull(
        prisma.matchupFact.groupBy({
          by: ['season'],
          where: { leagueId, OR: [{ scoreA: { not: 0 } }, { scoreB: { not: 0 } }] },
          _count: { _all: true },
        }),
      ),
    ])

  /*
   * Standings are what the Standings tab can draw: any season with weekly results, plus any
   * PLAYED season in the final-standings facts. ⚠ The ESPN backfill writes 0-0 rows for a
   * season that has not kicked off (see `loadSeasonHistory`), so an all-zero season is not a
   * standings season — the same filter the tab applies, or this panel would promise a table
   * the tab then refuses to show.
   */
  const standings: SeasonRead =
    standingFacts == null && weeklySeasons == null
      ? null
      : {
          seasons: [
            ...(weeklySeasons ?? []).map((r) => r.seasonYear),
            ...(standingFacts ?? [])
              .filter((r) => (r._sum.wins ?? 0) + (r._sum.losses ?? 0) + (r._sum.ties ?? 0) > 0 || (r._sum.pointsFor ?? 0) > 0)
              .map((r) => r.season),
          ].filter((s, i, all) => all.indexOf(s) === i),
          undated: 0,
        }

  const weeksBySeason = new Map<number, number>()
  for (const row of lineupWeeks ?? []) {
    weeksBySeason.set(row.seasonYear, (weeksBySeason.get(row.seasonYear) ?? 0) + 1)
  }

  const otherSeasonReads = [seasonRows, dynastyRows, scoredMatchups]
  const otherSeasons: SeasonRead = otherSeasonReads.every((r) => r == null)
    ? null
    : {
        seasons: [
          ...(seasonRows ?? []).map((r) => r.season),
          ...(dynastyRows ?? []).map((r) => r.season),
          ...(scoredMatchups ?? []).flatMap((r) => (r.season == null ? [] : [r.season])),
        ],
        undated: 0,
      }

  return buildLeagueDataCoverage({
    platform: league.platform,
    syncStatus: league.syncStatus,
    lastSyncedAt: league.lastSyncedAt,
    providerCoverage: readImportCoverage(league.settings),
    standings,
    drafts: drafts ? toSeasonRead(drafts) : null,
    trades: trades ? toSeasonRead(trades) : null,
    transactions: transactions ? toSeasonRead(transactions) : null,
    lineups: lineupWeeks ? { weeksBySeason } : null,
    otherSeasons,
  })
}
