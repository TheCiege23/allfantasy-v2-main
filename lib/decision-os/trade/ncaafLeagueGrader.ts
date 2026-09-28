import 'server-only'

import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeView } from './tradeGrade'
import { loadNcaafRedraftBase, type NcaafRedraftBaseResult } from './ncaafRedraftContext'
import { gradeNcaafRedraftDeal, ncaafDealPositions, ncaafPickRefusal } from './ncaafRedraftValue'

/**
 * The college half of the one grade, shared by `createLeagueTradeGrader` and the Trade Center console
 * (which prices through `gradePricedSides` directly) so the two cannot grade a college deal differently.
 *
 *   - Any college league: a deal carrying a draft pick is not graded. In a redraft league there is no
 *     next season for a pick to be used in; elsewhere there is no college pick market yet (Phase 9).
 *   - A college REDRAFT league: points over replacement (`./ncaafRedraftValue.ts`).
 *   - Any other college league type: `null` — the chart path grades it, unchanged, until Phase 9.
 */
export type NcaafLeagueGrader = {
  /** A grade, or null when this league type is still graded on the chart path. */
  grade(give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView | null>
}

export type NcaafLeagueGraderDeps = {
  loadBase: typeof loadNcaafRedraftBase
}

export function createNcaafLeagueGrader(
  league: { id: string; platform: string | null | undefined; settings: unknown; leagueType: LeagueTypeBasis },
  deps: NcaafLeagueGraderDeps = { loadBase: loadNcaafRedraftBase },
): NcaafLeagueGrader {
  const isRedraft = String(league.leagueType.type).toLowerCase() === 'redraft'
  let base: Promise<NcaafRedraftBaseResult> | null = null
  const baseOnce = () =>
    (base ??= deps
      .loadBase({ id: league.id, platform: league.platform, settings: league.settings })
      .catch((): NcaafRedraftBaseResult => ({ ok: false, reason: 'This league’s college values could not be loaded just now.' })))

  return {
    async grade(give, get) {
      const pick = ncaafPickRefusal([...give, ...get], isRedraft)
      if (pick) return { graded: false, reason: pick, basis: null }
      if (!isRedraft) return null
      const loaded = await baseOnce()
      if (!loaded.ok) return { graded: false, reason: loaded.reason, basis: null }
      const { rostered, perGameByRosterId, window } = loaded.base
      const replacementByPosition = await loaded.base.replacementFor(ncaafDealPositions([...give, ...get], rostered, perGameByRosterId))
      return gradeNcaafRedraftDeal({ give, get, ctx: { rostered, perGameByRosterId, replacementByPosition, window } })
    },
  }
}
