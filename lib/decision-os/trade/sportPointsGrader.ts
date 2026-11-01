import 'server-only'

import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeView } from './tradeGrade'
import {
  loadSportPointsBase,
  type SportPointsBaseResult,
  type SportPointsLeague,
  type SportScoringFormat,
} from './sportPointsContext'
import { gradeSportPointsDeal, isPointsGradedSport } from './sportPointsValue'
import { gradeSportDynastyDeal, isDynastyGradedSport } from './sportDynastyValue'

/**
 * The daily-sport half of the one grade — NBA, college basketball, NHL — shared by
 * `createLeagueTradeGrader` and the Trade Center console (in a league and in the open analyzer), so no
 * two surfaces can grade one of these deals differently. Null for every other sport.
 *
 * Every view it returns is final for that deal: a letter on points over replacement, or withheld with
 * the reason (a category league it cannot read, a keeper league, a thin projection, a pick outside a
 * dynasty league). An NBA, NHL or MLB dynasty league is graded over five seasons, picks included. It
 * never falls through to the NFL chart, which prices none of these sports.
 */
export type SportPointsGrader = {
  grade(give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView>
}

export type SportPointsGraderDeps = { loadBase: typeof loadSportPointsBase }

export function createSportPointsGrader(
  args: {
    sport: string | null | undefined
    league: SportPointsLeague | null
    /** The open analyzer's scoring choice (points, or a category preset). A league uses its own settings. */
    format?: SportScoringFormat | null
  },
  deps: SportPointsGraderDeps = { loadBase: loadSportPointsBase },
): SportPointsGrader | null {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  if (!isPointsGradedSport(sport)) return null
  let base: Promise<SportPointsBaseResult> | null = null
  const baseOnce = () =>
    (base ??= deps
      .loadBase({ sport, league: args.league, format: args.league ? null : args.format ?? null })
      .catch((): SportPointsBaseResult => ({ ok: false, reason: `This league’s ${sport} values could not be loaded just now.` })))

  return {
    async grade(give, get) {
      const loaded = await baseOnce()
      if (!loaded.ok) return { graded: false, reason: loaded.reason, basis: null }
      const { ctx } = loaded
      // An NBA, NHL or MLB dynasty league: five seasons and draft picks (`./sportDynastyValue.ts`).
      if (ctx.dynasty && isDynastyGradedSport(ctx.sport)) {
        return gradeSportDynastyDeal({ give, get, ctx: { ...ctx, sport: ctx.sport }, dynasty: ctx.dynasty })
      }
      return gradeSportPointsDeal({ give, get, ctx })
    },
  }
}
