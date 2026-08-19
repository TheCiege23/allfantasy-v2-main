import 'server-only'

/**
 * waiverIntelService — FAAB bid intelligence built from two REAL inputs:
 *
 *  1. YOUR LEAGUE'S HISTORY: every winning waiver claim in the whole chain
 *     (transaction feed, `waiver_bid` settings) → median / p75 / top winning
 *     bids plus the most recent winners, so suggestions are calibrated to how
 *     this room actually spends.
 *  2. THE MARKET: available (unrostered) players ranked by the format-correct
 *     FantasyCalc value chart, matched against the viewer's open/weak starter
 *     slots.
 *
 * The suggested bid formula is printed with the payload:
 *   suggested = min(60% of budget, budget × playerValue / faabAnchorValue)
 * where the anchor is the documented AF heuristic (full budget ≈ the ~150th
 * ranked asset). League history medians are shown NEXT to the suggestion for
 * calibration — the suggestion never silently blends them.
 */

import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getSeasonBoard, getSeasonStatsBoard } from '@/lib/sports-data/sleeperMarketService'
import { getMarketValues, playerValue } from '@/lib/trade-intel/marketValueService'

const SLEEPER = 'https://api.sleeper.app/v1'
const CACHE_PREFIX = 'waiver-intel:v1:'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1h — waivers move faster than trades
const MAX_CHAIN = 12
const MAX_WEEKS = 18
const BID_CAP_PCT = 0.6

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
  settings?: { waiver_budget?: number } | null
}
type WireRoster = {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  settings?: { waiver_budget_used?: number } | null
}
type WireUser = { user_id: string; display_name: string }
type WireTransaction = {
  type: string
  status: string
  leg: number
  created: number
  adds?: Record<string, number> | null
  settings?: { waiver_bid?: number } | null
}

const SLOT_ACCEPTS: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  DL: ['DL', 'DE', 'DT'], LB: ['LB', 'ILB', 'OLB'], DB: ['DB', 'CB', 'S', 'FS', 'SS'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS'],
}

export type WinningBid = {
  season: string
  week: number
  bid: number
  playerName: string
  position: string | null
}
export type WaiverTarget = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  marketValue: number | null
  fillsSlots: string[]
  suggestedBid: number | null
  reasoning: string[]
}
export type WaiverIntelPayload = {
  version: 1
  fetchedAt: string
  sleeperLeagueId: string
  budget: number | null
  myRemaining: number | null
  history: {
    claims: number
    medianBid: number | null
    p75Bid: number | null
    topBid: number | null
    recent: WinningBid[]
  }
  targets: WaiverTarget[]
  formulaNotes: string[]
  missing: string[]
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))
  return sorted[idx]
}

async function buildWaiverIntel(
  sleeperLeagueId: string,
  viewerSleeperUserId: string | null,
): Promise<WaiverIntelPayload | null> {
  const missing: string[] = []
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null

  // Chain for historical winning bids.
  const chain: WireLeague[] = []
  let cursor: string | null = sleeperLeagueId
  for (let i = 0; i < MAX_CHAIN && cursor; i += 1) {
    // Explicit annotation breaks a circular inference: `cursor` builds the URL
    // that yields `league`, and `league.previous_league_id` reassigns `cursor`.
    const league: WireLeague | null = await j<WireLeague>(`/league/${cursor}`)
    if (!league) {
      missing.push('part of the league chain')
      break
    }
    chain.unshift(league)
    cursor = league.previous_league_id ?? null
  }
  if (chain.length === 0) return null
  const current = chain[chain.length - 1]
  const budget = current.settings?.waiver_budget ?? null

  const bids: WinningBid[] = []
  for (const league of chain) {
    const complete = String(league.status).toLowerCase() === 'complete'
    const statsBoard = await getSeasonStatsBoard(league.season, complete)
    const weeks = await Promise.all(
      Array.from({ length: MAX_WEEKS }, (_, i) =>
        j<WireTransaction[]>(`/league/${league.league_id}/transactions/${i + 1}`),
      ),
    )
    for (const w of weeks) {
      for (const t of w ?? []) {
        if (t.type !== 'waiver' || t.status !== 'complete') continue
        const bid = t.settings?.waiver_bid
        if (typeof bid !== 'number' || bid <= 0) continue
        const playerId = Object.keys(t.adds ?? {})[0]
        const row = playerId ? statsBoard?.players[playerId] : undefined
        bids.push({
          season: league.season,
          week: Math.min(Math.max(t.leg || 1, 1), MAX_WEEKS),
          bid,
          playerName: row?.name ?? `Player ${playerId ?? '?'}`,
          position: row?.position ?? null,
        })
      }
    }
  }
  bids.sort((a, b) => b.season.localeCompare(a.season) || b.week - a.week)
  const sortedBids = bids.map((b) => b.bid).sort((a, b) => a - b)

  // Current rosters → available player pool + viewer needs + remaining FAAB.
  const [rosters, users, board, values] = await Promise.all([
    j<WireRoster[]>(`/league/${sleeperLeagueId}/rosters`),
    j<WireUser[]>(`/league/${sleeperLeagueId}/users`),
    getSeasonBoard(context.season),
    getMarketValues(context).catch(() => null),
  ])
  if (!users) missing.push('managers')
  if (!board) missing.push('player board')
  if (!values) missing.push('market value chart')

  const rostered = new Set<string>()
  for (const r of rosters ?? []) for (const p of r.players ?? []) rostered.add(p)
  const myRoster = viewerSleeperUserId
    ? (rosters ?? []).find((r) => r.owner_id === viewerSleeperUserId) ?? null
    : null
  const myRemaining =
    budget != null && myRoster ? budget - (myRoster.settings?.waiver_budget_used ?? 0) : null

  // Viewer open/weak slots (greedy fill by market value).
  const openSlots: string[] = []
  if (myRoster && board) {
    const mine = (myRoster.players ?? [])
      .map((id) => board.players[id])
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.position))
      .map((p) => ({ p, v: values ? playerValue(values, p.playerId) ?? 0 : 0 }))
      .sort((a, b) => b.v - a.v)
    const remaining = [...mine]
    const slotEntries = Object.entries(context.roster.starters)
    for (const [label, count] of slotEntries) {
      for (let i = 0; i < count; i += 1) {
        const idx = remaining.findIndex((x) => (SLOT_ACCEPTS[label] ?? []).includes(x.p.position ?? ''))
        if (idx >= 0) remaining.splice(idx, 1)
        else openSlots.push(label)
      }
    }
  }

  // Targets: best available by market value, needs-tagged, bid-suggested.
  const anchor = values?.faab.anchorValue ?? null
  const targets: WaiverTarget[] = []
  if (board && values) {
    const candidates = Object.values(board.players)
      .filter((p) => !rostered.has(p.playerId) && p.position && p.position !== 'DEF')
      .map((p) => ({ p, v: playerValue(values, p.playerId) }))
      .filter((x): x is { p: (typeof x)['p']; v: number } => x.v != null && x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 10)
    for (const { p, v } of candidates) {
      const fills = openSlots.filter((slot) => (SLOT_ACCEPTS[slot] ?? []).includes(p.position ?? ''))
      let suggestedBid: number | null = null
      const reasoning: string[] = [`market value ${v.toLocaleString()} (${values.mode} chart)`]
      if (budget != null && anchor != null && anchor > 0) {
        suggestedBid = Math.max(1, Math.min(Math.round(budget * BID_CAP_PCT), Math.round((v / anchor) * budget)))
        reasoning.push(`suggested = min(${Math.round(BID_CAP_PCT * 100)}% of $${budget}, $${budget} × value/anchor)`)
      }
      if (sortedBids.length > 0) {
        reasoning.push(
          `this league's winning bids: median $${quantile(sortedBids, 0.5)}, p75 $${quantile(sortedBids, 0.75)} — calibrate against the room`,
        )
      }
      if (fills.length > 0) reasoning.push(`fills your open ${fills.join(' / ')} slot`)
      targets.push({
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        team: p.team,
        marketValue: v,
        fillsSlots: fills,
        suggestedBid,
        reasoning,
      })
    }
    // Needs first, then raw value.
    targets.sort((a, b) => (b.fillsSlots.length > 0 ? 1 : 0) - (a.fillsSlots.length > 0 ? 1 : 0) || (b.marketValue ?? 0) - (a.marketValue ?? 0))
  }

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    sleeperLeagueId,
    budget,
    myRemaining,
    history: {
      claims: bids.length,
      medianBid: quantile(sortedBids, 0.5),
      p75Bid: quantile(sortedBids, 0.75),
      topBid: sortedBids.length > 0 ? sortedBids[sortedBids.length - 1] : null,
      recent: bids.slice(0, 6),
    },
    targets,
    formulaNotes: [
      values
        ? values.faab.formula
        : 'Market value chart unavailable — bid suggestions are off until it syncs.',
      `Bid cap: suggestions never exceed ${Math.round(BID_CAP_PCT * 100)}% of the budget.`,
      'History = every WINNING waiver claim in this league since it was created (losing bids are not exposed by the platform API).',
    ],
    missing,
  }
}

/** Cached accessor (1h) with stale fallback. */
export async function getWaiverIntel(
  sleeperLeagueId: string,
  viewerSleeperUserId: string | null,
): Promise<WaiverIntelPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${sleeperLeagueId}:${viewerSleeperUserId ?? 'anon'}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as WaiverIntelPayload)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) return cachedPayload

  const fresh = await buildWaiverIntel(sleeperLeagueId, viewerSleeperUserId).catch((err) => {
    console.error('[waiver-intel] build failed', { sleeperLeagueId, err })
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
