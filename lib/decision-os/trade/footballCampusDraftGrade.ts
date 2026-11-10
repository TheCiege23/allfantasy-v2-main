import 'server-only'

import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { createNcaafLeagueGrader } from './ncaafLeagueGrader'
import type { TradeGradeView } from './tradeGrade'

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
  const college = createNcaafLeagueGrader({
    ...league, platform: league.platform, settings: null, campusOnly: true,
    leagueType: { type: 'dynasty', label: 'Campus division', source: 'confirmed', platform: null },
  })
  return async (give: readonly TradeAssetInput[], get: readonly TradeAssetInput[], dated = false): Promise<TradeGradeView | null> => {
    const picks = [...give, ...get].filter((asset) => asset.kind === 'pick')
    if (!picks.some((pick) => pick.draftSide === 'campus')) return null
    const settings = await (config ??= getC2CConfig(league.id).catch(() => null))
    if (dated || !settings || settings.standingsModel !== 'separate' || settings.mergedRookieCollegeDraft) {
      return { graded: false, reason: 'A Campus draft grade needs separate standings and a separate college draft with current scoring evidence.', basis: null }
    }
    if (settings.collegeScoringSystem !== 'ppr' || picks.some((pick) => pick.draftSide !== 'campus' || pick.round > settings.collegeDraftRounds)) {
      return { graded: false, reason: 'Compare picks in the Campus division only, within its configured rounds and supported PPR scoring.', basis: null }
    }
    const grade = await college.grade(give, get)
    return grade?.graded ? { ...grade, basis: 'Campus division. ' + grade.basis } : grade
  }
}
