import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { TradeAssetInput, TradeConsoleOpponentRosterTarget } from './types'

export type EvaluatedCounterOffer = {
  /**
   * 'add' puts `asset` on the `addTo` side; 'remove' takes it OFF the `addTo` side ("ask for less" /
   * "send less", 2026-11-11). Optional so a payload from before then reads as an add.
   */
  action?: 'add' | 'remove'
  /** The side the change is on — for a removal, the side the asset comes off. */
  addTo: 'give' | 'get'
  /** For a removal: the asset's position in that side as sent, so the builder removes exactly it. */
  index?: number
  asset: TradeAssetInput
  name: string
  rosterPlayerId: string
  position: string | null
  marketValue: number
  assetLeagueValue: number | null
  grade: Extract<TradeGradeView, { graded: true }>
  remainingGap: number
  balanced: boolean
}

/** The same identity exclusions apply to both the target list and counter search. */
export function availableRosterTargets(input: {
  targets: TradeConsoleOpponentRosterTarget[]
  selected: TradeAssetInput[]
  selectedProviderIds?: Array<{ provider: string; id: string } | null>
}): TradeConsoleOpponentRosterTarget[] {
  const identities = (a: { playerId?: string; providerIdentity?: { provider: string; id: string } }) => [
    a.providerIdentity ? `${a.providerIdentity.provider}:${a.providerIdentity.id}` : null,
    a.playerId ? `record:${a.playerId}` : null,
  ].filter((key): key is string => key !== null)
  const selectedKeys = input.selected.map((a, i) => {
    const verified = input.selectedProviderIds?.[i]
    return a.kind === 'player' ? [...identities(a), ...(verified ? [`${verified.provider}:${verified.id}`] : [])] : []
  })
  const ids = new Set(selectedKeys.flat())
  const names = new Set(input.selected.flatMap((a, i) => a.kind === 'player' && selectedKeys[i].length === 0 && a.name ? [a.name.trim().toLowerCase()] : []))
  const seen = new Set<string>()
  return input.targets.filter(a => {
    const keys = identities(a)
    const dedupeKeys = keys.length ? keys : [a.id]
    if (!a.id || keys.some(key => ids.has(key)) || names.has(a.name.trim().toLowerCase()) ||
      (keys.length === 0 && input.selected.some(s => s.kind === 'player' && s.name?.trim().toLowerCase() === a.name.trim().toLowerCase())) ||
      dedupeKeys.some(key => seen.has(key)) || !Number.isFinite(a.marketValue) || a.marketValue <= 0) return false
    dedupeKeys.forEach(key => seen.add(key))
    return true
  })
}

/** One of the reader's own draft picks, as `loadTradeEngineRosterContext` prices it (`availablePicks`). */
export type CounterPickCandidate = { id: string; displayName?: string; round?: number; season?: number; value?: number }

/** `fdp:<season>:<round>:<originalTeamId>` (`inventoryPickId`) → the original team, which decides where it lands. */
function originalTeamOf(pickId: string): string | undefined {
  const m = /^fdp:\d+:\d+:(.+)$/.exec(pickId)
  return m ? m[1] : undefined
}

/**
 * Shortlist by market price, then re-evaluate the WHOLE package with the shared league grader.
 * A shortlist price is never presented as the resulting league value.
 *
 * Three kinds of counter (2026-11-11 — they used to be players only, and only ever added):
 *  - add one player from the side that should send more;
 *  - add one of YOUR draft picks, when you are the side that should send more. The other team's picks
 *    are not loaded here, so none is offered for them rather than one being guessed;
 *  - take one asset OFF the side that is ahead — "ask for less" / "send less" — when that side holds
 *    more than one, so a removal can never empty it.
 */
export async function evaluateCounterOffers(input: {
  grade: TradeGradeView
  give: TradeAssetInput[]
  get: TradeAssetInput[]
  yourTargets: TradeConsoleOpponentRosterTarget[]
  theirTargets: TradeConsoleOpponentRosterTarget[]
  /** Canonical provider IDs resolved by the grader, in selection order. */
  selectedProviderIds?: Array<{ provider: string; id: string } | null>
  /** Your own draft picks (`availablePicks`), offered only when you should send more. */
  yourPicks?: CounterPickCandidate[]
  evaluate: (give: TradeAssetInput[], get: TradeAssetInput[]) => Promise<TradeGradeView>
  canRecommend?: (give: TradeAssetInput[], get: TradeAssetInput[]) => Promise<boolean>
}): Promise<EvaluatedCounterOffer[]> {
  if (!input.grade.graded || input.grade.sideAdvantage === 'even') return []
  const baseline = Math.abs(input.grade.getValue - input.grade.giveValue)
  const addTo = input.grade.getValue < input.grade.giveValue ? 'get' : 'give'
  const players = availableRosterTargets({
    targets: addTo === 'get' ? input.theirTargets : input.yourTargets,
    selected: [...input.give, ...input.get], selectedProviderIds: input.selectedProviderIds,
  })
    .sort((a, b) => Math.abs(a.marketValue - baseline) - Math.abs(b.marketValue - baseline) || a.name.localeCompare(b.name))
    .slice(0, 4)

  const inDeal = new Set([...input.give, ...input.get].flatMap(a => (a.kind === 'pick' ? [`${a.year}:${a.round}`] : [])))
  const picks = addTo === 'give'
    ? (input.yourPicks ?? [])
        .filter(p => p.season != null && p.round != null && Number.isFinite(p.value) && (p.value as number) > 0
          // A pick of the same season and round already in the deal may be this one; skip rather than double it.
          && !inDeal.has(`${p.season}:${p.round}`))
        .sort((a, b) => Math.abs((a.value as number) - baseline) - Math.abs((b.value as number) - baseline) || a.id.localeCompare(b.id))
        .slice(0, 2)
    : []

  const evaluateOne = async (change: { action: 'add' | 'remove'; side: 'give' | 'get'; asset: TradeAssetInput; index?: number;
    name: string; id: string; position: string | null; marketValue: number }): Promise<EvaluatedCounterOffer | null> => {
    try {
      const without = (list: TradeAssetInput[]) => list.filter((_, i) => i !== change.index)
      const give = change.side === 'give' ? (change.action === 'add' ? [...input.give, change.asset] : without(input.give)) : input.give
      const get = change.side === 'get' ? (change.action === 'add' ? [...input.get, change.asset] : without(input.get)) : input.get
      if (input.canRecommend && !await input.canRecommend(give, get)) return null
      const grade = await input.evaluate(give, get)
      if (!grade.graded) return null
      const remainingGap = Math.abs(grade.getValue - grade.giveValue)
      if (remainingGap >= baseline || Math.abs(grade.percentDiff) >= Math.abs(input.grade.graded ? input.grade.percentDiff : 0)) return null
      const sideLines = (g: TradeGradeView) => (g.graded ? g.lines.filter(l => l.side === change.side) : [])
      return { action: change.action, addTo: change.side, ...(change.index != null ? { index: change.index } : {}),
        asset: change.asset, name: change.name, rosterPlayerId: change.id, position: change.position,
        marketValue: change.marketValue,
        // An added asset is last on its side; a removed one is read off the deal it came out of.
        assetLeagueValue: change.action === 'add'
          ? sideLines(grade).at(-1)?.leagueValue ?? null
          : sideLines(input.grade)[change.index ?? -1]?.leagueValue ?? null,
        grade, remainingGap, balanced: grade.sideAdvantage === 'even' } satisfies EvaluatedCounterOffer
    } catch { return null }
  }

  // The side that is AHEAD: what you get when you are winning, what you give when you are losing.
  const aheadSide: 'give' | 'get' = addTo === 'give' ? 'get' : 'give'
  const aheadAssets = aheadSide === 'get' ? input.get : input.give
  const removals = aheadAssets.length > 1
    ? aheadAssets.slice(0, 4).map((asset, index) => ({ asset, index })).filter(({ asset }) => asset.kind !== 'faab')
    : []

  const results = await Promise.all([
    ...players.map(candidate => evaluateOne({ action: 'add', side: addTo, id: candidate.id, name: candidate.name,
      position: candidate.position, marketValue: candidate.marketValue,
      asset: { kind: 'player', name: candidate.name,
        ...(candidate.providerIdentity ? { providerIdentity: candidate.providerIdentity } : {}),
        ...(candidate.playerId ? { playerId: candidate.playerId } : {}) } })),
    ...picks.map(p => {
      const originalRosterId = originalTeamOf(p.id)
      const label = p.displayName ?? `${p.season} round ${p.round}`
      return evaluateOne({ action: 'add', side: 'give', id: p.id, name: label, position: null, marketValue: Math.round(p.value as number),
        asset: { kind: 'pick', year: p.season as number, round: p.round as number, label, ...(originalRosterId ? { originalRosterId } : {}) } })
    }),
    ...removals.map(({ asset, index }) => evaluateOne({ action: 'remove', side: aheadSide, index, asset,
      id: `remove:${aheadSide}:${index}`,
      name: asset.kind === 'pick' ? asset.label ?? `${asset.year} round ${asset.round}` : asset.kind === 'player' ? asset.name ?? 'Player' : 'FAAB',
      position: null, marketValue: 0 })),
  ])
  return results.filter((r): r is EvaluatedCounterOffer => r !== null)
    .sort((a, b) => Math.abs(a.grade.percentDiff) - Math.abs(b.grade.percentDiff) || a.remainingGap - b.remainingGap)
    .slice(0, 3)
}
