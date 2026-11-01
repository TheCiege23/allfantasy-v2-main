/**
 * A held `free_trade_token` (the reward ledger, survivorRewardEngine.ts) lets ONE trade skip the
 * Survivor trade rules — the tribe and played-player rules; never the commissioner's weekly freeze —
 * and is spent when that trade executes.
 *
 * Registered with C's bypass registry (survivorTradeRuleBypass.ts) on import; the trade-rule hook
 * imports this module, so every trade path that checks the rules sees the token.
 *
 *  - CHECK (read-only, at proposal, acceptance and settlement): any roster in the trade holding an
 *    unspent token for this week grants the bypass. A `samePositionOnly` token grants it only for a
 *    same-position trade: exactly two sides, each sending at least one player, the same positions
 *    in the same numbers ("RB for RB", "WR+TE for WR+TE"). FAAB or picks riding along are fine.
 *  - REDEEM (after the trade executes, only when the trade NEEDED the bypass): one token from the
 *    roster that granted it, idempotent per trade (`redeemSurvivorTradeToken` keys on `tradeRef`).
 */

import { prisma } from '@/lib/prisma'
import { registerSurvivorTradeBypassProvider, registerSurvivorTradeBypassRedeemer, type SurvivorTradeBypassContext } from './survivorTradeRuleBypass'

export const FREE_TRADE_TOKEN_SOURCE = 'free_trade_token'

/** Same-position: two sides, each sends ≥1 player, and the sorted position lists match. Pure. */
export function isSamePositionTrade(players: ReadonlyArray<{ fromRosterId: string; position: string | null }>): boolean {
  const sides = new Map<string, string[]>()
  for (const p of players) {
    if (!p.position) return false
    const pos = p.position.trim().toUpperCase().split(/[\s,;/|-]+/)[0] ?? ''
    if (!pos) return false
    sides.set(p.fromRosterId, [...(sides.get(p.fromRosterId) ?? []), pos])
  }
  if (sides.size !== 2) return false
  const [a, b] = [...sides.values()].map((list) => [...list].sort().join(','))
  return Boolean(a) && a === b
}

async function positionsFor(leagueId: string, players: NonNullable<SurvivorTradeBypassContext['players']>): Promise<Array<{ fromRosterId: string; position: string | null }>> {
  if (!players.length) return []
  const rosters = await prisma.roster.findMany({ where: { leagueId, id: { in: [...new Set(players.map((p) => p.fromRosterId))] } }, select: { id: true, redraftRosterId: true } })
  const redraftIds = rosters.map((r) => r.redraftRosterId).filter((id): id is string => Boolean(id))
  const rows = redraftIds.length
    ? await prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: redraftIds }, playerId: { in: players.map((p) => p.playerId) } }, select: { playerId: true, position: true, rosterId: true, droppedAt: true }, orderBy: { addedAt: 'desc' } })
    : []
  return players.map((p) => {
    const redraftId = rosters.find((r) => r.id === p.fromRosterId)?.redraftRosterId
    const row = rows.find((r) => r.playerId === p.playerId && r.rosterId === redraftId) ?? rows.find((r) => r.playerId === p.playerId)
    return { fromRosterId: p.fromRosterId, position: row?.position ?? null }
  })
}

export async function freeTradeTokenBypassProvider(ctx: SurvivorTradeBypassContext): Promise<{ bypass: boolean; source?: string } | null> {
  if (ctx.week < 1 || !ctx.rosterIds.length) return null
  const { getSurvivorTradeTokens } = await import('./SurvivorEffectEngine')
  let samePosition: boolean | null = null
  for (const rosterId of [...new Set(ctx.rosterIds)].sort()) {
    const tokens = await getSurvivorTradeTokens(ctx.leagueId, rosterId, ctx.week)
    for (const token of tokens) {
      if (token.spec.type !== 'free_trade_token') continue
      if (token.spec.samePositionOnly) {
        samePosition ??= isSamePositionTrade(await positionsFor(ctx.leagueId, ctx.players ?? []))
        if (!samePosition) continue
      }
      return { bypass: true, source: `${FREE_TRADE_TOKEN_SOURCE}:${rosterId}` }
    }
  }
  return null
}

export async function redeemFreeTradeTokenBypass(args: { leagueId: string; week: number; tradeRef: string; source: string; actorUserId?: string | null }): Promise<void> {
  const rosterId = args.source.slice(FREE_TRADE_TOKEN_SOURCE.length + 1)
  if (!rosterId) return
  const { redeemSurvivorTradeToken } = await import('./SurvivorEffectEngine')
  const result = await redeemSurvivorTradeToken({ leagueId: args.leagueId, rosterId, tradeRef: args.tradeRef, week: args.week, actorUserId: args.actorUserId ?? null })
  if (!result.ok) console.warn('[survivor-trade-rules] free trade token not redeemed', { leagueId: args.leagueId, tradeRef: args.tradeRef, error: result.error })
}

registerSurvivorTradeBypassProvider(freeTradeTokenBypassProvider)
registerSurvivorTradeBypassRedeemer(FREE_TRADE_TOKEN_SOURCE, redeemFreeTradeTokenBypass)
