import 'server-only'

/**
 * Chimmy's one pricing step for a deal (./chimmyBoardValue.ts says why).
 *
 * In a league whose sport the value board covers (NBA, college basketball, NHL, and the others on
 * `BOARD_VALUE_SPORTS`), the deal is priced on that league's board — the board the Trade Center grades
 * on. Anything the board does not price (no board for the league right now, a pick outside a dynasty
 * league, FAAB) keeps the older pricing for the whole deal, so one deal is never valued in two units.
 *
 * Reads Postgres only. TheSportsDB ids on an NHL roster are translated to the Rolling Insights number of
 * the same player through our own tables, never by calling either vendor.
 */
import { prisma } from '@/lib/prisma'
import { computeRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import { indexBoard, resolveBoardPlayer } from '@/lib/decision-os/trade/sportPointsValue'
import { loadLeagueValueBoard, type LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import { priceDealOnBoard, type RosterIdentity } from './chimmyBoardValue'

type SnapshotInput = Parameters<typeof computeRedraftTradeValueSnapshot>[0]

export type ChimmyPricingDeps = {
  board: (leagueId: string) => Promise<LeagueValueBoard>
  identities: (sport: string, ids: string[]) => Promise<Map<string, RosterIdentity>>
  fallback: (input: SnapshotInput) => Promise<TradeValueSnapshot>
}

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase()

/**
 * What the registry knows about roster ids the board did not resolve. A Rolling Insights number in the
 * registry is a known player; a TheSportsDB id is matched by name to exactly one Rolling Insights player
 * on the same team, or left unknown.
 */
export async function loadRosterIdentities(sport: string, ids: string[]): Promise<Map<string, RosterIdentity>> {
  const out = new Map<string, RosterIdentity>()
  if (ids.length === 0) return out
  const tsdb = ids.filter((id) => id.startsWith('tsdb_'))
  const plain = ids.filter((id) => !id.startsWith('tsdb_'))

  if (plain.length) {
    const rows = await prisma.playerIdentityMap.findMany({
      where: { sport, rollingInsightsId: { in: plain } },
      select: { rollingInsightsId: true, canonicalName: true, position: true },
    })
    for (const r of rows) if (r.rollingInsightsId) out.set(r.rollingInsightsId, { name: r.canonicalName, position: r.position })
  }

  if (tsdb.length) {
    const players = await prisma.sportsPlayer.findMany({
      // TheSportsDB rows only: a bare number in another source's rows is a different player.
      where: { sport, source: 'thesportsdb', externalId: { in: tsdb } },
      select: { externalId: true, name: true, team: true, position: true },
    })
    const byId = new Map<string, { name: string; team: string | null; position: string | null }>()
    for (const p of players) if (p.name && !byId.has(p.externalId)) byId.set(p.externalId, { name: p.name, team: p.team, position: p.position })
    const names = [...new Set([...byId.values()].map((p) => p.name))]
    const registry = names.length
      ? await prisma.playerIdentityMap.findMany({
          where: { sport, rollingInsightsId: { not: null }, OR: names.map((n) => ({ canonicalName: { equals: n, mode: 'insensitive' as const } })) },
          select: { rollingInsightsId: true, canonicalName: true, currentTeam: true, position: true },
        })
      : []
    for (const [id, p] of byId) {
      const sameName = registry.filter((r) => norm(r.canonicalName) === norm(p.name))
      // One player by that name, or one by that name on his team. Two candidates and no team to split them: unknown.
      const pick = sameName.length === 1 ? sameName[0] : sameName.filter((r) => norm(r.currentTeam) === norm(p.team)).length === 1
        ? sameName.find((r) => norm(r.currentTeam) === norm(p.team))
        : undefined
      if (!pick?.rollingInsightsId) continue
      if (p.team && pick.currentTeam && norm(p.team) !== norm(pick.currentTeam)) continue
      out.set(id, { alias: pick.rollingInsightsId, name: pick.canonicalName ?? p.name, position: pick.position ?? p.position })
    }
  }
  return out
}

export const defaultChimmyPricingDeps: ChimmyPricingDeps = {
  board: (leagueId) => loadLeagueValueBoard(leagueId),
  identities: loadRosterIdentities,
  fallback: computeRedraftTradeValueSnapshot,
}

/**
 * Price a deal for Chimmy: on the league's value board when it covers the deal, otherwise exactly as
 * before. Takes the older pricing's own input, so a call site changes only its function name.
 */
export async function priceChimmyDeal(input: SnapshotInput, deps: ChimmyPricingDeps = defaultChimmyPricingDeps): Promise<TradeValueSnapshot> {
  const board = input.leagueId ? await deps.board(input.leagueId).catch(() => null) : null
  if (board?.kind === 'ok' && (board.ctx.window.gamesRemaining > 0 || board.ctx.dynasty)) {
    const ctx = board.ctx
    const index = indexBoard(ctx.board)
    const playerIds = input.assets
      .filter((a) => a.assetType === 'player' && a.playerId)
      .map((a) => String(a.playerId))
      .filter((id) => !resolveBoardPlayer({ playerId: id }, ctx.board, index).ok)
    const identities = await deps.identities(ctx.sport, [...new Set(playerIds)]).catch(() => new Map<string, RosterIdentity>())
    const snapshot = priceDealOnBoard({
      ctx,
      assets: input.assets as Parameters<typeof priceDealOnBoard>[0]['assets'],
      identities,
      proposerRosterId: input.proposerRosterId,
      receiverRosterId: input.receiverRosterId,
    })
    if (snapshot) return snapshot
  }
  return deps.fallback(input)
}
