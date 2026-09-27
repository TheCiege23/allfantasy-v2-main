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
  canRecommend?: (give: TradeAssetInput[], get: TradeAssetInput[]) => Promise<boolean>
}): Promise<EvaluatedCounterOffer[]> {
  if (!input.grade.graded || input.grade.sideAdvantage === 'even') return []
  const baseline = Math.abs(input.grade.getValue - input.grade.giveValue)
  const addTo = input.grade.getValue < input.grade.giveValue ? 'get' : 'give'
  const selected = [...input.give, ...input.get]
  const identity = (a: { playerId?: string; providerIdentity?: { provider: string; id: string } }) =>
    a.providerIdentity ? `${a.providerIdentity.provider}:${a.providerIdentity.id}` : a.playerId ? `record:${a.playerId}` : null
  const ids = new Set(selected.flatMap(a => a.kind === 'player' && identity(a) ? [identity(a)!] : []))
  const names = new Set(selected.flatMap(a => a.kind === 'player' && !identity(a) && a.name ? [a.name.trim().toLowerCase()] : []))
  const seen = new Set<string>()
  const candidates = (addTo === 'get' ? input.theirTargets : input.yourTargets)
    .filter(a => {
      const key = identity(a)
      if (!a.id || (key && ids.has(key)) || names.has(a.name.trim().toLowerCase()) ||
        (!key && selected.some(s => s.kind === 'player' && s.name?.trim().toLowerCase() === a.name.trim().toLowerCase())) ||
        seen.has(key ?? a.id) || !Number.isFinite(a.marketValue) || a.marketValue <= 0) return false
      seen.add(key ?? a.id)
      return true
    })
    .sort((a, b) => Math.abs(a.marketValue - baseline) - Math.abs(b.marketValue - baseline) || a.name.localeCompare(b.name))
    .slice(0, 4)
  const results = await Promise.all(candidates.map(async (candidate): Promise<EvaluatedCounterOffer | null> => {
    const asset: TradeAssetInput = { kind: 'player', name: candidate.name,
      ...(candidate.providerIdentity ? { providerIdentity: candidate.providerIdentity } : {}),
      ...(candidate.playerId ? { playerId: candidate.playerId } : {}) }
    try {
      const give = addTo === 'give' ? [...input.give, asset] : input.give
      const get = addTo === 'get' ? [...input.get, asset] : input.get
      if (input.canRecommend && !await input.canRecommend(give, get)) return null
      const grade = await input.evaluate(
        give, get,
      )
      if (!grade.graded) return null
      const remainingGap = Math.abs(grade.getValue - grade.giveValue)
      if (remainingGap >= baseline || Math.abs(grade.percentDiff) >= Math.abs(input.grade.graded ? input.grade.percentDiff : 0)) return null
      return { addTo, asset, name: candidate.name, rosterPlayerId: candidate.id, position: candidate.position,
        marketValue: candidate.marketValue,
        // The added asset is last on this side, even if an earlier asset shares its name.
        assetLeagueValue: grade.lines.filter(l => l.side === addTo).at(-1)?.leagueValue ?? null,
        grade, remainingGap, balanced: grade.sideAdvantage === 'even' } satisfies EvaluatedCounterOffer
    } catch { return null }
  }))
  return results.filter((r): r is EvaluatedCounterOffer => r !== null)
    .sort((a, b) => Math.abs(a.grade.percentDiff) - Math.abs(b.grade.percentDiff) || a.remainingGap - b.remainingGap)
    .slice(0, 3)
}
