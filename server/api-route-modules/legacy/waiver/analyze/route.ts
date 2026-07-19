import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { buildBaselineMeta } from '@/lib/engine/response-guard'
import {
  getSleeperUser,
  getLeagueRosters,
  getLeagueInfo,
  getLeagueType,
  getScoringType,
  SleeperPlayer,
} from '@/lib/sleeper-client'
import {
  getCanonicalPlayerMapForSport,
  DECISION_FRESHNESS_MS,
  type FreshnessStats,
} from '@/lib/canonical/getCanonicalPlayer'
import { pricePlayer, ValuationContext } from '@/lib/hybrid-valuation'
import { getComprehensiveLearningContext } from '@/lib/comprehensive-trade-learning'
import { autoLogDecision } from '@/lib/decision-log'
import { computeConfidenceRisk, getHistoricalHitRate } from '@/lib/analytics/confidence-risk-engine'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { getPlayerAnalyticsBatch } from '@/lib/player-analytics'
import {
  scoreWaiverCandidates,
  buildWaiverIntelSignals,
  type WaiverCandidate,
  type WaiverRosterPlayer,
  type WaiverScoringContext,
  type CrowdTrendData,
  type WaiverIntelSignal,
} from '@/lib/waiver-engine/waiver-scoring'
import {
  computeTeamNeeds,
  deriveGoalFromContext,
  type UserGoal,
} from '@/lib/waiver-engine/team-needs'
import { fetchPlayerNewsFromGrok } from '@/lib/ai-gm-intelligence'
import { computeWaiverScore, computeAddDropDelta, normalizeScore } from '@/lib/legacy-tool/scoring'
import { fuseDecisionScore } from '@/lib/legacy-tool/fusion'
import { normalizeGrokSignalsToDeltaEvents, persistGrokDeltaEvents } from '@/lib/legacy-tool/grok-delta'
import {
  buildPrivateWaiverCoachingNotification,
  buildLeagueWaiverProcessedNotification,
} from '@/lib/legacy-tool/notifications'
import { assertSleeperBoundaryForLeagueId } from '@/lib/legacy/sleeper-boundary'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'

const openai = getOpenAIRouteClient()

type RosterSlot = 'starter' | 'bench' | 'ir' | 'taxi'

interface RosterPlayer {
  id: string
  name: string
  position: string
  team: string | null
  slot: RosterSlot
  age?: number
}

interface FreeAgent {
  id: string
  name: string
  position: string
  team: string | null
  age?: number
  status?: string
}

function categorizeRoster(
  roster: { starters: string[]; players: string[]; reserve: string[]; taxi: string[] },
  allPlayers: Record<string, SleeperPlayer>
): RosterPlayer[] {
  const result: RosterPlayer[] = []
  const starterSet = new Set(roster.starters || [])
  const reserveSet = new Set(roster.reserve || [])
  const taxiSet = new Set(roster.taxi || [])

  for (const playerId of roster.players || []) {
    const player = allPlayers[playerId]
    if (!player) continue

    let slot: RosterSlot = 'bench'
    if (starterSet.has(playerId)) slot = 'starter'
    else if (reserveSet.has(playerId)) slot = 'ir'
    else if (taxiSet.has(playerId)) slot = 'taxi'

    result.push({
      id: playerId,
      name: player.full_name || `${player.first_name} ${player.last_name}`,
      position: player.position || 'Unknown',
      team: player.team,
      slot,
      age: (player as any).age ?? undefined,
    })
  }

  return result
}

function findFreeAgents(
  allPlayers: Record<string, SleeperPlayer>,
  rosteredPlayerIds: Set<string>,
): FreeAgent[] {
  const freeAgents: FreeAgent[] = []
  const relevantPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

  for (const [playerId, player] of Object.entries(allPlayers)) {
    if (rosteredPlayerIds.has(playerId)) continue
    if (!player.position || !relevantPositions.includes(player.position)) continue
    if (!player.team) continue

    freeAgents.push({
      id: playerId,
      name: player.full_name || `${player.first_name} ${player.last_name}`,
      position: player.position,
      team: player.team,
      status: player.status,
      age: (player as any).age ?? undefined,
    })
  }

  return freeAgents
    .filter(p => p.status !== 'Inactive' && p.status !== 'Retired')
    .slice(0, 200)
}

function detectNeeds(rosterPlayers: WaiverRosterPlayer[], isSF: boolean): string[] {
  const needs: string[] = []
  const startersByPos: Record<string, number> = {}
  for (const p of rosterPlayers.filter(r => r.slot === 'starter')) {
    startersByPos[p.position] = (startersByPos[p.position] || 0) + 1
  }
  const idealStarters: Record<string, number> = { QB: isSF ? 2 : 1, RB: 2, WR: 2, TE: 1 }
  for (const [pos, ideal] of Object.entries(idealStarters)) {
    if ((startersByPos[pos] || 0) < ideal) needs.push(pos)
  }

  const posValues: Record<string, number[]> = {}
  for (const p of rosterPlayers) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue
    if (!posValues[p.position]) posValues[p.position] = []
    posValues[p.position].push(p.value)
  }
  for (const [pos, vals] of Object.entries(posValues)) {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    if (avg < 2500 && !needs.includes(pos)) needs.push(pos)
  }
  return needs
}

function detectSurplus(rosterPlayers: WaiverRosterPlayer[]): string[] {
  const surplus: string[] = []
  const posValues: Record<string, number[]> = {}
  for (const p of rosterPlayers) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) continue
    if (!posValues[p.position]) posValues[p.position] = []
    posValues[p.position].push(p.value)
  }
  for (const [pos, vals] of Object.entries(posValues)) {
    if (vals.length >= 4 && vals.sort((a, b) => b - a)[3] >= 1500) surplus.push(pos)
  }
  return surplus
}

const NARRATIVE_PROMPT = `You are the AllFantasy Waiver AI narrative writer. You receive deterministic waiver analysis results and write concise, insightful narrative text ONLY.

You DO NOT evaluate players or change rankings. The rankings, scores, and recommendations are final. Your job is to:
1. Write a 1-2 sentence summary of the waiver analysis
2. For each suggestion, write a short reasoning paragraph (2-3 sentences) explaining WHY this pickup makes sense
3. Write brief roster notes (weaknesses, observations)

Output JSON:
{
  "summary": string,
  "narratives": { [playerName: string]: string },
  "roster_notes": string[]
}`

export const POST = withApiUsage({ endpoint: "/api/legacy/waiver/analyze", tool: "LegacyWaiverAnalyze" })(async (request: NextRequest) => {
  try {
    const auth = requireAuthOrOrigin(request)
    if (!auth.authenticated) {
      return forbiddenResponse(auth.error || 'Unauthorized')
    }

    const ip = getClientIp(request)
    const body = await request.json()
    const { sleeper_username, league_id, goal: userProvidedGoal, sleeperUser: sleeperUserIdentity } = body

    const resolvedUsername = sleeperUserIdentity?.username || sleeper_username
    const resolvedUserId = sleeperUserIdentity?.userId || undefined
    const normalizedLeagueId = String(league_id || '').trim()

    if (!resolvedUsername || !normalizedLeagueId) {
      return NextResponse.json(
        { error: 'Missing sleeper_username or league_id' },
        { status: 400 }
      )
    }

    const boundary = await assertSleeperBoundaryForLeagueId(normalizedLeagueId)
    if (!boundary.ok) {
      return NextResponse.json({ error: boundary.message }, { status: boundary.status })
    }

    const rl = consumeRateLimit({
      scope: 'legacy',
      action: 'waiver_analyze',
      sleeperUsername: resolvedUsername,
      ip,
      maxRequests: 5,
      windowMs: 60_000,
      includeIpInKey: false,
    })

    if (!rl.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfterSec: rl.retryAfterSec },
        { status: 429 }
      )
    }

    const sleeperUser = resolvedUserId
      ? { user_id: resolvedUserId, username: resolvedUsername, display_name: resolvedUsername }
      : await getSleeperUser(resolvedUsername)
    if (!sleeperUser) {
      return NextResponse.json({ error: 'Sleeper user not found' }, { status: 404 })
    }

    const leagueInfo = await getLeagueInfo(normalizedLeagueId)
    if (!leagueInfo) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    const leagueType = getLeagueType(leagueInfo)

    const leagueStatus = (leagueInfo as any)?.status || ''
    const isOffseason = leagueStatus === 'complete' || leagueStatus === 'pre_draft'

    // Phase 3 batch 3 — canonical read path WITH the freshness guard.
    //
    // This is the waiver wire, so staleness is not cosmetic: canonical was measured showing a
    // team for 92 NFL players Sleeper had already cut, which here would hide genuinely
    // available players and surface unavailable ones. Batch 2 held this site back for exactly
    // that reason. `maxAgeMs: DECISION_FRESHNESS_MS` makes the accessor fall through to live
    // for any row whose SOURCE observation is older than 6h (or past its source TTL), and
    // overlay only those rows — one live fetch, not one per player.
    const freshness: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }
    const [rosters, canonicalPlayers] = await Promise.all([
      getLeagueRosters(normalizedLeagueId),
      getCanonicalPlayerMapForSport('NFL', {
        maxAgeMs: DECISION_FRESHNESS_MS,
        stats: freshness,
      }),
    ])

    // Reshaped to the `Record<sleeperId, SleeperPlayer-ish>` the helpers below already index.
    // `status` is rebuilt from canonical's split fields: roster state lives on `active`, injury
    // designations on `injuryStatus` (SportsPlayer.status mixes the two — see
    // classifySourceStatus). The downstream filter drops Inactive/Retired, so inactive players
    // are labelled accordingly rather than passed through as an injury value.
    const allPlayers = Object.fromEntries(
      [...canonicalPlayers].map(([sleeperId, p]) => [
        sleeperId,
        {
          full_name: p.name,
          position: p.position,
          team: p.team,
          status: p.active ? (p.injuryStatus ?? 'Active') : 'Inactive',
        },
      ]),
    ) as Record<string, SleeperPlayer>

    const userRoster = rosters.find(r => r.owner_id === sleeperUser.user_id)
    if (!userRoster) {
      return NextResponse.json(
        { error: 'You are not in this league' },
        { status: 400 }
      )
    }

    const rosteredPlayerIds = new Set<string>()
    for (const roster of rosters) {
      for (const playerId of roster.players || []) {
        rosteredPlayerIds.add(playerId)
      }
    }

    const userRosterCategorized = categorizeRoster(userRoster, allPlayers)
    const freeAgents = findFreeAgents(allPlayers, rosteredPlayerIds)
    const scoringType = getScoringType(leagueInfo.scoring_settings)

    const rosterPositions = leagueInfo.roster_positions || []
    const isSF = rosterPositions.some((p: string) => p === 'SUPER_FLEX' || p === 'SF')
    const isTEP = !!(leagueInfo.scoring_settings?.bonus_rec_te)
    const numTeams: number = Number(leagueInfo.settings?.num_teams) || rosters.length
    const isDynasty = leagueType === 'dynasty'

    const leagueAvg = rosters.reduce(
      (sum, r) => sum + ((r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100),
      0
    ) / Math.max(1, rosters.length)
    const userPts = (userRoster.settings?.fpts ?? 0) + (userRoster.settings?.fpts_decimal ?? 0) / 100

    const valCtx: ValuationContext = {
      asOfDate: new Date().toISOString().slice(0, 10),
      isSuperFlex: isSF,
    }

    const topFreeAgents = freeAgents.slice(0, 80)
    const [faValueResults, rosterValueResults] = await Promise.all([
      Promise.all(topFreeAgents.map(fa => pricePlayer(fa.name, valCtx))),
      Promise.all(userRosterCategorized.map(p => pricePlayer(p.name, valCtx))),
    ])

    const waiverCandidates: WaiverCandidate[] = []
    for (let i = 0; i < topFreeAgents.length; i++) {
      const fa = topFreeAgents[i]
      const priced = faValueResults[i]
      if (priced.value >= 200) {
        waiverCandidates.push({
          playerId: fa.id,
          playerName: fa.name,
          position: fa.position,
          team: fa.team,
          age: fa.age ?? null,
          value: priced.value,
          assetValue: priced.assetValue,
          source: priced.source,
        })
      }
    }

    if (waiverCandidates.length === 0) {
      const isOffseasonEmpty = leagueStatus === 'complete' || leagueStatus === 'pre_draft'
      return NextResponse.json({
        ok: true,
        analysis: {
          one_move: null,
          suggestions: [],
          roster_notes: [],
          meta: buildBaselineMeta(
            "no_waiver_pool",
            "No available waiver candidates for this league context."
          ),
        },
        confidenceRisk: {
          confidence: 0,
          level: 'low',
          volatility: 'low',
          riskProfile: 'unknown',
          riskTags: [],
          explanation: 'No waiver candidates available.',
        },
        league: {
          name: leagueInfo?.name || '',
          id: league_id,
          sport: leagueInfo?.sport || 'nfl',
          type: isDynasty ? 'dynasty' : 'redraft',
          scoring: 'unknown',
        },
        roster_count: 0,
        offseasonContext: isOffseasonEmpty ? {
          offseason: true,
          offseasonBadge: leagueStatus === 'pre_draft' ? 'Pre-Draft Mode' : 'Offseason Mode',
          offseasonNote: 'No waiver candidates available in current league phase.',
        } : null,
      })
    }

    const rosterPlayers: WaiverRosterPlayer[] = userRosterCategorized.map((p, i) => {
      const priced = rosterValueResults[i]
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        slot: p.slot,
        age: p.age ?? null,
        value: priced.value,
        assetValue: priced.assetValue,
      }
    })

    const valuationCache = new Map<string, number>()
    for (let i = 0; i < userRosterCategorized.length; i++) {
      const name = userRosterCategorized[i]?.name
      const priced = rosterValueResults[i]
      if (name && priced?.value != null) valuationCache.set(name, priced.value)
    }

    const leaguePlayerNames = Array.from(
      new Set(
        rosters.flatMap((roster) =>
          (roster.players || [])
            .map((pid) => allPlayers[pid])
            .filter((p): p is SleeperPlayer => Boolean(p))
            .map((p) => p.full_name || `${p.first_name} ${p.last_name}`)
            .filter(Boolean),
        ),
      ),
    ).slice(0, 550)

    await Promise.all(
      leaguePlayerNames.map(async (name) => {
        if (valuationCache.has(name)) return
        try {
          const priced = await pricePlayer(name, valCtx)
          valuationCache.set(name, priced.value)
        } catch {
          valuationCache.set(name, 1000)
        }
      }),
    )
    const needs = detectNeeds(rosterPlayers, isSF)
    const surplus = detectSurplus(rosterPlayers)

    const allLeagueRosterPlayers = rosters.map((r) => {
      const categorized = categorizeRoster(r, allPlayers)
      return {
        players: categorized.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          team: p.team,
          slot: p.slot,
          age: p.age ?? null,
          value: valuationCache.get(p.name) ?? 1000,
        })) as WaiverRosterPlayer[],
      }
    })

    const currentWeek: number = Number(leagueInfo.settings?.leg) || 1
    const teamNeeds = computeTeamNeeds(rosterPlayers, rosterPositions, allLeagueRosterPlayers, currentWeek)

    const goal: UserGoal = userProvidedGoal && ['win-now', 'balanced', 'rebuild'].includes(userProvidedGoal)
      ? userProvidedGoal
      : deriveGoalFromContext(userPts, leagueAvg, isDynasty)

    const candidateNames = waiverCandidates.map(c => c.playerName)
    let analyticsMap: Map<string, any> | undefined
    try {
      analyticsMap = await getPlayerAnalyticsBatch(candidateNames)
      if (analyticsMap.size === 0) analyticsMap = undefined
    } catch { analyticsMap = undefined }

    let trendingMap: Map<string, CrowdTrendData> | undefined
    try {
      const trendingRows = await prisma.trendingPlayer.findMany({
        where: {
          sport: 'nfl',
          expiresAt: { gt: new Date() },
          playerName: { not: null },
        },
      })
      if (trendingRows.length > 0) {
        trendingMap = new Map()
        const normalizeName = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
        for (const row of trendingRows) {
          if (row.playerName) {
            const data: CrowdTrendData = {
              addCount: row.addCount,
              dropCount: row.dropCount,
              netTrend: row.netTrend,
              crowdSignal: row.crowdSignal as CrowdTrendData['crowdSignal'],
              crowdScore: row.crowdScore,
              addRank: row.addRank,
              dropRank: row.dropRank,
            }
            trendingMap.set(row.playerName, data)
            trendingMap.set(normalizeName(row.playerName), data)
          }
        }
        if (trendingMap.size === 0) trendingMap = undefined
      }
    } catch { trendingMap = undefined }

    const scoringCtx: WaiverScoringContext = {
      goal,
      needs,
      surplus,
      isSF,
      isTEP,
      numTeams,
      isDynasty,
      rosterPlayers,
      teamNeeds,
      currentWeek,
      analyticsMap,
      trendingMap,
    }

    const deterministicResults = scoreWaiverCandidates(waiverCandidates, scoringCtx, { maxResults: 10 })
    console.log(`[WaiverAI] Deterministic engine: ${deterministicResults.length} scored targets for ${resolvedUsername} (goal=${goal})`)
    const waiverIntelSignals: WaiverIntelSignal[] = buildWaiverIntelSignals(deterministicResults, scoringCtx)


    const grokPlayerSignals = await fetchPlayerNewsFromGrok(
      deterministicResults.slice(0, 20).map((r) => r.playerName),
    ).catch(() => [])
    const grokDeltaEvents = normalizeGrokSignalsToDeltaEvents(grokPlayerSignals || [])
    const grokDeltaCacheWrites = await persistGrokDeltaEvents(grokDeltaEvents).catch(() => 0)

    const sentimentByPlayer = new Map<string, string>()
    for (const sig of grokPlayerSignals || []) {
      if (sig?.playerName) sentimentByPlayer.set(sig.playerName.toLowerCase(), String(sig.sentiment || 'neutral'))
    }

    const eventByPlayerSlug = new Map<string, (typeof grokDeltaEvents)[number]['event']>()
    for (const evt of grokDeltaEvents) {
      const entityId = evt?.event?.entity_id
      if (entityId) eventByPlayerSlug.set(entityId, evt.event)
    }

    const getOverlayFromSentiment = (playerName: string): number => {
      const sentiment = sentimentByPlayer.get(playerName.toLowerCase()) || 'neutral'
      if (sentiment === 'bullish') return 6
      if (sentiment === 'bearish') return -6
      if (sentiment === 'injury_concern') return -10
      return 0
    }

    const legacyWaiverCandidates = deterministicResults.slice(0, 8).map((target) => {
      const xBuzzScore = normalizeScore(50 + getOverlayFromSentiment(target.playerName) * 5)
      const acquisitionCostPenalty = normalizeScore((target.faabBid ?? 0) * 4)
      const structuredScore = computeWaiverScore({
        opportunityScore: normalizeScore(target.dimensions.startNow),
        talentUpsideScore: normalizeScore(target.dimensions.stash * 0.6 + target.dimensions.startNow * 0.4),
        shortTermUsability: normalizeScore(target.dimensions.startNow),
        longTermStashValue: normalizeScore(target.dimensions.stash),
        rosterFitScore: normalizeScore(target.dimensions.needFit),
        usageTrendScore: normalizeScore(target.dimensions.leagueDemand),
        scheduleScore: normalizeScore(target.dimensions.startNow * 0.65 + target.dimensions.needFit * 0.35),
        playoffStashScore: normalizeScore(isDynasty ? target.dimensions.stash : target.dimensions.startNow),
        xBuzzScore,
        acquisitionCostPenalty,
      })

      const playerSlug = `nfl_${target.playerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
      const matchedEvent = eventByPlayerSlug.get(playerSlug)
      const grokOverlayRaw = getOverlayFromSentiment(target.playerName)
      const fused = fuseDecisionScore({
        deepseekStructuredScore: structuredScore,
        grokLiveOverlayAdjustment: grokOverlayRaw,
        eventType: matchedEvent?.event_type,
        eventConfidence: matchedEvent?.confidence,
      })

      const currentRosterSpotScore = normalizeScore((target.dropCandidate?.value ?? 1200) / 40)
      const addDropDelta = computeAddDropDelta({
        waiverTargetScore: structuredScore,
        currentRosterSpotScore,
      })

      return {
        playerName: target.playerName,
        playerId: target.playerId,
        deepseekStructuredScore: structuredScore,
        fusedScore: fused.finalScore,
        cappedGrokAdjustment: fused.cappedGrokAdjustment,
        grokAdjustmentCap: fused.grokCap,
        grokOverlayRaw,
        addDropDelta,
        recommendation: target.recommendation,
        faabBid: target.faabBid,
      }
    })

    legacyWaiverCandidates.sort((a, b) => b.fusedScore - a.fusedScore)
    const topLegacyWaiver = legacyWaiverCandidates[0] || null

    const waiverNotifications = {
      private_dm:
        topLegacyWaiver && (resolvedUserId || resolvedUsername)
          ? buildPrivateWaiverCoachingNotification({
              userId: resolvedUserId || resolvedUsername,
              topPlayer: topLegacyWaiver.playerName,
              action:
                topLegacyWaiver.addDropDelta >= 12
                  ? `Prioritize this claim now. Suggested bid: ${topLegacyWaiver.faabBid ?? 0}% FAAB.`
                  : `Viable add, but keep bid disciplined at ${topLegacyWaiver.faabBid ?? 0}% FAAB.`,
              confidence: topLegacyWaiver.fusedScore >= 75 ? 0.82 : topLegacyWaiver.fusedScore >= 65 ? 0.74 : 0.62,
            })
          : null,
      league_chat: topLegacyWaiver
        ? buildLeagueWaiverProcessedNotification({
            leagueId: league_id,
            playerName: topLegacyWaiver.playerName,
            recommendation: topLegacyWaiver.recommendation,
          })
        : null,
    }

    let narratives: Record<string, string> = {}
    let summary = ''
    let rosterNotes: string[] = []
    try {
      const narrativeInput = deterministicResults.slice(0, 8).map(t => ({
        rank: t.priorityRank,
        name: t.playerName,
        pos: t.position,
        team: t.team,
        recommendation: t.recommendation,
        composite: t.compositeScore,
        dims: t.dimensions,
        topDrivers: t.topDrivers.map(d => ({ id: d.id, label: d.label, score: d.score, direction: d.direction, detail: d.detail })),
        drop: t.dropCandidate?.name || null,
        dropRisk: t.dropCandidate?.riskLabel || null,
        faabBid: t.faabBid,
      }))

      const narrativeUserPrompt = `League: ${leagueInfo.name} | ${scoringType} | ${numTeams} teams | ${isSF ? 'Superflex' : '1QB'} | ${isTEP ? 'TEP' : 'Standard TE'}
Team Goal: ${goal.toUpperCase()}
Biggest Need: ${teamNeeds.biggestNeed ? `${teamNeeds.biggestNeed.slot} (${teamNeeds.biggestNeed.position}, +${teamNeeds.biggestNeed.gapPpg} PPG gap)` : 'None identified'}
Needs: ${needs.join(', ') || 'None'}
Surplus: ${surplus.join(', ') || 'None'}
Bye Week Clusters: ${teamNeeds.byeWeekClusters.map(c => `Wk${c.week} (${c.severity}: ${c.playersOut.join(', ')})`).join('; ') || 'None'}

DETERMINISTIC WAIVER RESULTS (do NOT change rankings or scores):
${JSON.stringify(narrativeInput, null, 2)}

Write narrative summary, per-player reasoning, and roster notes.`

      const narrativeCachePayload = {
        feature: 'legacy-waiver-analyze-narrative',
        leagueId: normalizedLeagueId,
        userId: resolvedUserId || resolvedUsername,
        sport: leagueInfo.sport || 'nfl',
        season: String((leagueInfo as any)?.season || ''),
        week: Number((leagueInfo as any)?.settings?.leg ?? 0),
        scoringType,
        isSF,
        isTEP,
        numTeams,
        goal,
        needs: [...needs].sort(),
        surplus: [...surplus].sort(),
        topDeterministicResults: deterministicResults.slice(0, 8).map((t) => ({
          playerId: t.playerId,
          playerName: t.playerName,
          position: t.position,
          team: t.team,
          recommendation: t.recommendation,
          compositeScore: t.compositeScore,
          dimensions: t.dimensions,
          topDrivers: t.topDrivers.map((d) => ({ id: d.id, score: d.score, direction: d.direction })),
          dropCandidate: t.dropCandidate?.name || null,
          faabBid: t.faabBid,
        })),
        promptVersion: 'v1',
      }

      const aiResult = await getOrCreateAiResult({
        feature: 'legacy-waiver-analyze-narrative',
        scopeType: 'league',
        scopeId: normalizedLeagueId,
        provider: 'openai',
        model: 'gpt-4o',
        payload: narrativeCachePayload,
        ttlSeconds: 60 * 60,
        onCacheMiss: async () => {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            temperature: 0.5,
            max_tokens: 1500,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: NARRATIVE_PROMPT },
              { role: 'user', content: narrativeUserPrompt },
            ],
          })

          const content = completion.choices[0]?.message?.content || '{}'
          return {
            resultText: content,
            resultJson: { content },
            tokenPrompt: completion.usage?.prompt_tokens ?? null,
            tokenOutput: completion.usage?.completion_tokens ?? null,
          }
        },
      })

      if (aiResult.cacheHit) {
        console.log(`[legacy-waiver/analyze] AI cache hit { leagueId: '${normalizedLeagueId}', userId: '${resolvedUserId || resolvedUsername}' }`)
      } else {
        console.log(`[legacy-waiver/analyze] AI cache miss { leagueId: '${normalizedLeagueId}', userId: '${resolvedUserId || resolvedUsername}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
        console.log(`[legacy-waiver/analyze] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
      }

      const content =
        (typeof aiResult.row.resultText === 'string' && aiResult.row.resultText.trim()) ||
        ((aiResult.row.resultJson as any)?.content as string | undefined)
      if (content) {
        const parsed = JSON.parse(content)
        summary = parsed.summary || ''
        narratives = parsed.narratives || {}
        rosterNotes = parsed.roster_notes || []
      }
    } catch (e) {
      console.error('GPT narrative generation failed (using deterministic fallback):', e)
      summary = `Found ${deterministicResults.length} waiver targets. Your team goal is ${goal}.`
      rosterNotes = needs.length > 0 ? [`Your roster has needs at: ${needs.join(', ')}`] : ['Roster is well-balanced']
    }

    const analysis = {
      league_name: leagueInfo.name,
      league_id,
      league_context: {
        scoring_format: scoringType,
        is_superflex: isSF,
        is_tep: isTEP,
        tep_bonus: leagueInfo.scoring_settings?.bonus_rec_te ?? null,
        team_count: numTeams,
        roster_positions: rosterPositions.filter((p: string) => p !== 'BN'),
        league_type: leagueType,
      },
      team_goal: goal,
      biggest_need: teamNeeds.biggestNeed ? {
        slot: teamNeeds.biggestNeed.slot,
        position: teamNeeds.biggestNeed.position,
        current_player: teamNeeds.biggestNeed.currentPlayer,
        gap_ppg: teamNeeds.biggestNeed.gapPpg,
      } : null,
      weakest_slots: teamNeeds.weakestSlots.slice(0, 3).map(s => ({
        slot: s.slot,
        position: s.position,
        current_player: s.currentPlayer,
        gap_ppg: s.gapPpg,
      })),
      bye_week_alerts: teamNeeds.byeWeekClusters.slice(0, 3).map(c => ({
        week: c.week,
        players_out: c.playersOut,
        positions_affected: c.positionsAffected,
        severity: c.severity,
      })),
      positional_depth: teamNeeds.positionalDepth.map(d => ({
        position: d.position,
        count: d.count,
        league_median: d.leagueMedianCount,
        depth_rating: d.depthRating,
      })),
      summary,
      one_move: null as any,
      suggestions: null as any,
      roster_notes: rosterNotes,
      intel_signals: waiverIntelSignals,
    }

    const waiverPlayerIds = deterministicResults
      .filter(t => t.playerId)
      .map(t => ({ playerId: t.playerId, teamAbbr: t.team || null, sport: 'nfl' }))
    const waiverMediaMap = waiverPlayerIds.length > 0
      ? await attachPlayerMediaBatch(waiverPlayerIds)
      : new Map()

    if (deterministicResults.length > 0) {
      const top = deterministicResults[0]
      const topMedia = waiverMediaMap.get(top.playerId)
      analysis.one_move = {
        player_name: top.playerName,
        player_id: top.playerId,
        position: top.position,
        team: top.team,
        composite_score: top.compositeScore,
        recommendation: top.recommendation,
        faab_bid: top.faabBid,
        top_drivers: top.topDrivers,
        drop_candidate: top.dropCandidate,
        reasoning: narratives[top.playerName] || top.topDrivers.filter((d: any) => d.direction === 'positive').map((d: any) => d.detail).join('. '),
        intel_signal: waiverIntelSignals.find((s) => s.playerName === top.playerName) || null,
        playerId: top.playerId,
        fullName: top.playerName,
        teamAbbr: topMedia?.teamAbbr || top.team,
        sport: 'nfl' as const,
        media: topMedia?.media || { headshotUrl: null, teamLogoUrl: null },
      }
    }

    analysis.suggestions = deterministicResults.map((t) => {
      const resolved = waiverMediaMap.get(t.playerId)
      return {
        player_name: t.playerName,
        player_id: t.playerId,
        position: t.position,
        team: t.team,
        age: t.age,
        tier: t.recommendation,
        priority: t.priorityRank,
        composite_score: t.compositeScore,
        dimension_scores: t.dimensions,
        top_drivers: t.topDrivers,
        all_drivers: t.drivers,
        faab_bid: t.faabBid,
        reasoning: narratives[t.playerName] || t.topDrivers.filter((d: any) => d.direction === 'positive').map((d: any) => d.detail).join('. ') || 'Deterministic analysis recommends this pickup.',
        drop_candidate: t.dropCandidate?.name || null,
        drop_reasoning: t.dropCandidate?.reason || null,
        drop_risk_of_regret: t.dropCandidate?.riskOfRegret ?? null,
        drop_risk_label: t.dropCandidate?.riskLabel ?? null,
        value: t.value,
        playerId: t.playerId,
        fullName: t.playerName,
        teamAbbr: resolved?.teamAbbr || t.team,
        sport: 'nfl' as const,
        media: resolved?.media || { headshotUrl: null, teamLogoUrl: null },
      }
    })

    trackLegacyToolUsage('waiver_ai', null, null, { sleeperUsername: resolvedUsername, sleeperUserId: resolvedUserId, leagueId: league_id })

    const learningContext = await getComprehensiveLearningContext().catch(() => null)
    const hitRate = await getHistoricalHitRate(resolvedUsername, 'waiver', league_id).catch(() => null)

    const crResult = computeConfidenceRisk({
      category: 'waiver',
      userId: resolvedUserId || resolvedUsername,
      leagueId: league_id,
      dataCompleteness: {
        hasHistoricalData: !!learningContext,
        dataPointCount: deterministicResults.length * 10,
        playerCoverage: 0.8,
        isCommonScenario: true,
      },
      waiverContext: {
        teamStatus: goal.toUpperCase(),
        suggestionCount: deterministicResults.length,
        freeAgentPoolSize: freeAgents.length,
      },
      historicalHitRate: hitRate,
    })

    if (deterministicResults.length > 0) {
      autoLogDecision({
        userId: resolvedUserId || resolvedUsername,
        leagueId: league_id,
        decisionType: 'waiver',
        aiRecommendation: {
          summary: `Waiver: ${deterministicResults.length} suggestions (${goal} team)`,
          teamGoal: goal,
          topPick: deterministicResults[0]?.playerName,
          topTier: deterministicResults[0]?.recommendation,
          suggestionCount: deterministicResults.length,
        },
        confidenceScore: crResult.confidenceScore01,
        riskProfile: crResult.riskProfile,
        contextSnapshot: { leagueId: league_id, leagueType, scoringType, goal },
        confidenceRisk: crResult,
      })
    }

    const offseasonContext = isOffseason ? {
      offseason: true,
      offseasonBadge: leagueStatus === 'pre_draft' ? 'Pre-Draft Mode' : 'Offseason Mode',
      offseasonNote: leagueStatus === 'pre_draft'
        ? 'League is in pre-draft. Waiver recommendations use dynasty ADP projections. Weekly scoring data is unavailable.'
        : 'Season is complete. Waiver analysis uses end-of-season baselines and dynasty outlook. Live stats unavailable.',
    } : null

    return NextResponse.json({
      ok: true,
      analysis,
      confidenceRisk: {
        confidence: crResult.numericConfidence,
        level: crResult.confidenceLevel,
        volatility: crResult.volatilityLevel,
        riskProfile: crResult.riskProfile,
        riskTags: crResult.riskTags,
        explanation: crResult.explanation,
      },
      league: {
        name: leagueInfo.name,
        id: league_id,
        sport: leagueInfo.sport,
        type: leagueType,
        scoring: scoringType,
      },
      roster_count: userRosterCategorized.length,
      free_agent_count: freeAgents.length,
      remaining: rl.remaining,
      legacyDecision: {
        topCandidates: legacyWaiverCandidates.slice(0, 5),
        topRecommendation: topLegacyWaiver,
        grokDeltaEventsApplied: grokDeltaCacheWrites,
      },
      notificationsPreview: waiverNotifications,
      ...(offseasonContext ? { offseasonContext } : {}),
    })
  } catch (error: any) {
    console.error('Waiver analyze error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
})

