import 'server-only'

import { prisma } from '@/lib/prisma'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { deriveSurvivorSideGameSignals, type SurvivorSideGameSignalInput } from '@/lib/decision-os/survivorSideGameSignals'
import { loadSurvivorSideGameView } from './survivorSideGameService'

/**
 * The side-game layer of the Manager Hub's Decision OS snapshot: for each of the caller's Survivor
 * leagues, the caller's OWN side-game view (the same one the Survivor screen reads), turned into
 * signals by `lib/decision-os/survivorSideGameSignals.ts`. Read-only. Never throws: a league that
 * cannot be read contributes nothing.
 */
export async function loadSurvivorSideGameSignals(args: { userId: string; leagueIds: readonly string[]; now: Date }): Promise<DecisionOsAttentionSignal[]> {
  if (!args.leagueIds.length) return []
  const leagues = await prisma.league.findMany({ where: { id: { in: [...args.leagueIds] }, survivorMode: true }, select: { id: true, language: true }, take: 25 }).catch(() => [])
  const inputs: SurvivorSideGameSignalInput[] = []
  for (const league of leagues) {
    try {
      const view = await loadSurvivorSideGameView(league.id, args.userId, args.now)
      if (!view) continue
      const s = view.settings
      const nextLockAt = view.games.filter((g) => g.open && g.startTime).map((g) => g.startTime!).sort()[0] ?? null
      const anything = s.tokenPoolEnabled || s.survivorPoolEnabled || s.tokenShopEnabled || view.auctions.length || view.exileBid
      if (!anything) continue
      inputs.push({
        leagueId: league.id,
        language: league.language,
        role: view.role,
        week: view.week,
        nextLockAt,
        tokenPool: { enabled: s.tokenPoolEnabled, open: s.tokenPoolOpen, picksLeft: Math.max(0, s.tokenPoolPicksPerWeek - view.tokenPool.picks.filter((p) => p.week === view.week).length), pot: view.tokenPool.pot, streak: s.tokenPoolMode === 'streak' },
        pool: { enabled: s.survivorPoolEnabled, started: view.week >= s.survivorPoolStartWeek, alive: view.pool.entry.alive, banned: view.pool.banned, picked: Boolean(view.pool.pick), revivesLeft: view.pool.revivesLeft },
        auctions: view.auctions.map((a) => ({ auctionId: a.auctionId, label: a.label, closesAt: a.closesAt, takingBids: a.takingBids, myBids: a.items.filter((i) => i.myBid != null).length })),
        shop: { open: s.tokenShopEnabled && view.shop.length > 0, tokens: view.tokens, cheapest: view.shop.length ? Math.min(...view.shop.map((i) => i.cost)) : null },
        exileBid: view.exileBid ? { week: view.exileBid.week, closesAt: view.exileBid.closesAt, hasBid: Boolean(view.exileBid.myBid) } : null,
      })
    } catch (error) {
      console.warn('[decision-os] survivor side-game signals skipped', { leagueId: league.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return deriveSurvivorSideGameSignals(inputs, args.now)
}
