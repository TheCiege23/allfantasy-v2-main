import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { RecommendationInput } from '@/lib/draft-helper/RecommendationEngine'
import { blendCombinedAdp } from './combined-adp'
import { runDeterministicPickEngine, mapBrainModeToEngineMode } from './deterministic-pick-engine'
import { predictNextPicks } from './next-pick-prediction'
import type { LiveDraftBrainEnvelope } from './schemas'
import { LiveDraftBrainEnvelopeSchema } from './schemas'
import type { LiveDraftBrainInput, LiveDraftAssistantMode } from './types'
import { normalizeDraftBrainSport } from './sport-universe'

function playerKey(p: { name: string; position: string; team?: string | null }): string {
  return `${(p.name || '').toLowerCase()}|${(p.position || '').toLowerCase()}|${(p.team || '').toLowerCase()}`
}

function mapModeToRecommendationType(
  mode: LiveDraftAssistantMode
): LiveDraftBrainEnvelope['pickRecommendation']['recommendationType'] {
  switch (mode) {
    case 'trade_up':
      return 'trade-up target'
    case 'trade_down':
      return 'trade-down target'
    case 'bpa':
      return 'bpa'
    case 'needs':
      return 'needs'
    case 'upside':
      return 'upside'
    case 'safe':
      return 'safe'
    default:
      return 'balanced'
  }
}

function buildPickRecommendationFromCandidate(
  input: LiveDraftBrainInput,
  top: ReturnType<typeof runDeterministicPickEngine>['top3'][0],
  mode: LiveDraftAssistantMode
): LiveDraftBrainEnvelope['pickRecommendation'] {
  const key = playerKey({
    name: top.playerName,
    position: top.position,
    team: top.team ?? null,
  })
  const poolRow = input.available.find(
    (p) =>
      p.name === top.playerName &&
      String(p.position).toUpperCase() === String(top.position).toUpperCase()
  )
  const cadp = input.combinedAdpByPlayerKey?.[key]
  const blended = blendCombinedAdp({
    ...cadp,
    externalAdp: cadp?.externalAdp ?? poolRow?.adp ?? null,
    siteAdp: cadp?.siteAdp ?? null,
    brainContext: input.context,
    playerMeta: {
      position: top.position,
      isRookie: poolRow?.isRookie,
      age: poolRow?.age ?? null,
    },
  })
  const ext = blended.externalAdp
  const site = blended.siteAdp

  return {
    playerName: top.playerName,
    position: top.position,
    team: String(top.team ?? ''),
    combinedAdp: blended.combinedAdp,
    externalAdp: ext,
    siteAdp: site,
    pickScore: top.pickScore,
    recommendationType: mapModeToRecommendationType(mode),
    reasoning: top.pickReasons,
    riskNotes: top.riskNotes,
    waitOrTakeNow:
      top.waitOrTakeNow === 'take_now'
        ? 'take_now'
        : top.waitOrTakeNow === 'unlikely_to_return'
          ? 'unlikely_to_return'
          : 'safe_to_wait',
  }
}

/**
 * Deterministic-first Live Draft Brain — optional AI narration should wrap this output.
 */
export function runLiveDraftBrainDeterministic(input: LiveDraftBrainInput): LiveDraftBrainEnvelope {
  const sport = normalizeDraftBrainSport(String(input.context.sport))
  const leagueSport = normalizeToSupportedSport(String(sport))

  const aiMerged: Record<string, number> = { ...input.aiAdpByKey, ...input.blendedAdpByKey }

  const recommendationInput: RecommendationInput = {
    available: input.available.map((p) => ({
      name: p.name,
      position: p.position,
      team: p.team ?? null,
      adp: p.adp ?? null,
      byeWeek: p.byeWeek ?? null,
    })),
    teamRoster: input.myTeam.teamRoster,
    rosterSlots: input.myTeam.rosterSlots,
    round: input.context.round,
    pick: input.context.pick,
    totalTeams: input.context.totalTeams,
    sport: leagueSport,
    isDynasty: input.isDynasty ?? input.context.leagueType === 'dynasty',
    isSF: input.context.isSuperflex ?? false,
    mode: mapBrainModeToEngineMode(input.mode),
    aiAdpByKey: Object.keys(aiMerged).length ? aiMerged : input.aiAdpByKey,
    byeByKey: input.byeByKey,
  }

  const engine = runDeterministicPickEngine({
    recommendationInput,
    brainMode: input.mode,
    projectionByKey: input.myTeam.projectionByKey,
    ceilingByKey: input.myTeam.ceilingByKey,
    floorByKey: input.myTeam.floorByKey,
  })

  const top3 = engine.top3.map((t) =>
    buildPickRecommendationFromCandidate(input, t, input.mode)
  )

  const primary = top3[0] ?? {
    playerName: '—',
    position: '—',
    team: '',
    combinedAdp: 0,
    externalAdp: 0,
    siteAdp: 0,
    pickScore: 0,
    recommendationType: 'balanced' as const,
    reasoning: ['No ranked players available in pool.'],
    riskNotes: ['Empty or invalid player pool.'],
    waitOrTakeNow: 'safe_to_wait' as const,
  }

  const upcoming = input.upcomingTeamOrder ?? []
  const names: Record<string, string> = {}
  for (const id of upcoming) {
    names[id] = input.managerHintsByTeamId?.[id]?.displayName ?? id
  }

  const nextPickPredictions = predictNextPicks({
    draftFormat: input.context.draftFormat,
    upcomingTeamIds: upcoming,
    teamDisplayNameById: names,
    available: input.available.map((p) => ({
      name: p.name,
      position: p.position,
      adp: p.adp ?? undefined,
    })),
    auctionBudgetByTeamId: input.auctionBudgetByTeamId,
    limit: 3,
  }).map((n) => ({
    manager: n.manager,
    predictedPlayer: n.predictedPlayer,
    predictedPosition: n.predictedPosition,
    probability: n.probability,
    reason: n.reason,
  }))

  const combinedAdpSlice = input.available.slice(0, 24).map((p) => {
    const key = playerKey(p)
    const row = input.combinedAdpByPlayerKey?.[key]
    const blended = blendCombinedAdp({
      ...row,
      externalAdp: row?.externalAdp ?? p.adp ?? null,
      siteAdp: row?.siteAdp ?? null,
      brainContext: input.context,
      playerMeta: {
        position: p.position,
        isRookie: p.isRookie,
        age: p.age ?? null,
      },
    })
    return {
      playerKey: key,
      playerName: p.name,
      externalAdp: blended.externalAdp,
      siteAdp: blended.siteAdp,
      combinedAdp: blended.combinedAdp,
      trend: blended.trend,
      trendArrow: blended.trendArrow,
      confidence: blended.confidence,
      contextLabel: blended.contextLabel,
      sourceCoverageNote: blended.sourceCoverageNote,
    }
  })

  const raw: LiveDraftBrainEnvelope = {
    pickRecommendation: primary,
    pickRecommendationsTop3: top3,
    nextPickPredictions,
    positionalRunSignals: engine.positionalRunSignals,
    tierCliffWarnings: engine.tierCliffWarnings,
    boardTierSummary: engine.boardTierSummary,
    combinedAdp: combinedAdpSlice,
    deterministicMeta: {
      assistantMode: input.mode,
      draftFormat: input.context.draftFormat,
      sport: String(sport),
    },
  }

  return LiveDraftBrainEnvelopeSchema.parse(raw)
}
