import 'server-only'

import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { TradeGradeView } from './tradeGrade'
import { loadNcaafClassYears, loadNcaafRedraftBase, type NcaafRedraftBaseResult } from './ncaafRedraftContext'
import { gradeNcaafRedraftDeal, ncaafDealPositions, ncaafPickRefusal } from './ncaafRedraftValue'
import { gradeSportDynastyDeal, isDynastyLeagueType, FULL_SEASON_GAMES } from './sportDynastyValue'
import { nextRookieDraftYear } from './sportPointsContext'
import { indexBoard, type BoardPlayer } from './sportPointsValue'

/**
 * The college half of the one grade, shared by `createLeagueTradeGrader` and the Trade Center console
 * (which prices through `gradePricedSides` directly) so the two cannot grade a college deal differently.
 *
 * Redraft uses points over replacement. Dynasty adds seasons based on class year
 * and prices picks from the projected freshman pool. Other formats use their existing chart path.
 */
export type NcaafLeagueGrader = {
  /** A grade, or null when this league type is still graded on the chart path. */
  grade(give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView | null>
}

export type NcaafLeagueGraderDeps = {
  loadBase: typeof loadNcaafRedraftBase
  loadClassYears?: typeof loadNcaafClassYears
}

export function createNcaafLeagueGrader(
  league: {
    id: string
    platform: string | null | undefined
    settings: unknown
    leagueType: LeagueTypeBasis
    leagueSize?: number | null
    season?: number | null
    status?: string | null
    campusOnly?: boolean
  },
  deps: NcaafLeagueGraderDeps = { loadBase: loadNcaafRedraftBase },
): NcaafLeagueGrader {
  const isRedraft = String(league.leagueType.type).toLowerCase() === 'redraft'
  const isDynasty = isDynastyLeagueType(league.leagueType.type)
  let base: Promise<NcaafRedraftBaseResult> | null = null
  let eligibility: Promise<Map<string, number>> | null = null
  const baseOnce = () =>
    (base ??= deps
      .loadBase({ id: league.id, platform: league.platform, settings: league.settings, ...(league.campusOnly ? { campusOnly: true } : {}) })
      .catch((): NcaafRedraftBaseResult => ({ ok: false, reason: 'This league’s college values could not be loaded just now.' })))

  return {
    async grade(give, get) {
      if (!isDynasty) {
        const pick = ncaafPickRefusal([...give, ...get], isRedraft)
        if (pick) return { graded: false, reason: pick, basis: null }
        if (!isRedraft) return null
      }
      const loaded = await baseOnce()
      if (!loaded.ok) return { graded: false, reason: loaded.reason, basis: null, ...(loaded.valuationGap ? { valuationGap: loaded.valuationGap } : {}) }
      const { rostered, perGameByRosterId, window } = loaded.base
      const assets = [...give, ...get]
      if (league.campusOnly && (league.season !== window.season || assets.some((asset) => asset.kind === 'player' &&
        !rostered.some((player) => player.rosterPlayerId === (asset.rosterPlayerId ?? asset.playerId))))) {
        return { graded: false, reason: 'Each player needs a verified Campus roster ID and projections for this league season.', basis: null }
      }
      const positions = ncaafDealPositions(assets, rostered, perGameByRosterId)
      if (isDynasty) {
        const board: BoardPlayer[] = rostered.flatMap((player) => {
          const line = perGameByRosterId.get(player.rosterPlayerId)
          const position = line?.position ?? player.position
          return line && position ? [{
            id: player.rosterPlayerId, name: player.name, position, perGame: line.perGame, aliases: [], sampleGames: null,
          }] : []
        })
        const classYears = await (eligibility ??= (deps.loadClassYears ?? loadNcaafClassYears)(
          league.platform, board.map((p) => p.id), window.season, ...(league.campusOnly ? [true] as const : []),
        ).catch(() => new Map()))
        const hasPicks = assets.some((asset) => asset.kind === 'pick')
        const teams = league.leagueSize
        if (hasPicks && (teams == null || !Number.isInteger(teams) || teams < 2)) {
          return { graded: false, reason: 'The league’s team count is needed to price its college dynasty picks.', basis: null }
        }
        const freshmanPositions = hasPicks ? board.filter((p) => classYears.get(p.id) === 1).map((p) => p.position) : []
        const replacementByPosition = await loaded.base.replacementFor([...new Set([...positions, ...freshmanPositions])])
        return gradeSportDynastyDeal({
          give, get,
          ctx: {
            sport: 'NCAAF', board, rosterIndex: indexBoard(board, true), replacementByPosition,
            window: { season: window.season, seasonLabel: String(window.season), gamesRemaining: window.weeks },
            scoringBasis: 'league', teams: teams ?? 12,
          },
          dynasty: { ages: new Map(), classYears, nextDraftYear: nextRookieDraftYear(league, window.season, window.weeks, FULL_SEASON_GAMES.NCAAF) },
        })
      }
      const replacementByPosition = await loaded.base.replacementFor(positions)
      return gradeNcaafRedraftDeal({ give, get, ctx: { rostered, perGameByRosterId, replacementByPosition, window } })
    },
  }
}
