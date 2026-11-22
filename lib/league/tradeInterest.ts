import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Trade interest — the AF crest on the league page's Propose grid and trade block cards
 * (`LeagueTradeInterest`). A manager marks players they want; other managers see only an anonymous
 * COUNT per player, never who marked it.
 *
 * ⚠ FAILS SOFT WHEN THE TABLE IS NOT THERE YET. The code can deploy before
 * prisma/migrations/20261118090000_league_trade_interests is applied; until then every read answers
 * `available: false` (the client keeps its per-browser marks) and a write answers `unavailable`,
 * instead of a P2021 error reaching the page.
 */
export type TradeInterestView = {
  available: boolean
  /** playerId → how many managers in the league marked them. */
  counts: Record<string, number>
  /** The viewer's own marks. */
  mine: string[]
}

const MAX_PLAYER_ID = 64

function isMissingTable(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2021')
}

export function validPlayerId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_PLAYER_ID
}

export async function readTradeInterest(leagueId: string, userId: string): Promise<TradeInterestView> {
  try {
    const [grouped, mine] = await Promise.all([
      prisma.leagueTradeInterest.groupBy({ by: ['playerId'], where: { leagueId }, _count: { _all: true } }),
      prisma.leagueTradeInterest.findMany({ where: { leagueId, userId }, select: { playerId: true } }),
    ])
    const counts: Record<string, number> = {}
    for (const g of grouped) counts[g.playerId] = g._count._all
    return { available: true, counts, mine: mine.map((m) => m.playerId) }
  } catch (e) {
    if (!isMissingTable(e)) console.warn('[tradeInterest] read failed', { name: e instanceof Error ? e.name : typeof e })
    return { available: false, counts: {}, mine: [] }
  }
}

export type SetTradeInterestResult = { ok: true; count: number } | { ok: false; unavailable: true } | { ok: false; unavailable: false }

export async function setTradeInterest(args: { leagueId: string; userId: string; playerId: string; interested: boolean }): Promise<SetTradeInterestResult> {
  const { leagueId, userId, playerId, interested } = args
  try {
    if (interested) {
      await prisma.leagueTradeInterest.upsert({
        where: { leagueId_userId_playerId: { leagueId, userId, playerId } },
        create: { leagueId, userId, playerId },
        update: {},
      })
    } else {
      await prisma.leagueTradeInterest.deleteMany({ where: { leagueId, userId, playerId } })
    }
    const count = await prisma.leagueTradeInterest.count({ where: { leagueId, playerId } })
    return { ok: true, count }
  } catch (e) {
    if (isMissingTable(e)) return { ok: false, unavailable: true }
    console.warn('[tradeInterest] write failed', { name: e instanceof Error ? e.name : typeof e })
    return { ok: false, unavailable: false }
  }
}
