import 'server-only'

import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { readStoredLeagueTradeChart, type LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { loadNcaafRedraftBase } from './ncaafRedraftContext'
import { resolveNcaafRosteredPlayer } from './ncaafRedraftValue'
import { DYNASTY_SEASONS, FULL_SEASON_GAMES, FUTURE_DISCOUNT } from './sportDynastyValue'
import type { TradeGradeLine } from './tradeGrade'

const SKILL = new Set(['QB', 'RB', 'WR', 'TE'])
const MIN_ANCHORS = 8
const MAX_ANCHORS = 24

/** Match the upper portions of the observed campus production and pro value distributions. */
export function campusPointsToMarket(campus: readonly number[], canton: readonly number[], collegeGames = FULL_SEASON_GAMES.NCAAF): number | null {
  const usable = (rows: readonly number[]) => rows.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a)
  const campusRanks = usable(campus)
  const proRanks = usable(canton)
  const n = Math.min(campusRanks.length, proRanks.length, MAX_ANCHORS)
  if (n < MIN_ANCHORS) return null
  const sum = (rows: readonly number[]) => rows.slice(0, n).reduce((a, b) => a + b, 0)
  const proHorizon = Array.from({ length: DYNASTY_SEASONS }, (_, year) => FUTURE_DISCOUNT ** year).reduce((a, b) => a + b, 0)
  return sum(proRanks) / (sum(campusRanks) * collegeGames * proHorizon)
}

async function optionChartFactor(chart: LeagueTradeChart): Promise<number | null> {
  if (!chart.chartIsDynasty) return null
  if (chart.isSuperFlex && chart.leagueSize === 12 && chart.pprNfl === 1) return 1
  const reference = await readStoredLeagueTradeChart({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })
  const values = new Map(reference.players.filter((p) => p.player.sleeperId && p.value > 0).map((p) => [p.player.sleeperId, p.value]))
  const ratios = chart.fcPlayers.flatMap((p) => {
    const base = values.get(p.player.sleeperId)
    return base && p.value > 0 && SKILL.has(p.player.position) ? [p.value / base] : []
  }).sort((a, b) => a - b)
  return ratios.length >= MIN_ANCHORS ? ratios[Math.floor(ratios.length / 2)]! : null
}

export async function loadFootballCampusTradeEvidence(
  league: { id: string; platform?: string | null; season?: number | null },
  chart: LeagueTradeChart,
) {
  if (!league.season || !isNativePlatform(league.platform)) return null
  const [config, campus, optionFactor] = await Promise.all([
    getC2CConfig(league.id),
    loadNcaafRedraftBase({ id: league.id, platform: league.platform, settings: null, campusOnly: true }),
    optionChartFactor(chart),
  ])
  if (!config || !campus.ok || campus.base.window.season !== league.season || (optionFactor == null && config.standingsModel !== 'separate')) return null
  const proWeight = config.hybridProWeight ?? 60
  if (config.standingsModel === 'hybrid' && (!(proWeight > 0) || proWeight > 100)) return null
  const campusWeight = config.standingsModel === 'hybrid' ? (100 - proWeight) / proWeight : 1
  const { rostered, perGameByRosterId, replacementFor, window } = campus.base
  const replacement = await replacementFor([...SKILL])
  const production = new Map<string, number>()
  for (const p of rostered) {
    const line = perGameByRosterId.get(p.rosterPlayerId)
    const position = (line?.position ?? p.position ?? '').toUpperCase()
    const free = replacement.get(position)
    if (line && free && SKILL.has(position)) production.set(p.rosterPlayerId, Math.max(0, line.perGame - free.perGame))
  }
  const separate = config.standingsModel === 'separate'
  const marketRate = separate ? 1 : campusPointsToMarket(
    [...production.values()],
    chart.fcPlayers.filter((p) => p.player.sleeperId && SKILL.has(p.player.position)).map((p) => p.value),
  )
  if (marketRate == null) return null

  return {
    season: window.season,
    weeks: window.weeks,
    separate,
    price(asset: Extract<TradeAssetInput, { kind: 'player' }>, line: TradeGradeLine): number | null {
      const player = resolveNcaafRosteredPlayer({ ...asset, name: asset.name ?? line.name }, rostered)
      if (!player.ok || line.marketValue == null) return null
      const points = production.get(player.player.rosterPlayerId)
      if (points == null) return null
      return separate ? points * window.weeks : line.marketValue * (optionFactor ?? 0) + points * window.weeks * marketRate * campusWeight
    },
  }
}
