import 'server-only'
import { prisma } from '@/lib/prisma'
import { scanPendingSleeperTrades } from '@/lib/provider-trades/scanPendingSleeperTrades'
import type { ChimmyLeagueSnapshot } from './chimmy-league-snapshot'

/** Called only after league membership is proven. An unread inbox never means zero offers. */
export async function pendingTradeQuestions(snapshot: ChimmyLeagueSnapshot, userId: string): Promise<{ offers: Array<{ id: string; question: string }>; gap: string | null }> {
  const native = await prisma.redraftTradeProposal.findMany({
    where: { leagueId: snapshot.id, status: 'pending', receiverRoster: { ownerId: userId } },
    orderBy: { createdAt: 'desc' }, take: 3,
    select: { id: true, receiverRosterId: true, assets: { select: { fromRosterId: true, toRosterId: true, assetType: true, playerName: true } } },
  })
  if (native.length) return { offers: native.map(p => ({ id: p.id,
    question: `Should I trade ${p.assets.filter(a => a.fromRosterId === p.receiverRosterId).map(a => a.playerName ?? a.assetType).join(' and ')} for ${p.assets.filter(a => a.toRosterId === p.receiverRosterId).map(a => a.playerName ?? a.assetType).join(' and ')}?` })), gap: null }
  if (snapshot.platform.toLowerCase() !== 'sleeper') return { offers: [], gap: 'I cannot resolve the pending offer from this platform here. Attach the offer screenshot or name both sides.' }
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } })
  if (!profile?.sleeperUserId) return { offers: [], gap: 'Your Sleeper identity is not linked. Attach the offer screenshot or link the account.' }
  const scan = await scanPendingSleeperTrades({ platformLeagueId: snapshot.platformLeagueId,
    ownerSleeperId: profile.sleeperUserId, sport: snapshot.sport })
  if (!scan.scanned || !scan.trades.length) return { offers: [], gap: 'I could not read the pending offer from the provider. This does not mean you have none. Attach its screenshot or name what you send and receive.' }
  return { offers: scan.trades.slice(0, 3).map(t => ({ id: t.transactionId,
    question: `Should I trade ${t.assetsGiven.map(a => a.playerName).join(' and ')} for ${t.assetsReceived.map(a => a.playerName).join(' and ')}?` })), gap: null }
}
