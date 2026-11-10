import 'server-only'

import { prisma } from '@/lib/prisma'
import { collegePlayerIds } from '@/lib/c2c/campusLineup'
import { gradeOnLeagueValue } from '@/lib/trade-value-console/leagueGrade'
import { applyChartTePremium, resolveAssets, type LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { createNcaafLeagueGrader } from './ncaafLeagueGrader'
import { separateStandingsTradeGrade, type TradeGradeView } from './tradeGrade'

async function priceCantonDivision(chart: LeagueTradeChart, give: TradeAssetInput[], get: TradeAssetInput[]) {
  if (!chart.marketCtx) return null
  const opts = {
    effectiveSport: 'NFL' as const, nflCtx: chart.nflCtx, waiverBudget: chart.waiverBudget,
    dataGaps: [], fcPlayers: chart.fcPlayers, pickSlots: chart.pickSlots, resolveEnrichmentIds: false,
  }
  const [left, right] = await Promise.all([resolveAssets(give, opts), resolveAssets(get, opts)])
  if (left.unresolved.length || right.unresolved.length) return null
  const { totals } = gradeOnLeagueValue({
    giveLines: left.lines, getLines: right.lines,
    givePriced: applyChartTePremium(chart, left.priced), getPriced: applyChartTePremium(chart, right.priced),
    league: { scoringSettings: chart.marketCtx.scoring.settings },
    chart: { dynasty: chart.chartIsDynasty, superflex: chart.isSuperFlex, teams: chart.leagueSize, ppr: chart.pprNfl }, needFactors: null,
  })
  return totals.unpriced > 0 ? null : { giveValue: totals.giveLeague, getValue: totals.getLeague }
}

export function createFootballCampusDraftGrader(league: {
  id: string
  platform?: string | null
  leagueSize?: number | null
  season?: number | null
  status?: string | null
  type: string
}) {
  if (league.type !== 'c2c' || !isNativePlatform(league.platform)) return null
  let config: ReturnType<typeof getC2CConfig> | undefined
  let rosteredCampus: Promise<Set<string>> | undefined
  const college = createNcaafLeagueGrader({
    ...league, platform: league.platform, settings: null, campusOnly: true,
    leagueType: { type: 'dynasty', label: 'Campus division', source: 'confirmed', platform: null },
  })
  return async (give: readonly TradeAssetInput[], get: readonly TradeAssetInput[], dated = false, chart?: LeagueTradeChart): Promise<TradeGradeView | null> => {
    const all = [...give, ...get]
    const picks = all.filter((asset) => asset.kind === 'pick')
    const campusPick = picks.some((pick) => pick.draftSide === 'campus')
    if (!campusPick && (!chart || dated)) return null
    const settings = await (config ??= getC2CConfig(league.id).catch(() => null))
    if (dated || !settings || settings.standingsModel !== 'separate' || settings.mergedRookieCollegeDraft) {
      if (!campusPick) return null
      return { graded: false, reason: 'A Campus draft grade needs separate standings and a separate college draft with current scoring evidence.', basis: null }
    }
    if (chart) {
      const ids = await (rosteredCampus ??= prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } })
        .then((rows) => new Set(rows.flatMap((row) => [...collegePlayerIds(row.playerData)]))).catch(() => new Set<string>()))
      const onCampus = (asset: TradeAssetInput) => asset.kind === 'pick' ? asset.draftSide === 'campus'
        : asset.kind === 'player' && ids.has(asset.rosterPlayerId ?? asset.playerId ?? '')
      const campusCount = all.filter(onCampus).length
      if (!campusCount) return null
      if (settings.collegeScoringSystem !== 'ppr' || picks.some((pick) => !pick.draftSide || pick.draftSide === 'combined' ||
          pick.round > (onCampus(pick) ? settings.collegeDraftRounds : settings.rookieDraftRounds)) || all.some((asset) => asset.kind === 'faab')) {
        return { graded: false, reason: 'Use verified Campus or Canton picks within their configured rounds. Campus uses PPR, and FAAB has no division value.', basis: null }
      }
      if (campusCount !== all.length) {
        const [campus, canton] = await Promise.all([
          college.priceDivision(give.filter(onCampus), get.filter(onCampus)),
          priceCantonDivision(chart, give.filter((asset) => !onCampus(asset)), get.filter((asset) => !onCampus(asset))).catch(() => null),
        ])
        if (campus && !campus.graded) return campus
        if (!campus?.graded || !('giveTotal' in campus) || !canton) {
          return { graded: false, reason: 'Both divisions need verified prices to compare this deal’s separate impacts.', basis: null }
        }
        return separateStandingsTradeGrade([
          { division: 'Campus', giveValue: campus.giveTotal, getValue: campus.getTotal },
          { division: 'Canton', ...canton },
        ])
      }
    }
    if (settings.collegeScoringSystem !== 'ppr' || picks.some((pick) => pick.draftSide !== 'campus' || pick.round > settings.collegeDraftRounds)) {
      return { graded: false, reason: 'Compare picks in the Campus division only, within its configured rounds and supported PPR scoring.', basis: null }
    }
    const grade = await college.grade(give, get)
    return grade?.graded ? { ...grade, basis: 'Campus division. ' + grade.basis } : grade
  }
}
