import { getPickValue } from '@/lib/fantasycalc'
import type { PendingTradeAsset } from '@/lib/provider-trades/scanPendingSleeperTrades'
import type { ValueBook } from './valueBook'

export type PendingOfferEvaluation =
  | {
      graded: true
      letter: 'A' | 'B' | 'C' | 'D' | 'F'
      sharePct: number
      receivedValue: number
      sentValue: number
      recommendation: string
      basis: string
    }
  | {
      graded: false
      covered: number
      total: number
      reason: string
      basis: string
    }

function assetValue(
  asset: PendingTradeAsset,
  playerValues: ReadonlyMap<string, number>,
  isDynasty: boolean,
  teamCount: number,
): number | null {
  if (asset.playerId) return playerValues.get(asset.playerId) ?? null
  if (asset.isPick && asset.pickYear && asset.pickRoundNumber) {
    return getPickValue(asset.pickYear, asset.pickRoundNumber, isDynasty, undefined, teamCount)
  }
  // FAAB has no honest conversion to this market-value scale yet.
  return null
}

function letterFor(share: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (share >= 65) return 'A'
  if (share >= 55) return 'B'
  if (share >= 45) return 'C'
  if (share >= 35) return 'D'
  return 'F'
}

export function evaluatePendingOffer(args: {
  received: readonly PendingTradeAsset[]
  sent: readonly PendingTradeAsset[]
  playerValues: ReadonlyMap<string, number>
  book: ValueBook
  teamCount: number
}): PendingOfferEvaluation {
  const isDynasty = args.book.format === 'DYNASTY'
  const basis = `${args.book.format.toLowerCase()} · ${args.book.qbFormat === 'SUPERFLEX' ? 'superflex' : '1QB'} market value`
  const all = [...args.received, ...args.sent]
  const receivedValues = args.received.map((asset) => assetValue(asset, args.playerValues, isDynasty, args.teamCount))
  const sentValues = args.sent.map((asset) => assetValue(asset, args.playerValues, isDynasty, args.teamCount))
  const covered = [...receivedValues, ...sentValues].filter((value) => value != null).length

  if (args.received.length === 0 || args.sent.length === 0) {
    return { graded: false, covered, total: all.length, reason: 'One side has no assets recorded.', basis }
  }
  if (covered < all.length) {
    return {
      graded: false,
      covered,
      total: all.length,
      reason: `Only ${covered} of ${all.length} assets have a compatible value; missing assets were not treated as zero.`,
      basis,
    }
  }

  const receivedValue = receivedValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const sentValue = sentValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const totalValue = receivedValue + sentValue
  if (totalValue <= 0) {
    return { graded: false, covered, total: all.length, reason: 'The priced assets have no usable value signal.', basis }
  }

  const sharePct = Math.round((receivedValue / totalValue) * 1000) / 10
  const letter = letterFor(sharePct)
  const recommendation =
    sharePct >= 55
      ? 'Accept side is favored on market value. Confirm lineup fit and player risk before acting.'
      : sharePct >= 45
        ? 'Market value is close. Decide from roster need, weekly lineup impact, and team direction.'
        : 'Counter or decline on market value. Ask for enough value to bring your side near 50%.'

  return { graded: true, letter, sharePct, receivedValue, sentValue, recommendation, basis }
}
