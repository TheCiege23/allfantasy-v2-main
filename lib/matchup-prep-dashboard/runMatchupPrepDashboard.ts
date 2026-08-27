import { findRosterForTeam } from '@/lib/leagues/rosterForTeam'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueToolAccessUserMessage } from '@/lib/ai-tools/league-tool-access-messages'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { openaiChatText } from '@/lib/openai-client'
import { runStartSitAnalysis } from '@/lib/ai-tools-start-sit/runStartSitAnalysis'
import type { StartSitAnalyzeResult, StartSitPlayerRow } from '@/lib/ai-tools-start-sit/runStartSitAnalysis'
import { attachIntelligenceToChimmyPayload, buildAiToolPayload } from '@/lib/intelligence'
import { leagueWantsLongHorizon, resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { normalizeToSupportedSport, SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { resolveMatchupOpponentExternal } from '@/lib/matchup-prep-dashboard/resolveMatchupOpponent'
import {
  aggregateStarterBands,
  buildPositionEdges,
  buildSlotEdgesFromStartSit,
  clamp,
  roundToTenth,
  sumLineupByPosition,
  winProbFromMeanEdgeLogistic,
  winProbabilityFromProjectionSpread,
} from '@/lib/matchup-prep-dashboard/matchupProjectionMath'
import type {
  MatchupFloorVsUpside,
  MatchupGamePlanAction,
  MatchupInjuryPivot,
  MatchupPrepDashboardInput,
  MatchupPrepDashboardOutput,
  MatchupPositionEdge,
  MatchupPrepDashboardResult,
  MatchupStreamingHint,
  MatchupStrategyModeId,
} from './types'

function isStartSitOk(v: unknown): v is StartSitAnalyzeResult {
  return typeof v === 'object' && v !== null && 'recommendations' in v
}

function getStarterIds(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const s = (playerData as Record<string, unknown>).starters
  if (!Array.isArray(s)) return []
  return s.map((x) => String(x)).filter(Boolean)
}

function mapStrategyToStartSitMode(
  m: MatchupPrepDashboardInput['strategyMode'],
): 'balanced' | 'safe' | 'upside' {
  switch (m) {
    case 'safe_floor':
    case 'injury_protected':
      return 'safe'
    case 'high_upside':
    case 'aggressive':
      return 'upside'
    default:
      return 'balanced'
  }
}

const SUPPORTED_HORIZONS: MatchupPrepDashboardInput['timeHorizon'][] = ['this_matchup', 'next_matchup']

function weekParamFromHorizon(h: MatchupPrepDashboardInput['timeHorizon']): string {
  switch (h) {
    case 'next_matchup':
      return 'next'
    case 'this_matchup':
    default:
      return 'current'
  }
}

function horizonNote(h: MatchupPrepDashboardInput['timeHorizon']): string | null {
  if (SUPPORTED_HORIZONS.includes(h)) return null
  return `Time horizon "${h}" is not yet supported — analysis clamped to this matchup. Use Start/Sit "next" or Power Rankings for multi-week outlooks.`
}

function buildFloorVsUpside(my: StartSitAnalyzeResult, mode: MatchupStrategyModeId): MatchupFloorVsUpside {
  const sd = my.structuredDecision
  const floorName = my.recommendations.safest?.player.name ?? sd.safest.name
  const upName = my.recommendations.upside?.player.name ?? sd.highestUpside.name
  let note = 'Start/Sit structured picks reflect your league scoring and projections for this period.'
  if (mode === 'safe_floor' || mode === 'injury_protected') {
    note = `Lean floor: prioritize ${floorName} where the projection band is tighter.`
  } else if (mode === 'high_upside' || mode === 'aggressive') {
    note = `Lean ceiling: ${upName} carries more boom/bust — align with your risk tolerance.`
  } else if (mode === 'streaming_focus') {
    note = 'Streaming focus: weakest projected slots are fair game for adds — verify waiver locks in Time context.'
  }
  return {
    floorLeanPlayer: floorName !== '—' ? floorName : null,
    upsideLeanPlayer: upName !== '—' ? upName : null,
    note,
  }
}

function buildGamePlan(args: {
  my: StartSitAnalyzeResult
  opp: StartSitAnalyzeResult | null
  edge: number | null
  strategyMode: MatchupStrategyModeId
  toggles: MatchupPrepDashboardInput['toggles']
  slotEdges: ReturnType<typeof buildSlotEdgesFromStartSit>
  positionEdges: MatchupPositionEdge[]
}): MatchupGamePlanAction[] {
  const actions: MatchupGamePlanAction[] = []
  let rank = 1
  const push = (a: Omit<MatchupGamePlanAction, 'rank'>) => {
    actions.push({ ...a, rank: rank++ })
  }

  const sd = args.my.structuredDecision
  if (args.strategyMode === 'safe_floor' || args.strategyMode === 'injury_protected') {
    push({
      id: 'ss-floor',
      title: `Floor lean: ${sd.safest.name}`,
      detail: sd.safest.why,
      urgency: 76,
      confidence: sd.safest.confidence,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  } else if (args.strategyMode === 'high_upside' || args.strategyMode === 'aggressive') {
    push({
      id: 'ss-upside',
      title: `Upside lean: ${sd.highestUpside.name}`,
      detail: sd.highestUpside.why,
      urgency: 74,
      confidence: sd.highestUpside.confidence,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  }

  if (args.my.recommendations.bestStart) {
    push({
      id: 'ss-start',
      title: `Start ${args.my.recommendations.bestStart.player.name}`,
      detail: args.my.recommendations.bestStart.reason,
      urgency: 78,
      confidence: args.my.recommendations.bestStart.confidence,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  }
  if (args.my.recommendations.bestSit) {
    push({
      id: 'ss-sit',
      title: `Sit ${args.my.recommendations.bestSit.player.name}`,
      detail: args.my.recommendations.bestSit.reason,
      urgency: 62,
      confidence: args.my.recommendations.bestSit.confidence,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  }

  if (sd.weatherNote && args.toggles.includeWeather) {
    push({
      id: 'ss-weather',
      title: 'Weather check (Start/Sit)',
      detail: sd.weatherNote,
      urgency: 68,
      confidence: 60,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  }
  if (sd.scoringRuleNote) {
    push({
      id: 'ss-scoring',
      title: 'Scoring format reminder',
      detail: sd.scoringRuleNote,
      urgency: 44,
      confidence: 72,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  }
  if (sd.lockTimeNote) {
    push({
      id: 'ss-locks',
      title: 'Lock / waiver timing',
      detail: sd.lockTimeNote,
      urgency: 70,
      confidence: 65,
      source: 'schedule',
      linkTool: 'startSit',
    })
  }

  if (args.edge != null && args.opp) {
    if (args.edge < -3) {
      push({
        id: 'underdog',
        title: 'Underdog in projected points',
        detail:
          'Mean starter projections trail opponent; use ceiling where injury risk is acceptable — see Start/Sit upside pick.',
        urgency: 72,
        confidence: Math.round(clamp(52 + args.my.confidenceScore * 0.15, 40, 78)),
        source: 'projection',
        linkTool: 'startSit',
      })
    } else if (args.edge > 3) {
      push({
        id: 'favorite',
        title: 'Favorite in projected points',
        detail:
          'Mean starter projections lead — safer floors at volatile slots can defend the edge (Start/Sit safest pick).',
        urgency: 52,
        confidence: Math.round(clamp(55 + args.my.confidenceScore * 0.12, 42, 80)),
        source: 'projection',
        linkTool: 'startSit',
      })
    }
  }

  if (args.toggles.includeInjuries) {
    const injMy = args.my.players
      .filter((p) => p.injuryStatus && /out|doubt|quest|ir/i.test(p.injuryStatus))
      .slice(0, 2)
    for (const p of injMy) {
      push({
        id: `inj-${p.playerId}`,
        title: `Monitor ${p.name}`,
        detail: p.injuryNewsSummary ?? p.injuryStatus ?? 'Injury designation',
        urgency: 72,
        confidence: p.projectionConfidence ?? 50,
        source: 'injury',
        linkTool: 'injury',
      })
    }
  }

  for (const u of args.my.unresolvedDecisions.slice(0, 3)) {
    push({
      id: `unres-${u.slotLabel}-${u.optionA}`,
      title: `Close call: ${u.slotLabel}`,
      detail: `${u.optionA} vs ${u.optionB} — ${u.projectedGap} pt projected gap (${u.urgency} urgency).`,
      urgency: Math.round(clamp(60 + (3 - u.projectedGap) * 8, 50, 92)),
      confidence: 58,
      source: 'start_sit',
      linkTool: 'startSit',
    })
  }

  if (args.toggles.includeStreamingRecommendations && args.slotEdges.length > 0) {
    const worst = [...args.slotEdges].sort((a, b) => a.edge - b.edge)[0]
    if (worst && worst.edge < -1.25) {
      push({
        id: 'stream-slot',
        title: `Streaming: ${worst.slotName}`,
        detail: `Best modeled starter in-slot trails opponent by ${Math.abs(worst.edge).toFixed(1)} pts — check waivers.`,
        urgency: 66,
        confidence: 54,
        source: 'projection',
        linkTool: 'waiver',
      })
    }
  }

  return actions.slice(0, 10)
}

function buildStreamingHints(
  positionEdges: MatchupPositionEdge[],
  slotEdges: ReturnType<typeof buildSlotEdgesFromStartSit>,
  toggles: MatchupPrepDashboardInput['toggles'],
): MatchupStreamingHint[] {
  if (!toggles.includeStreamingRecommendations) return []
  const out: MatchupStreamingHint[] = []
  let i = 0
  for (const e of positionEdges.filter((x) => x.edge < -2).slice(0, 3)) {
    out.push({
      id: `pos-${e.position}-${i++}`,
      title: `${e.position} depth`,
      detail: `You trail by ~${Math.abs(e.edge).toFixed(1)} pts vs opponent at ${e.position} in mean starter projections.`,
      linkTool: 'waiver',
    })
  }
  for (const s of slotEdges.filter((x) => x.edge < -1.5).slice(0, 2)) {
    out.push({
      id: `slot-${s.slotName}-${i++}`,
      title: s.slotName,
      detail: `Slot-modeled gap ${s.edge.toFixed(1)} vs opponent — consider a stream if waivers/FAAB allow.`,
      linkTool: 'waiver',
    })
  }
  return out
}

function buildInjuryPivots(my: StartSitAnalyzeResult, toggles: MatchupPrepDashboardInput['toggles']): MatchupInjuryPivot[] {
  if (!toggles.includeInjuries) return []
  const out: MatchupInjuryPivot[] = []
  for (const p of my.players) {
    if (!p.injuryStatus) continue
    if (!/quest|doubt|questionable/i.test(p.injuryStatus)) continue
    out.push({
      player: p.name,
      detail: p.injuryNewsSummary ?? p.injuryStatus,
      urgency: /doubt/i.test(p.injuryStatus) ? 84 : 70,
    })
    if (out.length >= 6) break
  }
  return out
}

export async function runMatchupPrepDashboard(input: MatchupPrepDashboardInput): Promise<MatchupPrepDashboardOutput> {
  const dataGaps: string[] = []
  const computedAt = new Date().toISOString()

  if (!input.leagueId?.trim()) {
    const code: LeagueToolAccessErrorCode = 'MISSING_LEAGUE_CONTEXT'
    const msg = leagueToolAccessUserMessage(code)
    return {
      ok: false,
      error: msg,
      code,
      userMessage: msg,
    }
  }

  const access = await assertLeagueMemberWithCode(input.leagueId.trim(), input.userId)
  if (!access.ok) {
    const code = access.code
    const msg = leagueToolAccessUserMessage(code)
    return { ok: false, error: msg, code, userMessage: msg }
  }

  const leagueRow = await prisma.league.findFirst({
    where: { id: input.leagueId.trim() },
    include: { teams: true },
  })
  if (!leagueRow) {
    const code: LeagueToolAccessErrorCode = 'LEAGUE_NOT_FOUND'
    const msg = leagueToolAccessUserMessage(code)
    return { ok: false, error: msg, code, userMessage: msg }
  }

  const sport = normalizeToSupportedSport(String(leagueRow.sport))
  if (!SUPPORTED_SPORTS.includes(sport)) {
    dataGaps.push(`Sport ${String(leagueRow.sport)} normalized for analysis.`)
  }

  if (input.sportFilter !== 'ALL' && input.sportFilter.toUpperCase() !== String(leagueRow.sport).toUpperCase()) {
    dataGaps.push('Sport filter does not match league sport — using league data.')
  }

  if (
    input.timeHorizon === 'next_2_matchups' ||
    input.timeHorizon === 'playoff_window' ||
    input.timeHorizon === 'rest_of_season'
  ) {
    dataGaps.push('Horizon uses current/next week scoring only; multi-week aggregation follows platform schedule.')
  }

  const myTeamExt =
    input.teamFocus === 'specific_team' && input.teamExternalId?.trim() ? input.teamExternalId.trim() : null

  const mode = mapStrategyToStartSitMode(input.strategyMode)

  const lceFirst = await resolveNormalizedLeagueContext({
    userId: input.userId,
    leagueId: input.leagueId.trim(),
    preferredTeamExternalId: myTeamExt ?? undefined,
  })

  const weekStr = weekParamFromHorizon(input.timeHorizon)
  const horizonSupported = SUPPORTED_HORIZONS.includes(input.timeHorizon)
  const horizonGap = horizonNote(input.timeHorizon)
  if (horizonGap) dataGaps.push(horizonGap)

  const mySs = await runStartSitAnalysis({
    userId: input.userId,
    sportFilter: 'ALL',
    leagueId: input.leagueId.trim(),
    week: weekStr,
    mode,
    teamExternalId: myTeamExt,
  })

  if (!isStartSitOk(mySs)) {
    return {
      ok: false,
      error: (mySs as { error?: string }).error ?? 'Could not load your roster for matchup prep.',
      code: 'VALIDATION',
    }
  }

  const seasonYear = lceFirst.ok ? lceFirst.context.season : leagueRow.season
  const oppResolved = await resolveMatchupOpponentExternal({
    leagueId: input.leagueId.trim(),
    userId: input.userId,
    sport,
    week: mySs.week,
    season: seasonYear,
    platform: String(leagueRow.platform ?? ''),
    platformLeagueId: leagueRow.platformLeagueId?.trim() ?? null,
    manualOpponentExternalId: input.opponentExternalId?.trim() ?? null,
    myTeamExternalId: myTeamExt,
  })

  const scheduleNotes: string[] = [...mySs.matchupNotes, ...oppResolved.notes]

  let oppExternal = oppResolved.opponentExternalId
  if (!oppExternal) {
    dataGaps.push(
      oppResolved.source === 'none'
        ? 'Select an opponent from your league list or fix import/sync so matchups resolve.'
        : 'Opponent roster id not linked — pick opponent manually if needed.',
    )
  }

  let oppSs: StartSitAnalyzeResult | null = null
  if (oppExternal) {
    const oppRes = await runStartSitAnalysis({
      userId: input.userId,
      sportFilter: 'ALL',
      leagueId: input.leagueId.trim(),
      week: weekStr,
      mode: 'balanced',
      teamExternalId: oppExternal,
    })
    if (isStartSitOk(oppRes)) {
      oppSs = oppRes
    } else {
      dataGaps.push(`Opponent roster: ${(oppRes as { error?: string }).error ?? 'unavailable'}`)
    }
  }

  let myRosterRow = await prisma.roster.findFirst({
    where: { leagueId: input.leagueId.trim(), platformUserId: input.userId },
    select: { playerData: true },
  })
  if (myTeamExt) {
    const myLtForRoster = await prisma.leagueTeam.findFirst({
      where: { leagueId: input.leagueId.trim(), externalId: myTeamExt },
      select: { platformUserId: true },
    })
    if (myLtForRoster?.platformUserId) {
      const r = await prisma.roster.findFirst({
        where: { leagueId: input.leagueId.trim(), platformUserId: myLtForRoster.platformUserId },
        select: { playerData: true },
      })
      if (r) myRosterRow = r
    }
  }

  let oppRosterRow: { playerData: unknown } | null = null
  if (oppExternal) {
    const lt = await prisma.leagueTeam.findFirst({
      where: { leagueId: input.leagueId.trim(), externalId: oppExternal },
      select: { platformUserId: true },
    })
    if (lt?.platformUserId) {
      /* Contract-aware — see lib/leagues/rosterForTeam.ts. Keying on the
         team's raw Sleeper id misses every opponent with an AF account. */
      const oppFound = await findRosterForTeam(input.leagueId.trim(), lt.platformUserId)
      oppRosterRow = oppFound ? { playerData: oppFound.playerData as any } : null
    }
  }

  const myStarters = new Set(getStarterIds(myRosterRow?.playerData))
  const oppStarters = new Set(getStarterIds(oppRosterRow?.playerData))
  const myStarterCap = mySs.lineupSlotAnalysis?.length || null
  const oppStarterCap = oppSs?.lineupSlotAnalysis?.length || myStarterCap
  if (myStarters.size === 0) {
    const capNote = myStarterCap ? ` Using top-${myStarterCap} by projection from league lineup template.` : ' Capped at top-9 by projection.'
    dataGaps.push(`Starter slots not synced in roster JSON.${capNote}`)
  }

  const myLine = sumLineupByPosition(mySs.players, myStarters, myStarterCap)
  const oppLine = oppSs
    ? sumLineupByPosition(oppSs.players, oppStarters, oppStarterCap)
    : { total: 0, byPos: {}, usedFallback: false }

  const myTotal = myLine.total > 0 ? myLine.total : null
  const oppTotal = oppSs && oppLine.total > 0 ? oppLine.total : null

  const edge = myTotal != null && oppTotal != null ? roundToTenth(myTotal - oppTotal) : null

  const myBands = aggregateStarterBands(mySs.players as StartSitPlayerRow[], myStarters)
  const oppBands = oppSs ? aggregateStarterBands(oppSs.players as StartSitPlayerRow[], oppStarters) : null
  const spreadWin =
    oppBands && myBands.starterCount > 0 && oppBands.starterCount > 0
      ? winProbabilityFromProjectionSpread({ my: myBands, opp: oppBands })
      : null

  let winProbability: number | null = null
  let winModel: MatchupPrepDashboardResult['winProbabilityModel'] = 'mean_edge_logistic'
  let winNotes: string | null = null
  if (spreadWin) {
    winProbability = spreadWin.pct
    winModel = 'starter_spread_normal'
    winNotes = `P(win) from starter projection bands (~σ=${spreadWin.combinedSigma.toFixed(2)} pts). Not Vegas — fantasy points only.`
  } else if (edge != null) {
    winProbability = winProbFromMeanEdgeLogistic(edge)
    winModel = 'mean_edge_logistic'
    winNotes = 'P(win) from mean projected point edge (logistic). Use when starter floor/ceiling bands are thin.'
  }

  let matchupDifficulty: 'favorable' | 'even' | 'tough' = 'even'
  if (edge != null) {
    if (edge >= 3) matchupDifficulty = 'favorable'
    else if (edge <= -3) matchupDifficulty = 'tough'
  }

  const positionEdges: MatchupPositionEdge[] = oppSs ? buildPositionEdges(myLine.byPos, oppLine.byPos) : []
  const slotEdges = oppSs ? buildSlotEdgesFromStartSit(mySs, oppSs) : []

  const oppWeaknesses = positionEdges.filter((e) => e.edge > 0).slice(0, 4)
  const oppStrengths = positionEdges.filter((e) => e.edge < 0).slice(0, 4)

  const gamePlan = buildGamePlan({
    my: mySs,
    opp: oppSs,
    edge,
    strategyMode: input.strategyMode,
    toggles: input.toggles,
    slotEdges,
    positionEdges,
  })

  const streamingOpportunities = buildStreamingHints(positionEdges, slotEdges, input.toggles)
  const injuryPivots = buildInjuryPivots(mySs, input.toggles)
  const floorVsUpside = buildFloorVsUpside(mySs, input.strategyMode)

  const injuryHighlights: Array<{ side: 'you' | 'opp'; name: string; status: string; note: string }> = []
  if (input.toggles.includeInjuries) {
    for (const p of mySs.players.slice(0, 28)) {
      if (p.injuryStatus && p.injuryStatus.length > 2) {
        injuryHighlights.push({ side: 'you', name: p.name, status: p.injuryStatus, note: p.injuryNewsSummary ?? 'Your roster' })
      }
    }
    if (oppSs) {
      for (const p of oppSs.players.slice(0, 28)) {
        if (p.injuryStatus && p.injuryStatus.length > 2) {
          injuryHighlights.push({ side: 'opp', name: p.name, status: p.injuryStatus, note: p.injuryNewsSummary ?? 'Opponent roster' })
        }
      }
    }
  }

  const conflicts: Array<{ id: string; summary: string; primary: string; alternate: string }> = []
  if (edge != null && edge > 2 && mode === 'upside') {
    conflicts.push({
      id: 'c1',
      summary: 'You project ahead but strategy asks for upside — consider safer floor to protect lead.',
      primary: 'Use upside at volatile slots only.',
      alternate: 'Play safest projected starters across the board.',
    })
  }
  if (edge != null && edge < -2 && mode === 'safe') {
    conflicts.push({
      id: 'c2',
      summary: 'You project behind but strategy is floor-heavy — you may need ceiling at some slots.',
      primary: 'Follow upside lean on one flex-eligible spot.',
      alternate: 'Stay safe and chase volume leaders only.',
    })
  }

  const confidence = Math.round(
    clamp(
      (mySs.confidenceScore + (oppSs?.confidenceScore ?? 55)) / 2 -
        dataGaps.length * 2 -
        (oppSs ? 0 : 8) -
        (myStarters.size === 0 ? 5 : 0),
      18,
      92,
    ),
  )

  const urgencyScore = Math.round(
    clamp(
      52 +
        (winProbability != null && winProbability < 45 ? 18 : 0) +
        (edge != null && Math.abs(edge) < 3 ? 12 : 0) +
        mySs.unresolvedDecisions.length * 6 +
        injuryPivots.length * 4,
      22,
      98,
    ),
  )

  const degraded = dataGaps.length > 0 || !oppSs || oppTotal == null

  const myLt = await prisma.leagueTeam.findFirst({
    where: myTeamExt
      ? { leagueId: input.leagueId.trim(), externalId: myTeamExt }
      : { leagueId: input.leagueId.trim(), claimedByUserId: input.userId },
    select: { teamName: true, wins: true, losses: true, ties: true },
  })
  const oppLt = oppExternal
    ? await prisma.leagueTeam.findFirst({
        where: { leagueId: input.leagueId.trim(), externalId: oppExternal },
        select: { teamName: true, wins: true, losses: true, ties: true },
      })
    : null

  const recStr = (w: number, l: number, t: number) => `${w}-${l}${t > 0 ? `-${t}` : ''}`

  const weatherInfluence = input.toggles.includeWeather
    ? mySs.players
        .filter(
          (p) =>
            p.weatherRiskLevel === 'moderate' ||
            p.weatherRiskLevel === 'high' ||
            p.weatherRiskLevel === 'extreme',
        )
        .map((p) => ({ name: p.name, team: p.team, summary: p.weatherSummary ?? '', risk: p.weatherRiskLevel }))
        .filter((x) => x.summary)
        .slice(0, 10)
    : []

  let aiSummary: string | null = null
  if (!input.skipAi) {
    const payload = {
      week: mySs.week,
      scoring: lceFirst.ok
        ? {
            model: lceFirst.context.scoring.scoringModel,
            receptionFormat: lceFirst.context.scoring.labels.receptionFormat,
          }
        : null,
      myTeam: myLt?.teamName ?? mySs.teamContext.teamName,
      oppTeam: oppLt?.teamName ?? oppResolved.opponentName ?? mySs.opponent?.name,
      myProj: myTotal,
      oppProj: oppTotal,
      edge,
      winProbability,
      winModel,
      positionEdges: positionEdges.slice(0, 8),
      slotEdges: slotEdges.slice(0, 8),
      weatherInfluence,
      dataGaps,
      startSitSummary: mySs.summary,
    }
    const ai = await openaiChatText({
      messages: [
        {
          role: 'system',
          content:
            'You are Chimmy. Write 4–7 sentences for fantasy matchup prep. Use ONLY numbers and names from the JSON. Never invent players, injuries, or scores. Explain that win chance is derived from projections (not betting odds). If opponent data is missing, say so. If weatherInfluence is present, tie it to those players only.',
        },
        { role: 'user', content: JSON.stringify(payload).slice(0, 12000) },
      ],
      temperature: 0.35,
      maxTokens: 500,
      skipCache: true,
    })
    aiSummary = ai.ok ? ai.text : null
    if (!ai.ok) dataGaps.push('AI summary unavailable (provider).')
  }

  const mpLce = lceFirst.ok ? lceFirst : await resolveNormalizedLeagueContext({
    userId: input.userId,
    leagueId: input.leagueId.trim(),
    preferredTeamExternalId: myTeamExt ?? undefined,
  })

  const scoringSummary =
    mpLce.ok
      ? {
          scoringModel: mpLce.context.scoring.scoringModel,
          receptionFormat: mpLce.context.scoring.labels.receptionFormat,
          superflex: mpLce.context.scoring.labels.isSuperflex,
          rawScoringColumn: leagueRow.scoring ?? null,
        }
      : null

  const matchupPeriod: MatchupPrepDashboardResult['matchupPeriod'] = mpLce.ok
    ? {
        season: mpLce.context.season,
        week: mySs.week,
        weekLabel: mySs.weekLabel,
        periodSource: mpLce.context.matchupPeriod.source,
      }
    : {
        season: leagueRow.season,
        week: mySs.week,
        weekLabel: mySs.weekLabel,
        periodSource: null,
      }

  const matchupEnvelope = await buildAiToolPayload({
    userId: input.userId,
    tool: 'matchup_prep',
    mode: 'league',
    league: {
      leagueId: input.leagueId.trim(),
      leagueName: leagueRow.name,
      sport: String(sport),
    },
    data: {
      week: mySs.week,
      weekLabel: mySs.weekLabel,
      strategyMode: input.strategyMode,
      timeHorizon: input.timeHorizon,
      scoringSummary,
      matchupPeriod,
      waiverLocks: mpLce.ok ? mpLce.context.waiver : null,
      standings: {
        myRecord: myLt ? recStr(myLt.wins, myLt.losses, myLt.ties) : mySs.teamContext.record,
        oppRecord: oppLt ? recStr(oppLt.wins, oppLt.losses, oppLt.ties) : null,
      },
      projectedLineups: {
        myTotal,
        oppTotal,
        edge,
        winProbability,
        winProbabilityModel: winModel,
      },
      positionEdges: positionEdges.slice(0, 12),
      slotEdges: slotEdges.slice(0, 16),
      streamingOpportunities,
      injuryHighlights: injuryHighlights.slice(0, 14),
      injuryPivots,
      weatherInfluence,
      floorVsUpside,
      gamePlan: gamePlan.slice(0, 12),
      dataGaps: dataGaps.slice(0, 14),
      opponentResolved: Boolean(oppSs),
      opponentResolution: oppResolved.source,
      startSitDataQuality: { my: mySs.dataQuality, opp: oppSs?.dataQuality ?? null },
    },
    enrichTimeFromLeagueId: input.leagueId.trim(),
    includeTeamContext: true,
    // Matchup Prep is a weekly opponent-edge tool — skip the 3-year snapshot unless the
    // league format actually has a multi-year horizon (dynasty/keeper/devy/C2C).
    includeStrategicCoaching: leagueWantsLongHorizon(mpLce.ok ? mpLce.context : null),
  })
  const chimmyPayload = attachIntelligenceToChimmyPayload(
    {
      tool: 'matchup_prep',
      leagueContextEngine: mpLce.ok ? mpLce.context : null,
      leagueId: input.leagueId.trim(),
      leagueName: leagueRow.name,
      sport,
      week: mySs.week,
      weekLabel: mySs.weekLabel,
      myProjectedTotal: myTotal,
      oppProjectedTotal: oppTotal,
      edge,
      winProbability,
      winProbabilityModel: winModel,
      opponentWeaknesses: oppWeaknesses.map((e) => e.position),
      opponentStrengths: oppStrengths.map((e) => e.position),
      streamingOpportunities,
      weatherInfluence,
      scheduleNotes: scheduleNotes.slice(0, 10),
      dataGaps,
      degraded,
      urgencyScore,
      computedAt,
    },
    matchupEnvelope,
  )

  const result: MatchupPrepDashboardResult = {
    ok: true,
    analysisScope: 'league',
    leagueName: leagueRow.name,
    sport: String(leagueRow.sport),
    week: mySs.week,
    weekLabel: mySs.weekLabel,
    matchupPeriod,
    scoringSummary,
    opponentResolution: oppResolved.source,
    myTeamName: myLt?.teamName ?? mySs.teamContext.teamName,
    oppTeamName: oppLt?.teamName ?? oppResolved.opponentName ?? mySs.opponent?.name ?? null,
    myRecord: myLt ? recStr(myLt.wins, myLt.losses, myLt.ties) : mySs.teamContext.record,
    oppRecord: oppLt ? recStr(oppLt.wins, oppLt.losses, oppLt.ties) : null,
    myProjectedTotal: myTotal,
    oppProjectedTotal: oppTotal,
    projectedEdge: edge,
    winProbability,
    winProbabilityModel: winModel,
    winProbabilityNotes: winNotes,
    confidence,
    urgencyScore,
    matchupDifficulty,
    positionEdges,
    slotEdges,
    floorVsUpside,
    streamingOpportunities,
    gamePlan,
    conflicts,
    injuryHighlights: injuryHighlights.slice(0, 14),
    injuryPivots,
    scheduleNotes: scheduleNotes.slice(0, 10),
    weatherInfluence,
    dataGaps,
    degraded,
    modules: {
      myStartSit: JSON.parse(JSON.stringify(mySs)) as Record<string, unknown>,
      oppStartSit: oppSs ? (JSON.parse(JSON.stringify(oppSs)) as Record<string, unknown>) : null,
    },
    aiSummary,
    chimmyPayload,
    timeContext: mySs.timeContext,
    startSitValidation: {
      my: mySs.validation as unknown as Record<string, unknown>,
      opp: oppSs ? (oppSs.validation as unknown as Record<string, unknown>) : null,
    },
    sourceFlags: {
      opponentResolved: oppResolved.source !== 'none',
      myProjectionReady: (mySs.sourceFlags?.sportsDataReady ?? false) && mySs.players.length > 0,
      oppProjectionReady:
        Boolean(oppSs) && (oppSs?.sourceFlags?.sportsDataReady ?? false) && (oppSs?.players.length ?? 0) > 0,
      injuryNewsLayerReady:
        (mySs.sourceFlags?.injuryNewsLayerReady ?? false) ||
        (oppSs?.sourceFlags?.injuryNewsLayerReady ?? false),
      weatherLayerReady: weatherInfluence.length > 0,
      leagueScoringApplied: Boolean(scoringSummary) && (mySs.sourceFlags?.leagueScoringApplied ?? false),
      aiEnvelopeReady: Boolean(aiSummary) || chimmyPayload != null,
    },
    horizonSupported,
    computedAt,
  }

  return result
}
