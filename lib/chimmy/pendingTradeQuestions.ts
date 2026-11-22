import 'server-only'
import { prisma } from '@/lib/prisma'
import { scanPendingSleeperTrades } from '@/lib/provider-trades/scanPendingSleeperTrades'
import { isMultiTeamTrade, tradeParticipantRosterIds } from '@/lib/redraft/tradeParticipants'
import type { ChimmyLeagueSnapshot } from './chimmy-league-snapshot'

type NativeOffer = {
  id: string
  receiverRosterId: string
  proposerRosterId?: string
  additionalRosterIds?: string[] | null
  assets: Array<{ fromRosterId: string; toRosterId: string; assetType?: string; playerName: string | null }>
}

const NATIVE_SELECT = {
  id: true,
  proposerRosterId: true,
  receiverRosterId: true,
  additionalRosterIds: true,
  assets: { select: { fromRosterId: true, toRosterId: true, assetType: true, playerName: true } },
} as const

/**
 * The viewer's own team ids in this league. A multi-team trade lists its third and fourth teams in
 * `additionalRosterIds`, which is a plain id list rather than a relation, so "offers waiting on me as
 * an extra team" needs the ids. Unreadable reads as none: the receiver offers above still stand, which
 * is exactly what this answered before multi-team trades existed.
 */
async function myRedraftRosterIds(leagueId: string, userId: string): Promise<string[]> {
  return Promise.resolve()
    .then(() => prisma.redraftRoster.findMany({ where: { leagueId, ownerId: userId }, select: { id: true } }))
    .then((rows) => rows.map((r) => r.id))
    .catch(() => [])
}

function questionFor(p: NativeOffer, myTeam: string): string {
  const give = p.assets.filter(a => a.fromRosterId === myTeam).map(a => a.playerName ?? a.assetType).join(' and ')
  const get = p.assets.filter(a => a.toRosterId === myTeam).map(a => a.playerName ?? a.assetType).join(' and ')
  // Two teams: the question exactly as before. More: it says so, because the other teams matter to the answer.
  const teams = isMultiTeamTrade(p) && p.proposerRosterId ? tradeParticipantRosterIds({ proposerRosterId: p.proposerRosterId, receiverRosterId: p.receiverRosterId, additionalRosterIds: p.additionalRosterIds }).length : 0
  return teams > 2 ? `Should I trade ${give} for ${get} in this ${teams}-team trade?` : `Should I trade ${give} for ${get}?`
}

/** Called only after league membership is proven. An unread inbox never means zero offers. */
export async function pendingTradeQuestions(snapshot: ChimmyLeagueSnapshot, userId: string): Promise<{ offers: Array<{ id: string; question: string; assetCount: number }>; gap: string | null }> {
  const incoming = (await prisma.redraftTradeProposal.findMany({
    where: { leagueId: snapshot.id, status: 'pending', receiverRoster: { ownerId: userId } },
    orderBy: { createdAt: 'desc' }, take: 3,
    select: NATIVE_SELECT,
  })) as NativeOffer[]
  // A multi-team offer waits on every team in it, not only the receiver (lib/redraft/tradeParticipants.ts).
  const mine = incoming.length < 3 ? await myRedraftRosterIds(snapshot.id, userId) : []
  const asExtraTeam = mine.length
    ? ((await prisma.redraftTradeProposal.findMany({
        where: { leagueId: snapshot.id, status: 'pending', additionalRosterIds: { hasSome: mine } },
        orderBy: { createdAt: 'desc' }, take: 3,
        select: NATIVE_SELECT,
      })) as NativeOffer[])
    : []
  const seen = new Set<string>()
  const native = [
    ...incoming.map(p => ({ p, myTeam: p.receiverRosterId })),
    ...asExtraTeam.map(p => ({ p, myTeam: (p.additionalRosterIds ?? []).find(id => mine.includes(id)) ?? p.receiverRosterId })),
  ].filter(({ p }) => (seen.has(p.id) ? false : (seen.add(p.id), true))).slice(0, 3)
  if (native.length) return { offers: native.map(({ p, myTeam }) => ({ id: p.id, assetCount: p.assets.length, question: questionFor(p, myTeam) })), gap: null }
  if (snapshot.platform.toLowerCase() !== 'sleeper') return { offers: [], gap: 'I cannot resolve the pending offer from this platform here. Attach the offer screenshot or name both sides.' }
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } })
  if (!profile?.sleeperUserId) return { offers: [], gap: 'Your Sleeper identity is not linked. Attach the offer screenshot or link the account.' }
  const scan = await scanPendingSleeperTrades({ platformLeagueId: snapshot.platformLeagueId,
    ownerSleeperId: profile.sleeperUserId, sport: snapshot.sport })
  if (!scan.scanned || !scan.trades.length) return { offers: [], gap: 'I could not read the pending offer from the provider. This does not mean you have none. Attach its screenshot or name what you send and receive.' }
  return { offers: scan.trades.slice(0, 3).map(t => ({ id: t.transactionId, assetCount: t.assetsGiven.length + t.assetsReceived.length,
    question: `Should I trade ${t.assetsGiven.map(a => a.playerName).join(' and ')} for ${t.assetsReceived.map(a => a.playerName).join(' and ')}?` })), gap: null }
}
