/**
 * Turn the trade a notification is about into the card its picture draws
 * (lib/push-notifications/tradeCard.ts, rendered by /api/push-card/trade).
 *
 * Pure: the trade notifier already holds everything a card needs when it composes the email, so
 * building one costs no query. Letters come from the same grade the email prints — for a completed
 * trade through `completedSideLetter`, the email's own rule — so the picture and the inbox cannot
 * name different winners.
 */
import type { TradeCard, TradeCardAsset } from '@/lib/push-notifications/tradeCard'
import type { PendingTradeAsset } from '@/lib/provider-trades/scanPendingSleeperTrades'
import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { completedSideLetter } from '@/lib/trade-intel/tradeGradeEmail'

/** Headshots are Sleeper NFL ids; another sport's id would draw the wrong face or none. */
function headshotId(playerId: string | null | undefined, isNfl: boolean): string | undefined {
  return isNfl && playerId && /^\d+$/.test(playerId) ? playerId : undefined
}

function pendingAsset(a: PendingTradeAsset, isNfl: boolean): TradeCardAsset {
  if (a.faabAmount != null) return { n: `$${a.faabAmount} FAAB` }
  if (a.isPick) return { n: `${a.pickRound ?? a.playerName} pick`, d: 'Draft pick' }
  const d = [a.position, a.team].filter((v) => v && v !== '—').join(' · ')
  return { n: a.playerName, ...(d ? { d } : {}), ...(headshotId(a.playerId, isNfl) ? { id: a.playerId as string } : {}) }
}

/** An open offer, from the recipient's side: they are side one and receive `youGet`. */
export function offerTradeCard(args: {
  leagueName: string
  proposerName: string | null
  youGet: PendingTradeAsset[]
  youGive: PendingTradeAsset[]
  /** Graded from the recipient's side (`viewerSide: true`): `letter` is theirs. */
  grade: TradeGradeView | null
  isNfl: boolean
}): TradeCard {
  const g = args.grade && args.grade.graded ? args.grade : null
  return {
    v: 1,
    kind: 'offer',
    league: args.leagueName,
    sides: [
      { name: 'You', you: true, letter: g ? g.letter : null, gets: args.youGet.map((a) => pendingAsset(a, args.isNfl)) },
      {
        name: args.proposerName ?? 'Their side',
        letter: g ? g.partnerLetter : null,
        gets: args.youGive.map((a) => pendingAsset(a, args.isNfl)),
      },
    ],
  }
}

function completedAssets(side: TradeSideGrade, isNfl: boolean): TradeCardAsset[] {
  const players = side.playersIn.map((p) => ({
    n: p.name,
    ...(p.position ? { d: p.position } : {}),
    ...(headshotId(p.playerId, isNfl) ? { id: p.playerId } : {}),
  }))
  const picks = side.picksIn.map((p) => ({ n: p.resolved ? `${p.label} → ${p.resolved.name}` : `${p.label} pick`, d: 'Draft pick' }))
  const faab = side.faabIn != null && side.faabIn > 0 ? [{ n: `$${side.faabIn} FAAB` }] : []
  return [...players, ...picks, ...faab]
}

/** A completed two-team trade, as the grade email shows it. Null for a three-way trade. */
export function completedTradeCard(args: {
  leagueName: string
  trade: GradedTrade
  grade: TradeGradeView | null
  viewerOwnerId: string | null
  isNfl: boolean
}): TradeCard | null {
  const { trade } = args
  if (trade.sides.length !== 2) return null
  const side = (i: 0 | 1) => {
    const s = trade.sides[i]
    const you = Boolean(args.viewerOwnerId) && s.ownerId != null && String(s.ownerId) === String(args.viewerOwnerId)
    return {
      name: s.managerName,
      ...(you ? { you: true } : {}),
      letter: completedSideLetter(trade, args.grade, i),
      gets: completedAssets(s, args.isNfl),
    }
  }
  return { v: 1, kind: 'accepted', league: args.leagueName, sides: [side(0), side(1)] }
}
