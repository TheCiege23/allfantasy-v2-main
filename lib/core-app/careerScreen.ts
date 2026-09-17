import 'server-only'

import {
  buildCareerData,
  isUnfiltered,
  loadCareerSource,
  matchesCareerFilter,
  type CareerData,
  type CareerFilter,
  type CareerRow,
  type CareerSource,
} from '@/lib/core-app/career'
import {
  loadCareerTradeCounts,
  readCareerProfile,
  sleeperTradeKeys,
  type CareerTradeCount,
} from '@/lib/core-app/careerProfile'
import { computeCareerAwards, type CareerAward } from '@/lib/core-app/careerAwards'
import { getCareerRecords, WEEKLY_MISSING } from '@/lib/core-app/careerRecords'
import { readCareerRecordsSummary } from '@/lib/core-app/careerRecordsSummary'
import {
  draftRecords,
  seasonRecords,
  tradeRecords,
  type CareerRecord,
  type CareerRecordsData,
} from '@/lib/core-app/careerRecordBook'
import { loadCareerHistory, type CareerHistory } from '@/lib/core-app/careerHistory'
import { buildCareerTimeline, parseTimelineKind, type CareerTimeline } from '@/lib/core-app/careerTimeline'
import { getCareerPeers, type CareerPeers } from '@/lib/core-app/careerPeers'
import { prisma } from '@/lib/prisma'
import { isEnabled, DEFAULT_ROLLOUTS } from '@/lib/sports-os/rollout'

/**
 * `/core/career` — what each tab needs, and nothing else.
 *
 * The overview is one stored-profile read plus identity. The heavier loaders
 * (weekly games, graded trades, drafts, the community board) only run on the tab
 * that shows them, because a trophy room that re-reads every matchup of a
 * nine-season career on every visit is the cost item 9 exists to remove.
 */

export const CAREER_VIEWS = [
  'overview',
  'timeline',
  'seasons',
  'progress',
  'peers',
  'records',
  'awards',
  'coverage',
  'hall',
  'share',
] as const
export type CareerView = (typeof CAREER_VIEWS)[number]

export function parseCareerView(raw: unknown): CareerView {
  return typeof raw === 'string' && (CAREER_VIEWS as readonly string[]).includes(raw) ? (raw as CareerView) : 'overview'
}

export type CareerRecordBook = {
  weekly: CareerRecordsData | null
  seasons: CareerRecord[]
  trades: CareerRecord[]
  drafts: CareerRecord[]
  missing: CareerRecordsData['missing']
  ungradedLeagues: number
}

export type CareerCoverageExtras = {
  weeklySeasons: CareerRecordsData['weeklySeasons']
  draftSeasons: number[]
  tradeSeasons: number[]
  gradedTrades: number
  ungradedLeagues: number
  picksOnFile: number
}

export type CareerScreenData = {
  view: CareerView
  data: CareerData
  awards: CareerAward[]
  trades: CareerTradeCount[]
  profile: { builtAt: string | null; origin: 'stored' | 'built' | 'live' }
  timeline: CareerTimeline | null
  records: CareerRecordBook | null
  peers: CareerPeers | null
  coverage: CareerCoverageExtras | null
}

/** Trade counts narrowed the way the rows are. Trades are Sleeper-only. */
export function filterTradeCounts(trades: CareerTradeCount[], f: CareerFilter, rows: CareerRow[]): CareerTradeCount[] {
  if (f.platform && f.platform !== 'sleeper') return []
  const sportByKey = new Map(rows.map((r) => [r.leagueKey, r.sport]))
  return trades.filter((t) => {
    if (f.fromSeason != null && t.season < f.fromSeason) return false
    if (f.toSeason != null && t.season > f.toSeason) return false
    if (f.league && t.leagueKey !== f.league) return false
    if (f.sport && (!t.leagueKey || sportByKey.get(t.leagueKey) !== f.sport)) return false
    return true
  })
}

async function loadSource(userId: string): Promise<{
  source: CareerSource
  trades: CareerTradeCount[]
  profile: CareerScreenData['profile']
}> {
  if (process.env.CORE_CAREER_PROFILE_DISABLED !== '1') {
    try {
      const p = await readCareerProfile(userId)
      return { source: p.source, trades: p.trades, profile: { builtAt: p.builtAt, origin: p.origin } }
    } catch (err) {
      // The store is a cache. If it cannot be read, the page still can.
      console.error('[core-app/careerScreen] profile read failed, reading live', err)
    }
  }
  const source = await loadCareerSource(userId)
  const legacy = await prisma.appUser
    .findUnique({ where: { id: userId }, select: { legacyUserId: true } })
    .catch(() => null)
  const keys = await sleeperTradeKeys(legacy?.legacyUserId ?? null)
  const trades = await loadCareerTradeCounts(keys, source.rows).catch(() => [])
  return { source, trades, profile: { builtAt: null, origin: 'live' } }
}

async function historyFor(userId: string, filter: CareerFilter, source: CareerSource): Promise<CareerHistory | null> {
  const legacy = await prisma.appUser
    .findUnique({ where: { id: userId }, select: { legacyUserId: true } })
    .catch(() => null)
  const tradeKeys = await sleeperTradeKeys(legacy?.legacyUserId ?? null)
  const leagueByProvider = new Map<string, { key: string; name: string; platform: string; sport: string | null }>()
  for (const r of source.rows) {
    if (r.providerLeagueId) {
      leagueByProvider.set(r.providerLeagueId, { key: r.leagueKey, name: r.leagueName, platform: r.platform, sport: r.sport })
    }
  }
  return loadCareerHistory(userId, { filter, tradeKeys, leagueByProvider }).catch((err: unknown) => {
    console.error('[core-app/careerScreen] history read failed', err)
    return null
  })
}

async function weeklyFor(userId: string, filter: CareerFilter): Promise<CareerRecordsData | null> {
  /*
   * The unfiltered book is cached per user (`careerRecordsSummary`); a filtered
   * one is read live, because every filter combination is its own answer and a
   * cache keyed on all of them would mostly hold one-off entries.
   */
  if (isUnfiltered(filter) && isEnabled('sports-os.screen-summaries', userId, DEFAULT_ROLLOUTS)) {
    const fresh = await readCareerRecordsSummary(userId).catch(() => null)
    if (fresh?.data) return fresh.data
  }
  return getCareerRecords(userId, filter).catch((err: unknown) => {
    console.error('[core-app/careerScreen] weekly records read failed', err)
    return null
  })
}

export async function getCareerScreen(
  userId: string,
  filter: CareerFilter,
  view: CareerView,
  sp: Record<string, string | string[] | undefined> = {},
): Promise<CareerScreenData> {
  const { source, trades: allTrades, profile } = await loadSource(userId)
  const data = buildCareerData(source, filter)
  const filteredRows = source.rows.filter((r) => matchesCareerFilter(r, filter))
  const trades = filterTradeCounts(allTrades, filter, source.rows)
  const awards = computeCareerAwards({ rows: filteredRows, trades })

  let timeline: CareerTimeline | null = null
  let records: CareerRecordBook | null = null
  let peers: CareerPeers | null = null
  let coverage: CareerCoverageExtras | null = null

  if (view === 'timeline') {
    const [history, weekly] = await Promise.all([historyFor(userId, filter, source), weeklyFor(userId, filter)])
    timeline = buildCareerTimeline({
      rows: filteredRows,
      awards,
      trades: history?.trades ?? [],
      tradesOmitted: history?.tradesOmitted ?? 0,
      drafts: history?.drafts ?? [],
      rivals: weekly?.rivals ?? [],
      kind: parseTimelineKind(typeof sp.kind === 'string' ? sp.kind : null),
    })
  }

  if (view === 'records') {
    const [history, weekly] = await Promise.all([historyFor(userId, filter, source), weeklyFor(userId, filter)])
    records = {
      weekly,
      seasons: seasonRecords(filteredRows),
      trades: tradeRecords(trades, history?.graded ?? []),
      drafts: draftRecords(history?.draftCards ?? [], history?.steals ?? [], history?.picksOnFile ?? 0),
      missing: [
        ...(weekly?.missing ?? WEEKLY_MISSING),
        ...(history && history.draftCards.length === 0
          ? [
              {
                label: 'Draft grades',
                section: 'drafts' as const,
                reason:
                  'draft report cards exist only for Sleeper leagues whose draft report has been built — none of yours has one yet',
              },
            ]
          : []),
      ],
      ungradedLeagues: history?.ungradedLeagues ?? 0,
    }
  }

  if (view === 'peers' || view === 'progress') {
    peers = await getCareerPeers(userId, filter).catch((err: unknown) => {
      console.error('[core-app/careerScreen] peers read failed', err)
      return null
    })
  }

  if (view === 'coverage') {
    const [history, weekly] = await Promise.all([historyFor(userId, filter, source), weeklyFor(userId, filter)])
    coverage = {
      weeklySeasons: weekly?.weeklySeasons ?? [],
      draftSeasons: history?.draftSeasons ?? [],
      tradeSeasons: history?.tradeSeasons ?? [],
      gradedTrades: history?.graded.length ?? 0,
      ungradedLeagues: history?.ungradedLeagues ?? 0,
      picksOnFile: history?.picksOnFile ?? 0,
    }
  }

  return { view, data, awards, trades, profile, timeline, records, peers, coverage }
}

/**
 * The award share images' data (`/api/share/career-card?design=award|awards`).
 *
 * ⚠ THE SAME PROFILE, THE SAME SCORER, NO FILTER. An image leaves the product, so
 * it describes the whole career — the one the overview shows with no filter set.
 */
export async function getCareerAwardCards(userId: string): Promise<{
  handle: string
  awards: CareerAward[]
  record: string | null
  titles: number
  seasons: number
} | null> {
  const { source, trades } = await loadSource(userId)
  const data = buildCareerData(source)
  if (data.isEmpty) return null
  return {
    handle: data.handle ?? 'manager',
    awards: computeCareerAwards({ rows: source.rows, trades }),
    record: data.accomplishments.record,
    titles: data.championships,
    seasons: data.seasonsPlayed,
  }
}
