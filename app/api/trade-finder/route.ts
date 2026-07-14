import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { buildBaselineMeta } from '@/lib/engine/response-guard'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { buildLeagueDecisionContext, summarizeLeagueDecisionContext } from '@/lib/league-decision-context'
import { getLeagueInfo, getLeagueRosters, getTradedDraftPicks, getAllPlayers } from '@/lib/sleeper-client'
import {
  findPlayerByName,
  getCanonicalPlayerValuations,
  FantasyCalcPlayer,
} from '@/lib/player-valuations/canonicalPlayerValuations'
import { parseSleeperRosterPositions } from '@/lib/trade-engine/sleeper-converter'
import {
  generateTradeCandidates,
  TradeCandidate,
  PricedAsset,
  TradeObjective,
  FinderMode,
  TradeOpportunity,
} from '@/lib/trade-finder/candidate-generator'
import { Position } from '@/lib/league-decision-context'
import {
  NEGOTIATION_RULES,
  NEGOTIATION_USER_INSTRUCTION,
} from '@/lib/trade-evaluator-prompt'
import {
  buildFaabSteps,
  buildScarcityNotes,
  clampNegotiationToAllowed,
  buildLabelToIdMap,
} from '@/lib/trade-finder/negotiation-helpers'
import {
  buildAllowedAssets,
  type AllowedPricedAsset,
  type TeamProfileLite,
} from '@/lib/trade-finder/allowed-assets'
import { buildAssetIndex, makeSleeperPickId } from '@/lib/trade-finder/asset-index'
import { buildTradeHubIntelBlock, parseTradeIntelBlockMeta } from '@/lib/trade-engine/trade-analyzer-intel'

const TradeFinderRequestSchema = z.object({
  league_id: z.string(),
  user_roster_id: z.number().optional(),
  sleeper_user_id: z.string().optional(),
  objective: z.enum(['WIN_NOW', 'REBUILD', 'BALANCED']).default('BALANCED'),
  mode: z.enum(['FAST', 'DEEP']).default('FAST'),
  preset: z.enum(['NONE', 'TARGET_POSITION', 'ACQUIRE_PICKS', 'CONSOLIDATE']).default('NONE'),
  target_position: z.enum(['QB', 'RB', 'WR', 'TE']).optional(),
  preferredTone: z.enum(['FRIENDLY', 'CONFIDENT', 'CASUAL', 'DATA_BACKED', 'SHORT']).optional(),
})

const TRADE_FINDER_SYSTEM_PROMPT = `
You are an expert fantasy football trade advisor operating inside a deterministic trade suggestion system.

IMPORTANT RULES:
- You do NOT invent new trades. You ONLY rank and explain the provided candidates.
- All values, tiers, scores, and archetypes are pre-computed and authoritative.
- You pick the best 3-5 candidates from the list provided.
- For each selection, explain WHY it helps the user's team AND why the partner might accept.

Your job:
1. Select the top 3-5 trade candidates from the provided list.
2. For each, provide a clear explanation of team fit and negotiation angle.
3. Assign a confidence rating based on trade quality and data completeness.
4. Suggest a "Plan B" fallback asset for each trade if the primary gets rejected.
5. For each recommendation, generate a negotiation toolkit with DM messages, counter-offers, sweeteners, and red lines.

${NEGOTIATION_RULES}

WEATHER-AWARE CONTEXT:
- Consider upcoming game weather if relevant (e.g. avoid suggesting outdoor kickers/DEF in heavy rain/snow).
- If a player's upcoming matchup involves extreme weather conditions, factor that into short-term value and win-now recommendations.
- Default to standard conditions unless game-specific weather data is provided in the payload.

ADDITIONAL NEGOTIATION CONTEXT:
- Messages should be ready-to-paste into a league chat (Sleeper DM style).
- Counter-offers must reference specific asset ids from the allowedAssets lists in the payload.
- If the user provides a preferredTone, weight that tone first in messages.

You must return ONLY valid JSON matching the provided response schema.
Do not include markdown, commentary, or extra text.

RESPONSE FORMAT:
{
  "recommendations": [
    {
      "tradeId": string,
      "rank": number,
      "summary": string,
      "whyItHelpsYou": string,
      "whyTheyAccept": string,
      "negotiationTip": string,
      "confidence": number (0-100, how likely this trade gets accepted AND helps the user),
      "winProbDelta": string (estimated short-term win probability change, e.g. "+12%", "-5%", or "neutral"),
      "riskFlags": string[],
      "fallbackAsset": string | null,
      "negotiation": {
        "dmMessages": [
          {
            "tone": "FRIENDLY" | "CONFIDENT" | "CASUAL" | "DATA_BACKED" | "SHORT",
            "message": string,
            "hook": string
          }
        ],
        "counters": [
          {
            "label": string,
            "ifTheyObject": string,
            "counterTrade": {
              "youAdd": string[],
              "youRemove": string[],
              "theyAdd": string[],
              "theyRemove": string[]
            },
            "rationale": string
          }
        ],
        "sweeteners": [
          {
            "label": string,
            "addOn": { "faab": number | null, "pickSwap": string | null },
            "whenToUse": string
          }
        ],
        "redLines": string[]
      }
    }
  ],
  "overallStrategy": string,
  "objectiveNotes": string
}
`


type TradeFinderProviderAudit = {
  modelRole: 'openai_reasoning'
  normalizedSignalCount: number | null
  sourceWeighting: string[]
  newsItemCount: number
  dataGaps: string[]
}
function buildTradeFinderIntelReconciliationDirective(audit: TradeFinderProviderAudit): string {
  const gaps = audit.dataGaps.length ? audit.dataGaps.join('; ') : 'none'
  const weighting = audit.sourceWeighting.length ? audit.sourceWeighting.join(', ') : 'none'
  return [
    'INTEL_RECONCILIATION_DIRECTIVE:',
    `- model_role: ${audit.modelRole}`,
    `- normalized_signal_count: ${audit.normalizedSignalCount ?? 'unknown'}`,
    `- source_weighting: ${weighting}`,
    `- news_items: ${audit.newsItemCount}`,
    `- data_gaps: ${gaps}`,
    '- instruction: If trade recommendation confidence is high while intel coverage is thin, lower confidence and explain what evidence is missing.',
    '- instruction: Resolve conflicting signals by prioritizing higher-confidence, fresher signals and clearly state uncertainty.',
  ].join('\n')
}
function valueToTier(value: number): string {
  if (value >= 9000) return 'Tier0_Untouchable'
  if (value >= 7500) return 'Tier1_Cornerstone'
  if (value >= 5500) return 'Tier2_HighEnd'
  if (value >= 3500) return 'Tier3_Starter'
  if (value >= 1500) return 'Tier4_Depth'
  return 'Tier5_Filler'
}

const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE']

async function buildPricedAssetsByRoster(
  rosters: any[],
  allPlayers: Record<string, any>,
  fcPlayers: FantasyCalcPlayer[],
  isSF: boolean
): Promise<Record<string, PricedAsset[]>> {
  const result: Record<string, PricedAsset[]> = {}

  for (const roster of rosters) {
    const teamId = String(roster.roster_id)
    const playerIds = roster.players || []
    const starterIds = new Set(roster.starters || [])
    const assets: PricedAsset[] = []

    for (const pid of playerIds) {
      const sleeperInfo = allPlayers[pid]
      if (!sleeperInfo) continue

      const pos = (sleeperInfo.position || '').toUpperCase()
      if (!SKILL_POSITIONS.includes(pos)) continue

      const fullName = sleeperInfo.full_name || `${sleeperInfo.first_name} ${sleeperInfo.last_name}`
      const fcMatch = findPlayerByName(fcPlayers, fullName)
      const value = fcMatch?.value ?? 0

      if (value < 200) continue

      assets.push({
        assetId: pid,
        name: fullName,
        value,
        position: pos as Position,
        tier: valueToTier(value),
        age: sleeperInfo.age ?? fcMatch?.player?.maybeAge ?? undefined,
        isStarter: starterIds.has(pid),
        isPick: false,
        injuryFlag: sleeperInfo.injury_status === 'Out' || sleeperInfo.injury_status === 'IR',
      })
    }

    result[teamId] = assets
  }

  return result
}

function computePickValue(round: number, year: number): number {
  const roundWeight = round === 1 ? 5500 : round === 2 ? 2000 : round === 3 ? 1000 : 500
  const yearDistance = Math.max(0, year - new Date().getFullYear())
  const yearMultiplier = yearDistance <= 1 ? 1 : yearDistance <= 2 ? 0.85 : 0.7
  return Math.round(roundWeight * yearMultiplier)
}

function addPickAssets(
  pricedAssets: Record<string, PricedAsset[]>,
  tradedPicks: any[],
  rosters: any[],
  totalTeams: number
): void {
  const currentYear = new Date().getFullYear()
  const futureYears = [currentYear, currentYear + 1, currentYear + 2]
  const defaultRounds = [1, 2, 3]

  const ownedPicks: Record<string, Set<string>> = {}
  for (const roster of rosters) {
    const teamId = String(roster.roster_id)
    ownedPicks[teamId] = new Set()
    for (const year of futureYears) {
      for (const round of defaultRounds) {
        ownedPicks[teamId].add(`${year}_${round}`)
      }
    }
  }

  for (const pick of tradedPicks) {
    const originalOwner = String(pick.roster_id)
    const currentOwner = String(pick.owner_id)
    const year = typeof pick.season === 'string' ? parseInt(pick.season) : pick.season
    const pickKey = `${year}_${pick.round}`

    if (ownedPicks[originalOwner]) {
      ownedPicks[originalOwner].delete(pickKey)
    }
    if (ownedPicks[currentOwner]) {
      ownedPicks[currentOwner].add(pickKey)
    }
  }

  for (const roster of rosters) {
    const teamId = String(roster.roster_id)
    if (!pricedAssets[teamId]) pricedAssets[teamId] = []

    const teamPickKeys = ownedPicks[teamId] || new Set()
    for (const pickKey of teamPickKeys) {
      const [yearStr, roundStr] = pickKey.split('_')
      const year = parseInt(yearStr)
      const round = parseInt(roundStr)
      const value = computePickValue(round, year)

      const pickId = makeSleeperPickId({ season: year, round, ownerId: teamId })
      pricedAssets[teamId].push({
        assetId: pickId,
        name: `${year} Round ${round}`,
        value,
        position: 'PICK' as any,
        tier: valueToTier(value),
        isStarter: false,
        isPick: true,
        pickYear: year,
        pickRound: round,
      })
    }
  }
}

export const POST = withApiUsage({ endpoint: "/api/trade-finder", tool: "TradeFinder" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const data = TradeFinderRequestSchema.parse(body)
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null

    const ip = getClientIp(request)
    const rl = consumeRateLimit({
      scope: 'ai',
      action: 'trade_finder',
      sleeperUsername: data.league_id,
      ip,
      maxRequests: 6,
      windowMs: 60_000,
      includeIpInKey: true,
    })

    if (!rl.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.', retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const [sleeperLeague, sleeperRosters, sleeperTradedPicks, allPlayers] = await Promise.all([
      getLeagueInfo(data.league_id),
      getLeagueRosters(data.league_id),
      getTradedDraftPicks(data.league_id),
      getAllPlayers(),
    ])

    if (!sleeperLeague || sleeperRosters.length === 0) {
      return NextResponse.json({ error: 'League not found or has no rosters' }, { status: 404 })
    }

    let resolvedRosterId: number | undefined = data.user_roster_id
    if (!resolvedRosterId && data.sleeper_user_id) {
      const matchedRoster = sleeperRosters.find((r: any) => r.owner_id === data.sleeper_user_id)
      if (matchedRoster) {
        resolvedRosterId = matchedRoster.roster_id
      }
    }
    if (!resolvedRosterId && session?.user?.id) {
      try {
        const localLeague = await (prisma as any).league.findFirst({
          where: {
            userId: session.user.id,
            platformLeagueId: data.league_id,
          },
          include: { rosters: true },
        })

        const localRoster = localLeague?.rosters?.find((r: any) => r.platformUserId === session.user?.id)
        if (localRoster?.platformUserId) {
          const sleeperMatch = sleeperRosters.find((r: any) => r.owner_id === localRoster.platformUserId)
          if (sleeperMatch?.roster_id) {
            resolvedRosterId = Number(sleeperMatch.roster_id)
          }
        }
      } catch (e) {
        console.warn('[TradeFinder] Failed to auto-resolve roster id:', (e as Error)?.message)
      }
    }
    if (!resolvedRosterId) {
      return NextResponse.json(
        { error: 'Could not resolve your roster in this league. Re-sync league or pass user_roster_id.' },
        { status: 400 }
      )
    }

    const rosterSlots = parseSleeperRosterPositions(sleeperLeague.roster_positions)
    const isSF = rosterSlots.superflex

    let fcPlayers: FantasyCalcPlayer[] = []
    try {
      fcPlayers = await getCanonicalPlayerValuations({
        isDynasty: true,
        numQbs: isSF ? 2 : 1,
        numTeams: sleeperLeague.total_rosters || 12,
        ppr: 1,
      })
    } catch (e) {
      console.warn('[TradeFinder] FantasyCalc load failed:', (e as Error)?.message)
    }

    const [leagueDecisionCtx, pricedAssets] = await Promise.all([
      buildLeagueDecisionContext({
        league: sleeperLeague,
        rosters: sleeperRosters,
        tradedPicks: sleeperTradedPicks as any,
        userRosterId: resolvedRosterId,
        isSuperFlex: isSF,
      }),
      buildPricedAssetsByRoster(sleeperRosters, allPlayers, fcPlayers, isSF),
    ])

    addPickAssets(pricedAssets, sleeperTradedPicks as any, sleeperRosters, sleeperLeague.total_rosters || 12)

    const userTeamId = String(resolvedRosterId)

    const generatorOutput = generateTradeCandidates({
      userTeamId,
      leagueDecisionContext: leagueDecisionCtx,
      pricedAssets,
      objective: data.objective as TradeObjective,
      mode: data.mode as FinderMode,
    })

    if (data.preset !== 'NONE' && generatorOutput.candidates.length > 0) {
      generatorOutput.candidates = generatorOutput.candidates.filter(c => {
        const userReceives = c.teamA.receives;
        const userGives = c.teamA.gives;

        if (data.preset === 'TARGET_POSITION' && data.target_position) {
          return userReceives.some(a => !a.isPick && a.position === data.target_position);
        }

        if (data.preset === 'ACQUIRE_PICKS') {
          return userReceives.some(a => a.isPick) && userReceives.filter(a => a.isPick).length >= userGives.filter(a => a.isPick).length;
        }

        if (data.preset === 'CONSOLIDATE') {
          return userGives.filter(a => !a.isPick).length > userReceives.filter(a => !a.isPick).length;
        }

        return true;
      });

      if (data.preset === 'TARGET_POSITION' && data.target_position) {
        generatorOutput.candidates.sort((a, b) => {
          const aTargetValue = a.teamA.receives.filter(r => !r.isPick && r.position === data.target_position).reduce((s, r) => s + r.value, 0);
          const bTargetValue = b.teamA.receives.filter(r => !r.isPick && r.position === data.target_position).reduce((s, r) => s + r.value, 0);
          return bTargetValue - aTargetValue;
        });
      }

      if (data.preset === 'ACQUIRE_PICKS') {
        generatorOutput.candidates.sort((a, b) => {
          const aPickCount = a.teamA.receives.filter(r => r.isPick).length;
          const bPickCount = b.teamA.receives.filter(r => r.isPick).length;
          return bPickCount - aPickCount;
        });
      }

      if (data.preset === 'CONSOLIDATE') {
        generatorOutput.candidates.sort((a, b) => {
          const aConsolidation = a.teamA.gives.filter(g => !g.isPick).length - a.teamA.receives.filter(r => !r.isPick).length;
          const bConsolidation = b.teamA.gives.filter(g => !g.isPick).length - b.teamA.receives.filter(r => !r.isPick).length;
          return bConsolidation - aConsolidation;
        });
      }
    }

    if (generatorOutput.candidates.length === 0) {
      const note = generatorOutput.opportunities.length > 0
        ? 'No clean market wins today. Best options are below.'
        : 'Your team is well-balanced — no urgent moves needed right now.'
      return NextResponse.json({
        success: true,
        recommendations: [],
        opportunities: generatorOutput.opportunities,
        meta: {
          ...buildBaselineMeta("no_trade_opportunities", note),
          partnersEvaluated: generatorOutput.partnersEvaluated,
          rawCandidatesGenerated: generatorOutput.rawCandidatesGenerated,
          prunedTo: 0,
          hasOpportunities: generatorOutput.opportunities.length > 0,
          message: note,
        },
      })
    }

    const userTeam = leagueDecisionCtx.teams[userTeamId]

    const candidatePayload = generatorOutput.candidates.map(c => {
      const partnerTeamId = c.teamB.teamId
      const partnerTeamCtx = leagueDecisionCtx.teams[partnerTeamId]
      const partnerAssets = pricedAssets[partnerTeamId] || []

      const youSend = c.teamA.gives.map(a => ({
        id: a.assetId,
        label: a.name,
        kind: (a.isPick ? 'PICK' : 'PLAYER') as 'PLAYER' | 'PICK',
        tier: a.tier,
        value: a.value,
      }))
      const youReceive = c.teamA.receives.map(a => ({
        id: a.assetId,
        label: a.name,
        kind: (a.isPick ? 'PICK' : 'PLAYER') as 'PLAYER' | 'PICK',
        tier: a.tier,
        value: a.value,
      }))

      const currentYear = new Date().getFullYear()

      const toAllowedAsset = (a: PricedAsset): AllowedPricedAsset => ({
        id: a.assetId,
        label: a.name,
        kind: (a.isPick ? 'PICK' : 'PLAYER') as 'PLAYER' | 'PICK',
        position: typeof a.position === 'string' ? a.position : undefined,
        tier: a.tier,
        value: a.value,
        age: a.age,
        isStarter: a.isStarter,
        pickSeason: a.pickYear,
        pickRound: a.pickRound,
      })

      const userObjective = (data.objective === 'WIN_NOW' || data.objective === 'REBUILD')
        ? data.objective
        : 'BALANCED' as const

      const userProfile: TeamProfileLite = {
        teamId: userTeamId,
        competitiveWindow: userTeam?.competitiveWindow || 'MIDDLE',
        needs: userTeam?.needs || [],
        surpluses: userTeam?.surpluses || [],
      }

      const partnerProfile: TeamProfileLite = {
        teamId: partnerTeamId,
        competitiveWindow: partnerTeamCtx?.competitiveWindow || 'MIDDLE',
        needs: partnerTeamCtx?.needs || [],
        surpluses: partnerTeamCtx?.surpluses || [],
      }

      const allowed = buildAllowedAssets({
        objective: userObjective,
        userTeam: userProfile,
        partnerTeam: partnerProfile,
        userAssets: (pricedAssets[userTeamId] || []).map(toAllowedAsset),
        partnerAssets: partnerAssets.map(toAllowedAsset),
        currentYear,
        allowFutureFirsts: false,
        coreTopN: 2,
      })

      const userFaabRemaining = userTeam?.faabRemaining

      const latePicks = allowed.userPicksAllowed.filter(p =>
        p.id.includes('_r3_') || p.id.includes('_r4_')
      ).map(p => p.id)

      return {
        tradeId: c.tradeId,
        archetype: c.archetype,
        finderScore: c.finderScore,
        valueDeltaPct: c.valueDeltaPct,
        whyThisExists: c.whyThisExists,
        scoreBreakdown: c.scoreBreakdown,
        teamA: {
          teamId: c.teamA.teamId,
          gives: c.teamA.gives.map(a => ({ assetId: a.assetId, name: a.name, value: a.value, tier: a.tier, position: a.position, age: a.age, isPick: a.isPick })),
          receives: c.teamA.receives.map(a => ({ assetId: a.assetId, name: a.name, value: a.value, tier: a.tier, position: a.position, age: a.age, isPick: a.isPick })),
        },
        teamB: {
          teamId: c.teamB.teamId,
          gives: c.teamB.gives.map(a => ({ assetId: a.assetId, name: a.name, value: a.value, tier: a.tier, position: a.position, age: a.age, isPick: a.isPick })),
          receives: c.teamB.receives.map(a => ({ assetId: a.assetId, name: a.name, value: a.value, tier: a.tier, position: a.position, age: a.age, isPick: a.isPick })),
        },
        negotiationInput: {
          candidateTrade: {
            tradeId: c.tradeId,
            teamAId: userTeamId,
            teamBId: partnerTeamId,
            youSend,
            youReceive,
            partnerWindow: partnerTeamCtx?.competitiveWindow || 'MIDDLE',
            reasonCodes: c.whyThisExists ? [c.archetype, c.whyThisExists] : [c.archetype],
          },
          allowedAssets: {
            userAssetsAllowed: allowed.userAssetsAllowed,
            partnerAssetsAllowed: allowed.partnerAssetsAllowed,
            userPicksAllowed: allowed.userPicksAllowed,
            partnerPicksAllowed: allowed.partnerPicksAllowed,
            userFaabRemaining,
            redLineIds: [...allowed.redLineIds],
          },
          fairnessConstraints: {
            currentTradeValueDeltaPct: c.valueDeltaPct,
            bandMinPct: -15,
            bandMaxPct: 15,
            suggestedFaabSteps: buildFaabSteps(userFaabRemaining),
            suggestedPickSweeteners: latePicks.length > 0 ? latePicks : undefined,
          },
          leagueNegotiationContext: partnerTeamCtx ? {
            userNeeds: userTeam?.needs || [],
            partnerNeeds: partnerTeamCtx.needs || [],
            userSurpluses: userTeam?.surpluses || [],
            partnerSurpluses: partnerTeamCtx.surpluses || [],
            scarcityNotes: buildScarcityNotes(leagueDecisionCtx.market?.scarcityByPosition as Record<string, number> | undefined),
          } : undefined,
        },
      }
    })

    const userRosterAssets = pricedAssets[userTeamId]?.map(a => ({
      name: a.name, position: a.position, value: a.value, tier: a.tier, isPick: a.isPick,
    })) || []

    const intelPlayerNames = [
      ...Object.values(pricedAssets).flatMap((arr: PricedAsset[]) => arr.filter(a => !a.isPick).map(a => a.name)),
    ]
    const intelTeamAbbrevs = [
      ...Object.values(pricedAssets).flatMap((arr: PricedAsset[]) => arr.filter(a => !a.isPick).map(a => (a as any).teamAbbr).filter(Boolean)),
    ] as string[]
    const externalIntel = await buildTradeHubIntelBlock({
      playerNames: intelPlayerNames,
      teamAbbrevs: intelTeamAbbrevs,
      numTeams: sleeperLeague.total_rosters || 12,
      isSuperflex: isSF,
    }).catch(() => '')
    const externalIntelMeta = parseTradeIntelBlockMeta(externalIntel)
    const intelAudit: TradeFinderProviderAudit = {
      modelRole: 'openai_reasoning',
      normalizedSignalCount: externalIntelMeta.normalizedSignalCount,
      sourceWeighting: externalIntelMeta.sourceWeighting,
      newsItemCount: externalIntelMeta.newsItems,
      dataGaps: [
        ...(externalIntelMeta.normalizedSignalCount === null ? ['Missing normalized signal count'] : []),
        ...(externalIntelMeta.newsItems <= 0 ? ['No recent news context returned'] : []),
        ...(externalIntelMeta.sourceWeighting.length === 0 ? ['No source weighting metadata returned'] : []),
      ],
    }
    const reconciliationDirective = buildTradeFinderIntelReconciliationDirective(intelAudit)

    const openaiPayload = {
      userTeam: userTeam ? {
        teamId: userTeam.teamId,
        competitiveWindow: userTeam.competitiveWindow,
        needs: userTeam.needs,
        surpluses: userTeam.surpluses,
        flags: userTeam.flags,
      } : null,
      objective: data.objective,
      negotiationRequest: {
        enabled: true,
        fairnessBandPct: 15,
        maxDmMessages: 5,
        maxCounters: 4,
        maxSweeteners: 3,
        userObjective: data.objective,
        userStyle: data.preferredTone || undefined,
      },
      candidates: candidatePayload,
      market: leagueDecisionCtx.market,
      partnerFit: leagueDecisionCtx.partnerFit,
      userRosterAssets,
      preferredTone: data.preferredTone || null,
      externalIntel,
      intelligenceAudit: intelAudit,
    }

    const userPayloadStr =
      JSON.stringify(openaiPayload) +
      '\n\n' +
      reconciliationDirective +
      '\n\n' +
      NEGOTIATION_USER_INSTRUCTION

    const result = await openaiChatJson({
      messages: [
        { role: 'system', content: TRADE_FINDER_SYSTEM_PROMPT },
        { role: 'user', content: userPayloadStr },
      ],
      temperature: 0.3,
      maxTokens: 6000,
    })

    if (!result.ok) {
      console.error('Trade Finder OpenAI error:', result.details.slice(0, 500))
      return NextResponse.json({
        success: true,
        recommendations: generatorOutput.candidates.slice(0, 5).map(c => ({
          tradeId: c.tradeId,
          archetype: c.archetype,
          finderScore: c.finderScore,
          teamA: c.teamA,
          teamB: c.teamB,
          whyThisExists: c.whyThisExists,
          summary: `${c.archetype} trade with score ${c.finderScore}/100`,
        })),
        meta: {
          partnersEvaluated: generatorOutput.partnersEvaluated,
          rawCandidatesGenerated: generatorOutput.rawCandidatesGenerated,
          prunedTo: generatorOutput.prunedTo,
          aiEnhanced: false,
          note: 'AI enhancement unavailable — showing raw scored candidates',
        },
      })
    }

    const parsed = parseJsonContentFromChatCompletion(result.json)

    const recommendations = (parsed?.recommendations || []).map((rec: any) => {
      if (rec.negotiation) {
        const candidateInfo = candidatePayload.find((c: any) => c.tradeId === rec.tradeId)
        if (candidateInfo) {
          const ni = candidateInfo.negotiationInput
          const userAllowedIds = new Set<string>([
            ...ni.allowedAssets.userAssetsAllowed.map((a: { id: string }) => a.id),
            ...ni.allowedAssets.userPicksAllowed.map((p: { id: string }) => p.id),
          ])
          const partnerAllowedIds = new Set<string>([
            ...ni.allowedAssets.partnerAssetsAllowed.map((a: { id: string }) => a.id),
            ...ni.allowedAssets.partnerPicksAllowed.map((p: { id: string }) => p.id),
          ])
          const redLineIds = new Set<string>(ni.allowedAssets.redLineIds || [])
          const userLabelToId = buildLabelToIdMap([
            ...ni.allowedAssets.userAssetsAllowed,
            ...ni.allowedAssets.userPicksAllowed,
          ])
          const partnerLabelToId = buildLabelToIdMap([
            ...ni.allowedAssets.partnerAssetsAllowed,
            ...ni.allowedAssets.partnerPicksAllowed,
          ])
          const safeNegotiation = clampNegotiationToAllowed({
            negotiation: rec.negotiation,
            allowed: {
              userAllowedIds,
              partnerAllowedIds,
              userFaabRemaining: ni.allowedAssets.userFaabRemaining,
              redLineIds,
              userLabelToId,
              partnerLabelToId,
            },
          })
          rec.negotiation = safeNegotiation ?? { dmMessages: [], counters: [], sweeteners: [], redLines: [] }
        }
      }
      return rec
    })

    const pricedPlayersForIndex = Object.values(pricedAssets).flat().filter(a => !a.isPick).map(a => ({
      id: a.assetId,
      name: a.name,
      position: a.position as Position | undefined,
      value: a.value,
      tier: a.tier,
    }))
    const pricedPicksForIndex = Object.values(pricedAssets).flat().filter(a => a.isPick).map(a => ({
      id: a.assetId,
      label: a.name,
      value: a.value,
      tier: a.tier,
      season: a.pickYear ?? new Date().getFullYear(),
      round: a.pickRound ?? 1,
    }))
    const assetIndex = buildAssetIndex({
      pricedPlayers: pricedPlayersForIndex,
      pricedPicks: pricedPicksForIndex,
      rosters: sleeperRosters,
      picks: (sleeperTradedPicks as any[]) || [],
    })

    return NextResponse.json({
      success: true,
      recommendations,
      opportunities: generatorOutput.opportunities,
      overallStrategy: parsed?.overallStrategy || '',
      objectiveNotes: parsed?.objectiveNotes || '',
      candidates: generatorOutput.candidates,
      assetIndex,
      meta: {
        partnersEvaluated: generatorOutput.partnersEvaluated,
        rawCandidatesGenerated: generatorOutput.rawCandidatesGenerated,
        prunedTo: generatorOutput.prunedTo,
        aiEnhanced: true,
        hasOpportunities: generatorOutput.opportunities.length > 0,
        intelligenceAudit: intelAudit,
      },
      rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
    })
  } catch (error) {
    console.error('Trade Finder error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request format', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to find trades' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/trade-finder", tool: "TradeFinder" })(async () => {
  return NextResponse.json({
    message: 'AllFantasy Trade Finder API v1 — Candidate Generator + AI Ranking',
    usage: {
      method: 'POST',
      body: {
        league_id: 'string (Sleeper league ID)',
        user_roster_id: 'number (optional — your roster ID in the league)',
        sleeper_user_id: 'string (optional — your Sleeper user ID, used to auto-resolve roster)',
        objective: 'WIN_NOW | REBUILD | BALANCED (default: BALANCED)',
        mode: 'FAST | DEEP (default: FAST)',
        preset: 'NONE | TARGET_POSITION | ACQUIRE_PICKS | CONSOLIDATE (default: NONE)',
        target_position: 'QB | RB | WR | TE (required when preset is TARGET_POSITION)',
      },
    },
  })
})
