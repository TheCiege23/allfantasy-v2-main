import 'server-only'

import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeView } from './tradeGrade'
import {
  loadSportPointsBase,
  type SportPointsBaseResult,
  type SportPointsLeague,
  type SportScoringFormat,
} from './sportPointsContext'
import { gradeSportPointsDeal, isPointsGradedSport, type PointsGradedSport } from './sportPointsValue'
import { loadCachedLeagueBoardBase } from '../value-os/leagueBoard'
import { gradeSportDynastyDeal, isDynastyGradedSport } from './sportDynastyValue'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { createNbaCampusTradeGrader } from './nbaCampusTradeValue'
import { pointsSeasonsFromLeagueBook } from './conceptGradingRegistry'
import { leagueVariantFor } from '@/lib/core-app/valueBook'

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
type SportPointsGrader = {
  grade(give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView>
}

type SportPointsGraderDeps = {
  loadBase: typeof loadSportPointsBase
  /**
   * The in-league board, through Value OS's cache (2026-11-21) — the board every value surface reads, so a trade
   * grade and a value answer price a player alike. Absent (as in tests that inject `loadBase`): `loadBase` is used.
   */
  loadLeagueBase?: (args: { sport: PointsGradedSport; league: SportPointsLeague }) => Promise<SportPointsBaseResult>
}

/**
 * 🛑 PIRATE AND EFL SIT ON A BOOK, AND THE BOOK DECIDES HOW MANY SEASONS COUNT (owner's fix, 2026-11-26).
 *
 * The loader reads the seasons off the league type (`isDynastyLeagueType`), and neither `pirate` nor `efl`
 * contains "dynasty" — so a Pirate or EFL league outside football was graded on this season alone, valuing a
 * 21-year-old exactly like a 33-year-old in a league that keeps both for years. The concept registry marks
 * those rows `seasons: 'league_book'`; for them the loader is handed the league's BOOK as its type — the one
 * answer `leagueVariantFor` gives every value surface (EFL always dynasty; Pirate dynasty unless the
 * commissioner confirmed a redraft base). Every other league is passed through untouched.
 */
function bookSeasonsLeague(league: SportPointsLeague | null, sport: string): SportPointsLeague | null {
  if (!league || !pointsSeasonsFromLeagueBook(league.leagueType, sport)) return league
  return { ...league, leagueType: leagueVariantFor(league.settings, league.leagueType).dynasty ? 'dynasty' : 'redraft' }
}

export function createSportPointsGrader(
  args: {
    sport: string | null | undefined
    league: SportPointsLeague | null
    /** The open analyzer's scoring choice (points, or a category preset). A league uses its own settings. */
    format?: SportScoringFormat | null
  },
  deps: SportPointsGraderDeps = { loadBase: loadSportPointsBase, loadLeagueBase: (a) => loadCachedLeagueBoardBase(a) },
): SportPointsGrader | null {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  if (!isPointsGradedSport(sport)) return null
  const league = bookSeasonsLeague(args.league, sport)
  if (sport === 'NBA' && league?.leagueType === 'c2c' && isNativePlatform(league.platform)) {
    const grade = createNbaCampusTradeGrader(league, deps.loadBase)
    return { async grade(give, get) {
      try { return await grade(give, get) }
      catch { return { graded: false, reason: 'Campus-to-Canton values could not be loaded just now.', basis: null } }
    } }
  }
  let base: Promise<SportPointsBaseResult> | null = null
  const baseOnce = () =>
    (base ??= (league && deps.loadLeagueBase
      ? deps.loadLeagueBase({ sport, league })
      : deps.loadBase({ sport, league, format: league ? null : args.format ?? null }))
      .catch((): SportPointsBaseResult => ({ ok: false, reason: `This league’s ${sport} values could not be loaded just now.` })))

  return {
    async grade(give, get) {
      const loaded = await baseOnce()
      if (!loaded.ok) return { graded: false, reason: loaded.reason, basis: null, ...(loaded.valuationGap ? { valuationGap: loaded.valuationGap } : {}) }
      const { ctx } = loaded
      // An NBA, NHL or MLB dynasty league: five seasons and draft picks (`./sportDynastyValue.ts`).
      if (ctx.dynasty && isDynastyGradedSport(ctx.sport)) {
        return gradeSportDynastyDeal({ give, get, ctx: { ...ctx, sport: ctx.sport }, dynasty: ctx.dynasty })
      }
      return gradeSportPointsDeal({ give, get, ctx })
    },
  }
}
