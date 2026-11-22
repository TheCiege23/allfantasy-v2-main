import 'server-only'

import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { buildAiTimeContextPayload } from '@/lib/time-engine/userContext'
import { estimateNextWaiversProcessUTC } from '@/lib/time-engine/estimateWaiverRun'
import { getServerNowUTC } from '@/lib/time-engine/serverClock'
import type { FantasyTimeEngineExtras } from '@/lib/time-engine/fantasyTimePayload'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { computeIntelligencePlatformHealth } from '@/lib/intelligence/computePlatformHealth'
import type { IntelligencePlatformHealth } from '@/lib/intelligence/types'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import { resolveLearningLayersForPayload } from '@/lib/ai-learning-system/resolveLearningLayers'
import type { AllFantasyStandardAiPayload } from '@/lib/ai-payload/types'
import { buildLongTermCoachingAnalysis } from '@/lib/long-term-coaching/buildLongTermCoachingAnalysis'
import { strategicCoachingFromAnalysis } from '@/lib/long-term-coaching/strategicCoachingSnapshot'

type BuildStandardAiPayloadArgs = {
  userId: string
  tool: string
  mode: 'global' | 'league'
  /** When global or league row missing; overridden by league context when present. */
  sport?: string | null
  league?: { leagueId: string; leagueName: string | null; sport: string } | null
  toolInput: Record<string, unknown>
  enrichTimeFromLeagueId?: string | null
  includeHealth?: boolean
  /** When true (default for league mode), loads roster/standings from DB. */
  includeTeamContext?: boolean
  preferredTeamId?: string | null
  preferredTeamExternalId?: string | null
  providerHints?: AllFantasyStandardAiPayload['providerHints']
  /** When false, skips DB reads for `learningLayers` (default: true). */
  includeLearningLayers?: boolean
  /**
   * When true, attaches `strategicCoaching` for the signed-in user’s team (not `preferredTeamExternalId`).
   * Extra DB/projection work — enable only for strategic tools (war room, trade, waiver, etc.).
   */
  includeStrategicCoaching?: boolean
}

/**
 * Single builder for structured AI context — OpenAI / DeepSeek / Grok / Chimmy.
 */
export async function buildStandardAiPayload(
  args: BuildStandardAiPayloadArgs,
): Promise<AllFantasyStandardAiPayload> {
  const computedAt = new Date().toISOString()
  const includeTeam = args.includeTeamContext !== false && args.mode === 'league'
  const lid = args.enrichTimeFromLeagueId?.trim() ?? args.league?.leagueId?.trim() ?? null

  let leagueCtxResult = null as Awaited<ReturnType<typeof resolveNormalizedLeagueContext>> | null
  if (lid) {
    leagueCtxResult = await resolveNormalizedLeagueContext({
      userId: args.userId,
      leagueId: lid,
      preferredTeamId: args.preferredTeamId ?? undefined,
      preferredTeamExternalId: args.preferredTeamExternalId ?? undefined,
    })
  }

  const resolvedLeague = leagueCtxResult?.ok ? leagueCtxResult.context : null
  const leagueContext = args.mode === 'league' ? resolvedLeague : null
  let sport = normalizeToSupportedSport(
    resolvedLeague?.sport ?? args.league?.sport ?? args.sport ?? 'NFL',
  )

  let timeExtras: FantasyTimeEngineExtras | undefined
  if (lid && leagueCtxResult?.ok) {
    const n = resolvedLeague!
    sport = normalizeToSupportedSport(n.sport)
    const nextWaiver = estimateNextWaiversProcessUTC({
      leagueTimezone: n.timezone,
      waiverProcessTime: n.waiver.waiverProcessTime,
      serverNow: getServerNowUTC(),
    })
    timeExtras = {
      sportHint: sport,
      waiversProcessAt: nextWaiver?.toISOString() ?? null,
      matchupLockAt: null,
      tradeExpiresAt: null,
    }
  } else if (lid) {
    timeExtras = { sportHint: sport, waiversProcessAt: null, matchupLockAt: null, tradeExpiresAt: null }
  }

  const timeContext = await buildAiTimeContextPayload(args.userId, timeExtras)
  let platformHealth: IntelligencePlatformHealth | null = null
  if (args.includeHealth) {
    platformHealth = await computeIntelligencePlatformHealth()
  }

  let teamContext = null as Awaited<ReturnType<typeof resolveAiTeamContext>> | null
  if (includeTeam && resolvedLeague && lid) {
    teamContext = await resolveAiTeamContext({
      userId: args.userId,
      leagueId: lid,
      sport: resolvedLeague.sport,
      season: resolvedLeague.season,
      currentPeriod: resolvedLeague.matchupPeriod.currentPeriod,
      teamExternalId: args.preferredTeamExternalId ?? null,
    })
  }

  const dataFreshness: AllFantasyStandardAiPayload['dataFreshness'] = {
    timestamps: timeContext.dataFreshness,
    leagueLastSyncedAt: resolvedLeague?.importHealth.lastSyncedAt ?? null,
    importMappingOk: resolvedLeague?.importHealth.mappingOk ?? null,
    computedAt,
  }

  const toolInput = { ...args.toolInput }
  const data = { ...toolInput }

  const includeLearning = args.includeLearningLayers !== false
  let learningLayers: AllFantasyStandardAiPayload['learningLayers'] = null
  if (includeLearning) {
    learningLayers = await resolveLearningLayersForPayload({
      userId: args.userId,
      sport,
      leagueId: lid,
    })
  }

  let strategicCoaching: AllFantasyStandardAiPayload['strategicCoaching'] = null
  if (args.includeStrategicCoaching === true && args.mode === 'league' && lid) {
    try {
      const raw = await buildLongTermCoachingAnalysis({
        userId: args.userId,
        leagueId: lid,
        horizonYears: 3,
        strategyMode: 'auto',
        teamExternalId: null,
      })
      if ('schemaVersion' in raw && raw.schemaVersion === 1) {
        strategicCoaching = strategicCoachingFromAnalysis(raw)
      }
    } catch {
      strategicCoaching = null
    }
  }

  return {
    schemaVersion: 2,
    context: {
      userId: args.userId,
      sport,
      tool: args.tool,
      mode: args.mode,
    },
    timeContext,
    leagueContext,
    teamContext,
    dataFreshness,
    toolInput,
    data,
    providerHints: args.providerHints ?? null,
    platformHealth,
    learningLayers,
    strategicCoaching,
  }
}
