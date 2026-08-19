import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSeasonBoard, getWeekBoard } from '@/lib/sports-data/sleeperMarketService'
import { getMarketValues, playerValue } from '@/lib/trade-intel/marketValueService'
import { getNflInjuries, injuryForName } from '@/lib/sports-data/playerAssetsService'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'

export const dynamic = 'force-dynamic'

/**
 * GET /api/players/profile?playerId=&name=
 *
 * League-agnostic player intelligence card for the dashboard player search:
 * headshot (Sleeper CDN), injury flag (Rolling Insights, when configured),
 * this week's Sleeper projection, season ADP, and FantasyCalc market value.
 *
 * Honesty contract: everything here is league-AGNOSTIC — projections are shown
 * in PPR/Half-PPR without a specific league's scoring ("format-approx"), and
 * values use FantasyCalc's 12-team 1QB default boards. The exact league-scored
 * numbers live on the league pages; `notes[]` says all of this in the payload.
 * Anything unavailable ships as null, never invented.
 */

type WireState = { season?: string; week?: number; season_type?: string }

const STATE_CACHE_KEY = 'nfl-state:v1'
const STATE_TTL_MS = 30 * 60 * 1000

async function getNflState(): Promise<{ season: string; week: number } | null> {
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey: STATE_CACHE_KEY } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as { season?: string; week?: number })
      : null
  if (cachedPayload?.season && cached && cached.expiresAt > now) {
    return { season: cachedPayload.season, week: cachedPayload.week ?? 1 }
  }
  try {
    const res = await fetch('https://api.sleeper.app/v1/state/nfl', { cache: 'no-store' })
    if (!res.ok) return cachedPayload?.season ? { season: cachedPayload.season, week: cachedPayload.week ?? 1 } : null
    const state = (await res.json()) as WireState
    if (!state?.season) return null
    const fresh = { season: String(state.season), week: Math.max(1, Number(state.week ?? 1)) }
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey: STATE_CACHE_KEY },
        update: { data: fresh, expiresAt: new Date(now.getTime() + STATE_TTL_MS) },
        create: { cacheKey: STATE_CACHE_KEY, data: fresh, expiresAt: new Date(now.getTime() + STATE_TTL_MS) },
      })
      .catch(() => null)
    return fresh
  } catch {
    return cachedPayload?.season ? { season: cachedPayload.season, week: cachedPayload.week ?? 1 } : null
  }
}

/** FantasyCalc default-board context (12-team 1QB Half-PPR) — printed in notes. */
const DEFAULT_CONTEXT = {
  scoring: {
    settings: {} as Record<string, number>,
    receptionWeight: 0.5,
    format: 'half_ppr' as const,
    idp: { present: false, tacklePts: 0, sackPts: 0, intPts: 0, emphasis: null },
  },
  teams: 12,
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const playerId = (url.searchParams.get('playerId') ?? '').trim()
  const name = (url.searchParams.get('name') ?? '').trim()
  if (!playerId && !name) {
    return NextResponse.json({ error: 'playerId or name is required' }, { status: 400 })
  }

  const state = await getNflState()
  const notes: string[] = [
    'Projection: Sleeper weekly feed, shown in Half-PPR/PPR without your league’s exact scoring (format-approx).',
    'Market value: FantasyCalc 12-team 1QB default boards — your league’s market may differ.',
  ]

  const [seasonBoard, weekBoard, redraftValues, dynastyValues, injuries] = await Promise.all([
    state ? getSeasonBoard(state.season) : Promise.resolve(null),
    state ? getWeekBoard(state.season, state.week) : Promise.resolve(null),
    getMarketValues({
      ...DEFAULT_CONTEXT,
      variant: { idp: false, superflex: false, dynasty: false, keeper: false, bestBall: false },
    }).catch(() => null),
    getMarketValues({
      ...DEFAULT_CONTEXT,
      variant: { idp: false, superflex: false, dynasty: true, keeper: false, bestBall: false },
    }).catch(() => null),
    getNflInjuries().catch(() => ({ configured: false }) as Awaited<ReturnType<typeof getNflInjuries>>),
  ])

  const marketRow = playerId ? seasonBoard?.players[playerId] ?? null : null
  const projRow = playerId ? weekBoard?.players[playerId] ?? null : null
  const resolvedName = name || marketRow?.name || projRow?.name || null

  const injury = resolvedName ? injuryForName(injuries, resolvedName) : null
  if (!('available' in injuries) || injuries.available !== true) {
    notes.push('Injury feed is not configured or unavailable right now — no injury status shown.')
  }

  const projections = projRow
    ? {
        week: state?.week ?? null,
        ptsPpr: typeof projRow.stats.pts_ppr === 'number' ? Math.round(projRow.stats.pts_ppr * 10) / 10 : null,
        ptsHalfPpr:
          typeof projRow.stats.pts_half_ppr === 'number' ? Math.round(projRow.stats.pts_half_ppr * 10) / 10 : null,
        mode: 'format-approx' as const,
      }
    : null

  const adp = marketRow
    ? {
        redraftHalfPpr: marketRow.adp['adp_half_ppr'] ?? null,
        dynastyHalfPpr: marketRow.adp['adp_dynasty_half_ppr'] ?? marketRow.adp['adp_dynasty'] ?? null,
        rookie: marketRow.adp['adp_rookie'] ?? null,
      }
    : null

  const values =
    playerId && (redraftValues || dynastyValues)
      ? {
          redraft: redraftValues ? playerValue(redraftValues, playerId) : null,
          dynasty: dynastyValues ? playerValue(dynastyValues, playerId) : null,
          source: 'FantasyCalc (12-team · 1QB · Half-PPR defaults)',
        }
      : null

  return NextResponse.json({
    playerId: playerId || null,
    name: resolvedName,
    position: marketRow?.position ?? projRow?.position ?? null,
    team: marketRow?.team ?? projRow?.team ?? null,
    headshotUrl: sleeperPlayerHeadshot(playerId || null),
    season: state?.season ?? null,
    injury,
    projections,
    adp,
    values,
    notes,
  })
}
