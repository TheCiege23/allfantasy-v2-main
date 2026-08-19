import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import {
  getSeasonStatsBoard,
  scoreStatLine,
  type SeasonStatsBoard,
} from '@/lib/sports-data/sleeperMarketService'

/**
 * draftReportService — feature 5: retro draft report cards for EVERY draft in
 * the league's history, graded and then RE-graded every season after.
 *
 * The yardstick is deliberately simple and fully checkable:
 *  - A pick's value = the player's league-scored season points (IDP included).
 *  - A pick's EXPECTED value = the median of what that same round's picks
 *    produced that season (round median). Value-over-round = actual − median.
 *  - INITIAL grade = draft-year value-over-round summed per manager.
 *  - CURRENT grade = the same computed on cumulative points since the draft
 *    (dynasty/keeper leagues keep accruing; redraft drafts grade their own
 *    season only) — so a draft that aged well climbs and one that aged badly
 *    sinks, per manager, with an explicit trend.
 *  - Steals and busts = the largest positive/negative value-over-round picks,
 *    league-wide per draft.
 *
 * The letter scale ships in the payload; the current season is flagged
 * partial and everything re-grades on the 6h cache cycle, forever.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const CACHE_PREFIX = 'draft-report:v1:'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_CHAIN = 12

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type WireLeague = {
  league_id: string
  season: string
  status: string
  previous_league_id?: string | null
}
type WireUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}
type WireDraft = { draft_id: string; season: string; status: string }
type WireDraftPick = {
  round: number
  pick_no: number
  player_id?: string | null
  picked_by?: string | null
  metadata?: {
    first_name?: string | null
    last_name?: string | null
    position?: string | null
  } | null
}

export type DraftGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F'

export type DraftPickGrade = {
  pickNo: number
  round: number
  playerId: string | null
  playerName: string
  position: string | null
  byOwnerId: string | null
  byName: string
  /** Draft-year points and value-over-round-median (the initial read). */
  initialPoints: number | null
  initialValueOver: number | null
  /** Cumulative since the draft (equals initial in redraft leagues). */
  currentPoints: number | null
  currentValueOver: number | null
}

export type DraftManagerCard = {
  ownerId: string
  name: string
  avatar: string | null
  teamName: string | null
  picks: number
  initialScore: number
  currentScore: number
  initialGrade: DraftGradeLetter
  currentGrade: DraftGradeLetter
  trend: 'improved' | 'declined' | 'steady'
}

export type DraftReportSeason = {
  season: string
  draftId: string
  rounds: number
  totalPicks: number
  gradedPicks: number
  partial: boolean
  managers: DraftManagerCard[]
  steals: DraftPickGrade[]
  busts: DraftPickGrade[]
}

export type DraftReportPayload = {
  version: 1
  fetchedAt: string
  staleAsOf: string | null
  sleeperLeagueId: string
  dynastyLike: boolean
  gradeScale: {
    description: string
    thresholds: { letter: DraftGradeLetter; minAvgPerPick: number | null }[]
  }
  seasons: DraftReportSeason[]
  missing: string[]
}

function letterFor(avgPerPick: number): DraftGradeLetter {
  if (avgPerPick >= 25) return 'A'
  if (avgPerPick >= 10) return 'B'
  if (avgPerPick > -10) return 'C'
  if (avgPerPick > -25) return 'D'
  return 'F'
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function buildDraftReport(sleeperLeagueId: string): Promise<DraftReportPayload | null> {
  const missing: string[] = []
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null
  const scoring = context.scoring.settings
  const format = context.scoring.format
  const dynastyLike = context.variant.dynasty || context.variant.keeper

  // Chain oldest → newest.
  const chain: WireLeague[] = []
  let cursor: string | null = sleeperLeagueId
  for (let i = 0; i < MAX_CHAIN && cursor; i += 1) {
    // Explicit annotation breaks a circular inference: `cursor` builds the URL
    // that yields `league`, and `league.previous_league_id` reassigns `cursor`,
    // so TS cannot resolve either without the other and silently widens to any.
    const league: WireLeague | null = await j<WireLeague>(`/league/${cursor}`)
    if (!league) {
      missing.push('part of the league chain')
      break
    }
    chain.unshift(league)
    cursor = league.previous_league_id ?? null
  }
  if (chain.length === 0) return null

  // Stats boards for every season we grade against.
  const boards = new Map<string, SeasonStatsBoard>()
  for (const league of chain) {
    const complete = String(league.status).toLowerCase() === 'complete'
    const board = await getSeasonStatsBoard(league.season, complete)
    if (board) boards.set(league.season, board)
    else missing.push(`${league.season}: season stats`)
  }
  const pointsIn = (playerId: string, season: string): number | null => {
    const row = boards.get(season)?.players[playerId]
    if (!row) return null
    return Math.round(scoreStatLine(row.stats, scoring, format).points * 10) / 10
  }

  const seasonsOut: DraftReportSeason[] = []
  for (const league of chain) {
    const [users, drafts] = await Promise.all([
      j<WireUser[]>(`/league/${league.league_id}/users`),
      j<WireDraft[]>(`/league/${league.league_id}/drafts`),
    ])
    const draft = (drafts ?? []).find((d) => d.status === 'complete') ?? null
    if (!draft) continue
    const picks = await j<WireDraftPick[]>(`/draft/${draft.draft_id}/picks`)
    if (!picks || picks.length === 0) {
      missing.push(`${league.season}: draft picks`)
      continue
    }
    const usersById = new Map((users ?? []).map((u) => [u.user_id, u]))

    // Grading seasons for this draft.
    const gradedSeasons = chain
      .filter((c) => c.season >= league.season && (dynastyLike || c.season === league.season))
      .map((c) => c.season)
    const partial = gradedSeasons.some(
      (s) => String(chain.find((c) => c.season === s)?.status).toLowerCase() !== 'complete',
    )

    // Raw per-pick points.
    const rawPicks = picks.map((p) => {
      const playerId = p.player_id ?? null
      const initialPoints = playerId ? pointsIn(playerId, league.season) : null
      let currentPoints: number | null = null
      if (playerId) {
        let sum = 0
        let any = false
        for (const s of gradedSeasons) {
          const pts = pointsIn(playerId, s)
          if (pts != null) {
            sum += pts
            any = true
          }
        }
        currentPoints = any ? Math.round(sum * 10) / 10 : null
      }
      return { p, playerId, initialPoints, currentPoints }
    })

    // Round medians (initial + cumulative) from picks with data.
    const initialMedianByRound = new Map<number, number>()
    const currentMedianByRound = new Map<number, number>()
    const rounds = Math.max(...picks.map((p) => p.round))
    for (let r = 1; r <= rounds; r += 1) {
      const inRound = rawPicks.filter((x) => x.p.round === r)
      const mi = median(inRound.map((x) => x.initialPoints).filter((v): v is number => v != null))
      const mc = median(inRound.map((x) => x.currentPoints).filter((v): v is number => v != null))
      if (mi != null) initialMedianByRound.set(r, mi)
      if (mc != null) currentMedianByRound.set(r, mc)
    }

    const gradedPicksList: DraftPickGrade[] = rawPicks.map(({ p, playerId, initialPoints, currentPoints }) => {
      const mi = initialMedianByRound.get(p.round)
      const mc = currentMedianByRound.get(p.round)
      const byUser = p.picked_by ? usersById.get(p.picked_by) : undefined
      return {
        pickNo: p.pick_no,
        round: p.round,
        playerId,
        playerName:
          [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(' ').trim() || 'Player',
        position: p.metadata?.position?.toUpperCase() ?? null,
        byOwnerId: p.picked_by ?? null,
        byName: byUser?.display_name ?? 'Manager',
        initialPoints,
        initialValueOver:
          initialPoints != null && mi != null ? Math.round((initialPoints - mi) * 10) / 10 : null,
        currentPoints,
        currentValueOver:
          currentPoints != null && mc != null ? Math.round((currentPoints - mc) * 10) / 10 : null,
      }
    })

    // Per-manager cards.
    const byOwner = new Map<string, DraftPickGrade[]>()
    for (const g of gradedPicksList) {
      if (!g.byOwnerId) continue
      const list = byOwner.get(g.byOwnerId) ?? []
      list.push(g)
      byOwner.set(g.byOwnerId, list)
    }
    const managers: DraftManagerCard[] = [...byOwner.entries()]
      .map(([ownerId, list]) => {
        const gradable = list.filter((g) => g.initialValueOver != null)
        const initialScore =
          Math.round(gradable.reduce((a, g) => a + (g.initialValueOver ?? 0), 0) * 10) / 10
        const currentScore =
          Math.round(list.reduce((a, g) => a + (g.currentValueOver ?? 0), 0) * 10) / 10
        const perPickInitial = gradable.length > 0 ? initialScore / gradable.length : 0
        const perPickCurrent = gradable.length > 0 ? currentScore / gradable.length : 0
        const user = usersById.get(ownerId)
        return {
          ownerId,
          name: user?.display_name ?? 'Manager',
          avatar: user?.avatar ?? null,
          teamName: user?.metadata?.team_name?.trim() || null,
          picks: list.length,
          initialScore,
          currentScore,
          initialGrade: letterFor(perPickInitial),
          currentGrade: letterFor(perPickCurrent),
          trend:
            perPickCurrent > perPickInitial + 3
              ? ('improved' as const)
              : perPickCurrent < perPickInitial - 3
                ? ('declined' as const)
                : ('steady' as const),
        }
      })
      .sort((a, b) => b.currentScore - a.currentScore)

    const withCurrent = gradedPicksList.filter((g) => g.currentValueOver != null)
    const steals = [...withCurrent]
      .sort((a, b) => (b.currentValueOver ?? 0) - (a.currentValueOver ?? 0))
      .slice(0, 3)
      .filter((g) => (g.currentValueOver ?? 0) > 0)
    const busts = [...withCurrent]
      .sort((a, b) => (a.currentValueOver ?? 0) - (b.currentValueOver ?? 0))
      .slice(0, 3)
      .filter((g) => (g.currentValueOver ?? 0) < 0)

    seasonsOut.push({
      season: league.season,
      draftId: draft.draft_id,
      rounds,
      totalPicks: picks.length,
      gradedPicks: gradedPicksList.filter((g) => g.initialValueOver != null).length,
      partial,
      managers,
      steals,
      busts,
    })
  }
  seasonsOut.reverse() // newest first

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    sleeperLeagueId,
    dynastyLike,
    gradeScale: {
      description:
        'Value over round: each pick’s league-scored points minus the MEDIAN produced by that round’s picks. Grade = average value-over per pick. Recompute any letter from the numbers shown.',
      thresholds: [
        { letter: 'A', minAvgPerPick: 25 },
        { letter: 'B', minAvgPerPick: 10 },
        { letter: 'C', minAvgPerPick: -10 },
        { letter: 'D', minAvgPerPick: -25 },
        { letter: 'F', minAvgPerPick: null },
      ],
    },
    seasons: seasonsOut,
    missing,
  }
}

/** Cached accessor with stale-flagged fallback. */
export async function getDraftReport(sleeperLeagueId: string): Promise<DraftReportPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${sleeperLeagueId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as DraftReportPayload)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) return cachedPayload

  const fresh = await buildDraftReport(sleeperLeagueId).catch((err) => {
    console.error('[draft-report] build failed', { sleeperLeagueId, err })
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
  if (cachedPayload?.version === 1 && cached) {
    return { ...cachedPayload, staleAsOf: cached.expiresAt.toISOString() }
  }
  return null
}
