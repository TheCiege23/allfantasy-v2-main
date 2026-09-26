import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { TradeAssetInput, TradeConsoleOpponentRosterTarget } from './types'

export type EvaluatedCounterOffer = {
  addTo: 'give' | 'get'
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

/** Shortlist by market price, then re-evaluate the WHOLE package with the shared league grader.
 * A shortlist price is never presented as the resulting league value. */
export async function evaluateCounterOffers(input: {
  grade: TradeGradeView
  give: TradeAssetInput[]
  get: TradeAssetInput[]
  yourTargets: TradeConsoleOpponentRosterTarget[]
  theirTargets: TradeConsoleOpponentRosterTarget[]
  evaluate: (give: TradeAssetInput[], get: TradeAssetInput[]) => Promise<TradeGradeView>
}): Promise<EvaluatedCounterOffer[]> {
  if (!input.grade.graded || input.grade.sideAdvantage === 'even') return []
  const baseline = Math.abs(input.grade.getValue - input.grade.giveValue)
  const addTo = input.grade.getValue < input.grade.giveValue ? 'get' : 'give'
  const selected = [...input.give, ...input.get]
  const ids = new Set(selected.flatMap(a => a.kind === 'player' && a.playerId ? [a.playerId] : []))
  const names = new Set(selected.flatMap(a => a.kind === 'player' && a.name ? [a.name.trim().toLowerCase()] : []))
  const seen = new Set<string>()
  const candidates = (addTo === 'get' ? input.theirTargets : input.yourTargets)
    .filter(a => {
      if (!a.id || ids.has(a.id) || names.has(a.name.trim().toLowerCase()) || seen.has(a.id) || !Number.isFinite(a.marketValue) || a.marketValue <= 0) return false
      seen.add(a.id)
      return true
    })
    .sort((a, b) => Math.abs(a.marketValue - baseline) - Math.abs(b.marketValue - baseline) || a.name.localeCompare(b.name))
    .slice(0, 4)
  const results = await Promise.all(candidates.map(async (candidate): Promise<EvaluatedCounterOffer | null> => {
    // Roster IDs may belong to a different provider namespace than the resolver. Resolve by name,
    // while retaining the roster ID for duplicate checks above.
    const asset: TradeAssetInput = { kind: 'player', name: candidate.name }
    try {
      const grade = await input.evaluate(
        addTo === 'give' ? [...input.give, asset] : input.give,
        addTo === 'get' ? [...input.get, asset] : input.get,
      )
      if (!grade.graded) return null
      const remainingGap = Math.abs(grade.getValue - grade.giveValue)
      if (remainingGap >= baseline || Math.abs(grade.percentDiff) >= Math.abs(input.grade.graded ? input.grade.percentDiff : 0)) return null
      return { addTo, asset, name: candidate.name, rosterPlayerId: candidate.id, position: candidate.position,
        marketValue: candidate.marketValue,
        assetLeagueValue: grade.lines.find(l => l.side === addTo && l.name.trim().toLowerCase() === candidate.name.trim().toLowerCase())?.leagueValue ?? null,
        grade, remainingGap, balanced: grade.sideAdvantage === 'even' } satisfies EvaluatedCounterOffer
    } catch { return null }
  }))
  return results.filter((r): r is EvaluatedCounterOffer => r !== null)
    .sort((a, b) => Math.abs(a.grade.percentDiff) - Math.abs(b.grade.percentDiff) || a.remainingGap - b.remainingGap)
    .slice(0, 3)
}
