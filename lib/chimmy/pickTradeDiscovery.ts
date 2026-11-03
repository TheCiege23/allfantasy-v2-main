import { computeRosterImpact, fillLineup, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact'
import type { DiscoveryPlayer, DiscoveryRoster, FairnessBand } from '@/lib/trade-discovery/redraftTradeDiscovery'

export type OwnedTradePick = { season: number; round: number; originalTeamName: string | null; value: number }

export type PickTradeCandidate = {
  partner: DiscoveryRoster
  outgoing: DiscoveryPlayer
  target: DiscoveryPlayer
  picks: OwnedTradePick[]
  giveTotal: number
  getTotal: number
  fairness: FairnessBand
  lineupBefore: number
  lineupAfter: number
  lineupDelta: number
}

const CORE = new Set(['QB', 'RB', 'WR', 'TE'])
const impactOf = (p: DiscoveryPlayer, projections: ReadonlyMap<string, ImpactPlayer>): ImpactPlayer =>
  projections.get(p.playerId) ?? { playerId: p.playerId, position: p.position, projectedPoints: null }

function pickCombos(picks: readonly OwnedTradePick[]): OwnedTradePick[][] {
  const priced = picks.filter(p => Number.isFinite(p.value) && p.value > 0).slice(0, 24)
  const out = priced.map(p => [p])
  for (let i = 0; i < priced.length; i++) {
    for (let j = i + 1; j < priced.length; j++) {
      const a = priced[i]!
      const b = priced[j]!
      if (a.season === b.season && a.round === b.round && a.originalTeamName === b.originalTeamName) continue
      out.push([a, b])
    }
  }
  return out
}

function fairness(give: number, get: number): FairnessBand {
  const ratio = give / get
  if (ratio >= 0.92 && ratio <= 1.08) return 'balanced'
  return ratio < 0.92 ? 'slight edge you' : 'slight edge partner'
}

/** Search real owned picks and require a league-scored weekly lineup gain for every offer. */
export function findWinNowPickTrades(args: {
  me: DiscoveryRoster
  partners: readonly DiscoveryRoster[]
  ownedPicks: readonly OwnedTradePick[]
  projections: ReadonlyMap<string, ImpactPlayer>
  slots: readonly string[]
  position?: string | null
  outgoingPlayerId?: string | null
  max?: number
}): PickTradeCandidate[] {
  if (!args.slots.length || !args.ownedPicks.length) return []
  const myImpact = args.me.players.map(p => impactOf(p, args.projections))
  const before = fillLineup(myImpact, args.slots)
  if (before.unknownSlots.length || before.unfilledSlots.length) return []
  const starters = new Set(before.starterIds)
  const outgoing = args.me.players.filter(p => CORE.has(p.position) && p.value != null && p.value > 0 &&
    (args.outgoingPlayerId ? p.playerId === args.outgoingPlayerId : !starters.has(p.playerId)) &&
    impactOf(p, args.projections).projectedPoints != null)
  const combos = pickCombos(args.ownedPicks)
  const candidates: PickTradeCandidate[] = []
  for (const partner of args.partners) {
    for (const target of partner.players) {
      if (!CORE.has(target.position) || target.value == null || target.value <= 0) continue
      if (args.position && target.position !== args.position) continue
      const targetImpact = impactOf(target, args.projections)
      if (targetImpact.projectedPoints == null) continue
      for (const lesser of outgoing) {
        const lesserImpact = impactOf(lesser, args.projections)
        if (lesser.value == null || target.value <= lesser.value ||
          targetImpact.projectedPoints <= (lesserImpact.projectedPoints ?? 0)) continue
        const impact = computeRosterImpact({ roster: myImpact, slots: args.slots, incoming: [targetImpact], outgoingPlayerIds: [lesser.playerId] })
        if (impact.blockedReason || impact.startingPointsDelta == null || impact.startingPointsDelta <= 0 ||
          impact.startingPointsBefore == null || impact.startingPointsAfter == null) continue
        const viable = combos.map(picks => ({ picks, give: lesser.value! + picks.reduce((sum, p) => sum + p.value, 0) }))
          .filter(x => x.give / target.value! >= 0.85 && x.give / target.value! <= 1.20)
          .sort((a, b) => {
            const penalty = (x: typeof a) => Math.abs(1 - x.give / target.value!) +
              (x.picks.some(p => p.round === 1) ? 0.04 : 0) + (x.picks.length > 1 ? 0.015 : 0)
            return penalty(a) - penalty(b)
          })
        const best = viable[0]
        if (!best) continue
        candidates.push({ partner, outgoing: lesser, target, picks: best.picks, giveTotal: best.give,
          getTotal: target.value, fairness: fairness(best.give, target.value),
          lineupBefore: impact.startingPointsBefore, lineupAfter: impact.startingPointsAfter,
          lineupDelta: impact.startingPointsDelta })
      }
    }
  }
  candidates.sort((a, b) => b.lineupDelta - a.lineupDelta ||
    Number(b.partner.stance === 'rebuilder') - Number(a.partner.stance === 'rebuilder') ||
    Math.abs(a.giveTotal / a.getTotal - 1) - Math.abs(b.giveTotal / b.getTotal - 1) ||
    a.picks.length - b.picks.length)
  const out: PickTradeCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.partner.rosterId)) continue
    seen.add(candidate.partner.rosterId)
    out.push(candidate)
    if (out.length >= (args.max ?? 3)) break
  }
  return out
}
