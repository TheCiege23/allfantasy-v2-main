import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'

export type WarRoomAiContext = {
  leagueId: string
  sport: SupportedSport
  /** True when user has AF War Room subscription (bypasses league-only gate for personal tools). */
  hasWarRoomSubscription: boolean
  leagueSettings: {
    aiWarRoomEnabled: boolean
    aiPlayerOutlookEnabled: boolean
    aiPlayerCompareEnabled: boolean
    aiContingencyEnabled: boolean
    aiManagerTendencyEnabled: boolean
    aiPostDraftReportEnabled: boolean
    aiDefaultStrategyMode: string | null
    aiAggressiveness: string | null
    aiRookieBias: number | null
    aiStackPreference: string | null
    aiRiskTolerance: string | null
  } | null
  userPrefs: {
    riskProfile: string | null
    draftStyle: string | null
    dynastyWindow: string | null
    preferredBuild: string | null
    preferredPositionsJson: unknown
    fadePositionsJson: unknown
    aiStrategyModeDefault: string | null
    aiExplanationStyle: string | null
    aiVoicePreference: string | null
  } | null
}

export async function loadWarRoomAiContext(leagueId: string, userId: string): Promise<WarRoomAiContext | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueSettings: {
        select: {
          aiWarRoomEnabled: true,
          aiPlayerOutlookEnabled: true,
          aiPlayerCompareEnabled: true,
          aiContingencyEnabled: true,
          aiManagerTendencyEnabled: true,
          aiPostDraftReportEnabled: true,
          aiDefaultStrategyMode: true,
          aiAggressiveness: true,
          aiRookieBias: true,
          aiStackPreference: true,
          aiRiskTolerance: true,
        },
      },
    },
  })
  if (!league) return null

  const [profile, plans] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        riskProfile: true,
        draftStyle: true,
        dynastyWindow: true,
        preferredBuild: true,
        preferredPositionsJson: true,
        fadePositionsJson: true,
        aiStrategyModeDefault: true,
        aiExplanationStyle: true,
        aiVoicePreference: true,
      },
    }),
    // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
    resolveLivePlanFlags(userId),
  ])

  const hasWarRoomSubscription = plans.warRoom
  const userPrefs = profile
    ? {
        riskProfile: profile.riskProfile,
        draftStyle: profile.draftStyle,
        dynastyWindow: profile.dynastyWindow,
        preferredBuild: profile.preferredBuild,
        preferredPositionsJson: profile.preferredPositionsJson,
        fadePositionsJson: profile.fadePositionsJson,
        aiStrategyModeDefault: profile.aiStrategyModeDefault,
        aiExplanationStyle: profile.aiExplanationStyle,
        aiVoicePreference: profile.aiVoicePreference,
      }
    : null

  return {
    leagueId: league.id,
    sport: normalizeToSupportedSport(league.sport as SupportedSport),
    hasWarRoomSubscription,
    leagueSettings: league.leagueSettings,
    userPrefs,
  }
}

export function canUseWarRoomAi(
  ctx: WarRoomAiContext | null,
  feature: 'core' | 'outlook' | 'compare' | 'contingency' | 'tendency' | 'report'
): boolean {
  if (!ctx) return false
  if (ctx.hasWarRoomSubscription) return true
  const s = ctx.leagueSettings
  if (!s?.aiWarRoomEnabled) return false
  switch (feature) {
    case 'outlook':
      return s.aiPlayerOutlookEnabled
    case 'compare':
      return s.aiPlayerCompareEnabled
    case 'contingency':
      return s.aiContingencyEnabled
    case 'tendency':
      return s.aiManagerTendencyEnabled
    case 'report':
      return s.aiPostDraftReportEnabled
    default:
      return true
  }
}
