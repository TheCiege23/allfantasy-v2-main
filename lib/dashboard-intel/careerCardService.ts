import 'server-only'

/**
 * careerCardService — the Manager Career Card: one identity aggregated from
 * the Legacy engines across every imported league.
 *
 *  - All-time record, points, titles, seasons → league history chains
 *  - Trade résumé → graded trade ledger (current grades + net points)
 *  - Draft résumé → draft report cards (current grades + value-over-round)
 *  - League records held → H2H records book (highest week, streaks, blowouts)
 *
 * Every number is the SAME number the corresponding Legacy tab shows — this
 * card only aggregates, never re-derives. Sub-fetches are timeout-bounded
 * (cold caches skip and land in `missing` rather than stall). Cached 1h.
 */

import { prisma } from '@/lib/prisma'
import { getSleeperLeagueHistory } from '@/lib/league-history/sleeperLeagueHistoryService'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import { getImportedLeagueH2H } from '@/lib/league-history/importedFactsH2HService'
import { getTradeGrades, type GradeLetter } from '@/lib/trade-intel/sleeperTradeGradeService'
import { getDraftReport } from '@/lib/draft-intel/draftReportService'

const CACHE_PREFIX = 'career-card:v3:'
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_LEAGUES = 10

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export type GradeCounts = Record<GradeLetter, number>

export type CareerCardPayload = {
  version: 1
  fetchedAt: string
  managerName: string
  avatar: string | null
  leaguesIncluded: number
  allTime: {
    wins: number
    losses: number
    ties: number
    pointsFor: number
    titles: number
    seasons: number
  }
  trades: {
    graded: number
    grades: GradeCounts
    totalNet: number
    ties: number
  }
  drafts: {
    graded: number
    grades: GradeCounts
    totalValueOver: number
  }
  recordsHeld: string[]
  perLeague: {
    leagueId: string
    leagueName: string
    wins: number
    losses: number
    titles: number
  }[]
  /**
   * Per-year aggregation across every included league (same standings rows the
   * allTime block sums — this is the year-by-year view of the same data).
   * Sorted newest first; `leagues` counts leagues contributing that year.
   */
  seasonTotals: {
    season: number
    wins: number
    losses: number
    ties: number
    pointsFor: number
    titles: number
    leagues: number
  }[]
  missing: string[]
}

type SeasonAgg = CareerCardPayload['seasonTotals'][number]

const emptyGrades = (): GradeCounts => ({ A: 0, B: 0, C: 0, D: 0, F: 0 })

async function buildCareerCard(userId: string): Promise<CareerCardPayload | null> {
  const missing: string[] = []
  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  const me = profile?.sleeperUserId ?? null

  const leagues = me
    ? await prisma.league.findMany({
        where: {
          platform: 'sleeper',
          platformLeagueId: { not: '' },
          OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
        },
        select: { id: true, name: true, platformLeagueId: true },
        take: MAX_LEAGUES,
      })
    : []

  // Imported (Yahoo/ESPN/…) leagues count too, via the persisted-facts H2H —
  // the viewer's team is their claimed LeagueTeam, or (for the importer) the
  // provider-side commissioner team. Unmappable leagues land in `missing`.
  const importedLeagues = await prisma.league.findMany({
    where: {
      platform: { notIn: ['sleeper'] },
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      platform: true,
      userId: true,
      teams: { select: { id: true, externalId: true, claimedByUserId: true, isCommissioner: true } },
    },
    take: MAX_LEAGUES,
  })

  if (leagues.length === 0 && importedLeagues.length === 0) return null

  let managerName = 'Manager'
  let avatar: string | null = null
  const allTime = { wins: 0, losses: 0, ties: 0, pointsFor: 0, titles: 0, seasons: 0 }
  const tradeGrades = emptyGrades()
  let tradeNet = 0
  let tradesGraded = 0
  let tradeTies = 0
  const draftGrades = emptyGrades()
  let draftsGraded = 0
  let draftValueOver = 0
  const recordsHeld: string[] = []
  const perLeague: CareerCardPayload['perLeague'] = []
  const seasonMap = new Map<number, SeasonAgg>()
  const bumpSeason = (yr: number, d: Partial<Omit<SeasonAgg, 'season'>>) => {
    if (!Number.isFinite(yr) || yr < 1990) return
    const agg = seasonMap.get(yr) ?? { season: yr, wins: 0, losses: 0, ties: 0, pointsFor: 0, titles: 0, leagues: 0 }
    agg.wins += d.wins ?? 0
    agg.losses += d.losses ?? 0
    agg.ties += d.ties ?? 0
    agg.pointsFor += d.pointsFor ?? 0
    agg.titles += d.titles ?? 0
    agg.leagues += d.leagues ?? 0
    seasonMap.set(yr, agg)
  }
  let included = 0

  for (const league of leagues) {
    const sid = league.platformLeagueId as string
    const [history, h2h, trades, drafts] = await Promise.all([
      withTimeout(getSleeperLeagueHistory(sid), 5000),
      withTimeout(getLeagueH2H(sid), 5000),
      withTimeout(getTradeGrades(sid), 5000),
      withTimeout(getDraftReport(sid), 5000),
    ])
    let touched = false

    if (history) {
      const row = history.allTime.find((r) => r.ownerId === me)
      if (row) {
        touched = true
        allTime.wins += row.wins
        allTime.losses += row.losses
        allTime.ties += row.ties
        allTime.pointsFor += row.pointsFor
        allTime.titles += row.titles
        allTime.seasons += row.seasons
        managerName = row.name || managerName
        avatar = row.avatar ?? avatar
        perLeague.push({
          leagueId: league.id,
          leagueName: league.name ?? 'League',
          wins: row.wins,
          losses: row.losses,
          titles: row.titles,
        })
      }
      // Year-by-year: the same standings rows the allTime block was built from,
      // just kept per season instead of collapsed.
      for (const season of history.seasons) {
        const yr = Number.parseInt(season.season, 10)
        const srow = season.standings.find((s) => s.ownerId === me)
        if (!srow) continue
        bumpSeason(yr, {
          wins: srow.wins,
          losses: srow.losses,
          ties: srow.ties,
          pointsFor: srow.pointsFor,
          titles: season.champion?.ownerId === me ? 1 : 0,
          leagues: 1,
        })
      }
    } else {
      missing.push(`${league.name}: history`)
    }

    if (trades) {
      for (const t of trades.trades) {
        const side = t.sides.find((s) => s.ownerId === me)
        if (side) {
          touched = true
          tradesGraded += 1
          tradeGrades[side.currentGrade] += 1
          tradeNet += side.cumulativeNet
          if (t.tie) tradeTies += 1
        }
      }
    } else {
      missing.push(`${league.name}: trade grades`)
    }

    if (drafts) {
      for (const season of drafts.seasons) {
        const card = season.managers.find((m) => m.ownerId === me)
        if (card) {
          touched = true
          draftsGraded += 1
          draftGrades[card.currentGrade] += 1
          draftValueOver += card.currentScore
        }
      }
    } else {
      missing.push(`${league.name}: draft grades`)
    }

    if (h2h) {
      const r = h2h.records
      if (r.highestWeek?.ownerId === me) {
        recordsHeld.push(`Highest week ever in ${league.name} (${r.highestWeek.points.toFixed(1)})`)
      }
      if (r.longestWinStreak?.ownerId === me) {
        recordsHeld.push(`Longest win streak in ${league.name} (${r.longestWinStreak.length} straight${r.longestWinStreak.active ? ', ACTIVE' : ''})`)
      }
      if (r.biggestBlowout?.winnerOwnerId === me) {
        recordsHeld.push(`Biggest blowout in ${league.name} (by ${r.biggestBlowout.margin.toFixed(1)})`)
      }
      if (r.bestSeasonAvg?.ownerId === me) {
        recordsHeld.push(`Best season avg in ${league.name} (${r.bestSeasonAvg.avg.toFixed(1)}/wk, ${r.bestSeasonAvg.season})`)
      }
    }

    if (touched) included += 1
  }

  // ── Imported leagues: standings facts (exact W/L/T/PF), titles from
  //    LeagueSeason champions, records held from the facts-based H2H. Trade and
  //    draft GRADES are intentionally absent for these — imported provider data
  //    has no per-player scoring, and this card never re-derives or guesses.
  for (const league of importedLeagues) {
    const myTeam =
      league.teams.find((t) => t.claimedByUserId === userId) ??
      (league.userId === userId ? league.teams.find((t) => t.isCommissioner) : undefined)
    if (!myTeam?.externalId) {
      missing.push(`${league.name}: claim your team to count this imported league`)
      continue
    }

    const [standings, championSeasons, h2h] = await Promise.all([
      prisma.seasonStandingFact
        .findMany({
          where: { leagueId: league.id, teamId: myTeam.externalId },
          select: { season: true, wins: true, losses: true, ties: true, pointsFor: true },
        })
        .catch(() => []),
      prisma.leagueSeason
        .findMany({ where: { leagueId: league.id, championTeamId: myTeam.id }, select: { season: true } })
        .catch(() => [] as { season: number }[]),
      withTimeout(getImportedLeagueH2H(league.id), 5000),
    ])
    const titles = championSeasons.length

    if (standings.length === 0 && !h2h) {
      missing.push(`${league.name}: imported history not backfilled yet`)
      continue
    }

    let leagueWins = 0
    let leagueLosses = 0
    const titleYears = new Set(championSeasons.map((c) => c.season))
    for (const row of standings) {
      leagueWins += row.wins
      leagueLosses += row.losses
      allTime.wins += row.wins
      allTime.losses += row.losses
      allTime.ties += row.ties
      allTime.pointsFor += row.pointsFor
      allTime.seasons += 1
      bumpSeason(row.season, {
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        pointsFor: row.pointsFor,
        titles: titleYears.has(row.season) ? 1 : 0,
        leagues: 1,
      })
    }
    allTime.titles += titles

    if (h2h) {
      const r = h2h.records
      const meKey = myTeam.externalId
      if (r.highestWeek?.ownerId === meKey) {
        recordsHeld.push(`Highest week ever in ${league.name} (${r.highestWeek.points.toFixed(1)})`)
      }
      if (r.longestWinStreak?.ownerId === meKey) {
        recordsHeld.push(`Longest win streak in ${league.name} (${r.longestWinStreak.length} straight${r.longestWinStreak.active ? ', ACTIVE' : ''})`)
      }
      if (r.biggestBlowout?.winnerOwnerId === meKey) {
        recordsHeld.push(`Biggest blowout in ${league.name} (by ${r.biggestBlowout.margin.toFixed(1)})`)
      }
      if (r.bestSeasonAvg?.ownerId === meKey) {
        recordsHeld.push(`Best season avg in ${league.name} (${r.bestSeasonAvg.avg.toFixed(1)}/wk, ${r.bestSeasonAvg.season})`)
      }
    }

    perLeague.push({
      leagueId: league.id,
      leagueName: league.name ?? 'League',
      wins: leagueWins,
      losses: leagueLosses,
      titles,
    })
    missing.push(`${league.name}: trade/draft grades unavailable for imported leagues (no per-player scoring)`)
    included += 1
  }

  if (included === 0) return null

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    managerName,
    avatar,
    leaguesIncluded: included,
    allTime: {
      ...allTime,
      pointsFor: Math.round(allTime.pointsFor),
    },
    trades: {
      graded: tradesGraded,
      grades: tradeGrades,
      totalNet: Math.round(tradeNet * 10) / 10,
      ties: tradeTies,
    },
    drafts: {
      graded: draftsGraded,
      grades: draftGrades,
      totalValueOver: Math.round(draftValueOver),
    },
    recordsHeld,
    perLeague: perLeague.sort((a, b) => b.wins - a.wins),
    seasonTotals: [...seasonMap.values()]
      .map((s) => ({ ...s, pointsFor: Math.round(s.pointsFor) }))
      .sort((a, b) => b.season - a.season),
    missing,
  }
}

/** Cached accessor (1h per user); `force` bypasses. */
export async function getCareerCard(
  userId: string,
  options?: { force?: boolean },
): Promise<CareerCardPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${userId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as CareerCardPayload)
      : null
  if (!options?.force && cachedPayload?.version === 1 && cached && cached.expiresAt > now) {
    return cachedPayload
  }
  const fresh = await buildCareerCard(userId).catch((err) => {
    console.error('[career-card] build failed', { userId, err })
    return null
  })
  if (fresh) {
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey },
        update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
        create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
      })
      .catch(() => null)
    return fresh
  }
  return cachedPayload?.version === 1 ? cachedPayload : null
}
