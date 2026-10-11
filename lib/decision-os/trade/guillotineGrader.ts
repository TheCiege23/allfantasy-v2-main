import 'server-only'

import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeView } from './tradeGrade'
import { loadGuillotineContext, type GuillotineContextResult } from './guillotineContext'
import { gradeGuillotineDeal, isGuillotineTradeLeague } from './guillotineValue'

/**
 * The guillotine half of the one grade (`createLeagueTradeGrader`): an NFL guillotine league is graded on
 * points over the free agent for the same lineup slot and FAAB's purchasing power (`./guillotineValue.ts`),
 * never on the market chart. Null for every other league.
 *
 * Every view it returns is final for that deal — a letter, or withheld with the reason. It never falls
 * through to the market chart, whose 2-QB board and linear FAAB are what Guap measured as wrong here.
 *
 * Not `survivor_guillotine`: that format allows no trades.
 */
export type GuillotineGrader = {
  grade(give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView>
}

export type GuillotineGraderDeps = { loadContext: typeof loadGuillotineContext }

export { isGuillotineTradeLeague }

export function createGuillotineGrader(
  args: {
    sport: string | null | undefined
    leagueType: string | null | undefined
    leagueVariant?: string | null
    league: { id: string; settings: unknown; leagueSize: number | null }
  },
  deps: GuillotineGraderDeps = { loadContext: loadGuillotineContext },
): GuillotineGrader | null {
  if (!isGuillotineTradeLeague(args)) return null
  let ctx: Promise<GuillotineContextResult> | null = null
  const ctxOnce = () =>
    (ctx ??= deps
      .loadContext(args.league)
      .catch((): GuillotineContextResult => ({ ok: false, reason: 'This guillotine league’s values could not be loaded just now.' })))

  return {
    async grade(give, get) {
      const loaded = await ctxOnce()
      if (!loaded.ok) return { graded: false, reason: loaded.reason, basis: null }
      return gradeGuillotineDeal({ give, get, ctx: loaded.ctx })
    },
  }
}
