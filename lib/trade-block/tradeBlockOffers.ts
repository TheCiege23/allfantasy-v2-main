import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import { findPackages, type DiscoveryRoster, type PackageAsset } from '@/lib/trade-discovery/redraftTradeDiscovery'

/**
 * THE grade on the trade block (2026-09-28). PURE — the grader is injected.
 *
 * A league trade-block card was a player and nothing else: "Kelce — on the block". There was no deal
 * on it, so there was nothing to grade, and a manager had no idea what the player would cost until
 * they built an offer. Each card another manager listed now carries a SUGGESTED OFFER — the package
 * `findPackages` builds from the viewer's roster for exactly that player (the same finder "Find a
 * Trade" and Chimmy use) — and that offer carries the one grade, from the viewer's side.
 *
 * The finder's own `fairnessBand` ("balanced", "slight edge you" …) is NOT shown: it is the finder's
 * value gap, a scale no other trade screen uses. The grade is the verdict.
 */

export type TradeBlockOffer = {
  /** Names of what the viewer would send / receive — the offer "Build proposal" can start from. */
  gives: string[]
  receives: string[]
  grade: SuggestionGrade | null
}

/** A finder package side as grader input: players by id and name, FAAB by amount. */
export function packageGradeInputs(assets: ReadonlyArray<PackageAsset>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.kind === 'player' && a.playerId) {
      if (a.playerName?.trim()) out.assets.push({ kind: 'player', playerId: a.playerId, name: a.playerName.trim() })
      else out.unpriceable.push('a player the league has no name for')
    } else if (a.kind === 'faab' && (a.faabAmount ?? 0) > 0) {
      out.assets.push({ kind: 'faab', amount: a.faabAmount! })
    }
  }
  return out
}

const label = (a: PackageAsset) => (a.kind === 'faab' ? `$${a.faabAmount ?? 0} FAAB` : a.playerName ?? 'a player')

/**
 * A graded suggested offer for each OTHER manager's active block item, keyed by item id. BOUNDED to
 * `limit` items (the newest first, as the block lists them) and FAILURE-CONTAINED: an item with no
 * package, or whose grade fails, is simply absent or ungraded — the block still loads.
 */
export async function tradeBlockOffers(args: {
  items: ReadonlyArray<{ id: string; rosterId: string; playerId: string }>
  viewerRosterId: string
  rosters: ReadonlyArray<DiscoveryRoster>
  sport: string
  draftPickTrading: boolean
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>
  limit: number
}): Promise<Map<string, TradeBlockOffer>> {
  const out = new Map<string, TradeBlockOffer>()
  const mine = args.rosters.find((r) => r.rosterId === args.viewerRosterId)
  if (!mine) return out
  const candidates = args.items.filter((i) => i.rosterId !== args.viewerRosterId).slice(0, Math.max(0, args.limit))
  await Promise.all(
    candidates.map(async (item) => {
      const partner = args.rosters.find((r) => r.rosterId === item.rosterId)
      if (!partner) return
      const pkg = findPackages({
        myRoster: mine,
        partnerRoster: partner,
        sport: args.sport,
        faabSupported: (mine.faabBalance ?? 0) > 0 || (partner.faabBalance ?? 0) > 0,
        draftPickTrading: args.draftPickTrading,
        targetPlayerId: item.playerId,
        max: 1,
      })[0]
      if (!pkg || pkg.giveAssets.length === 0 || !pkg.receiveAssets.some((a) => a.playerId === item.playerId)) return
      const offer: TradeBlockOffer = { gives: pkg.giveAssets.map(label), receives: pkg.receiveAssets.map(label), grade: null }
      try {
        const g = await args.grade(packageGradeInputs(pkg.giveAssets), packageGradeInputs(pkg.receiveAssets))
        offer.grade = g.graded
          ? { graded: true, letter: g.letter, partnerLetter: g.partnerLetter, label: g.label, giveValue: g.giveValue, getValue: g.getValue }
          : { graded: false, reason: g.reason }
      } catch {
        offer.grade = null
      }
      out.set(item.id, offer)
    }),
  )
  return out
}
