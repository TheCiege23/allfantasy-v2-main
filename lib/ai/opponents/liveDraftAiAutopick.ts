/**
 * When timer expires: prefer AI opponent archetype pick over generic BPA (same submitPick path).
 */

import { prisma } from "@/lib/prisma"
import { submitPick } from "@/lib/live-draft-engine/PickSubmissionService"
import {
  loadAutopickDraftContextForOnClock,
  type BestAvailableAutopickResolved,
} from "@/lib/live-draft-engine/autopickBestAvailableSubmit"
import { decideDraftPickWithScores } from "@/lib/ai/opponents/draft/aiOpponentDraft"
import { getAiOpponentsSettings } from "@/lib/ai/opponents/leagueSettings"
import { getAssignmentForTeam, logBotAction, profileFromDbRow } from "@/lib/ai/opponents/db"
import { resolveLeagueTeamIdFromDraftRosterId } from "@/lib/ai/opponents/draftRosterMapping"
import type { DraftDecisionContext, DraftFormatHint, DraftPlayerOption, BotProfile } from "@/lib/ai/opponents/types"
import { createLeagueFeedEvent } from "@/lib/league-feed/createLeagueFeedEvent"
import { getLeagueFeedSettings } from "@/lib/league-feed/leagueFeedSettings"
import { generateFeedFlavorLine } from "@/lib/ai/opponents/botVoiceTemplates"
import { getPersonalityForArchetype } from "@/lib/ai/opponents/botPersonality"
import { recentDuplicateFlavor, recordBotMessageLine, shouldThrottleFlavor } from "@/lib/league-feed/aiMessageHistory"
import { getStrategy, getAdaptedTendencies } from "@/lib/draft-strategies/strategyDefinitions"
import { logStrategyPick } from "@/lib/draft-strategies/strategyTracker"
import type { StrategicTendencies } from "@/lib/ai/opponents/types"
import {
  parseCommissionerAiManagers,
  getAssignmentForRoster,
  saveCommissionerAiManagers,
  isRosterAiControlled,
} from "@/lib/commissioner-ai-draft-manager/CommissionerAiDraftManagerService"
import {
  assignNpcDraftPersonality,
  mergeNpcPersonalityIntoBlob,
  mapArchetypeToNpcPersonality,
  buildNpcAiManagerDraftAuditPayload,
  type HistoricalPickLite,
} from "@/lib/live-draft-engine/npcDraftPersonality"
import type { NpcDraftPersonalityId } from "@/lib/live-draft-engine/npcDraftPersonalityTypes"
import { logAction } from "@/lib/orphan-ai-manager/OrphanAIManagerService"

function mapDraftType(dt: string): DraftFormatHint {
  const u = String(dt || "").toLowerCase()
  if (u === "snake") return "snake"
  if (u === "linear") return "linear"
  if (u.includes("auction")) return "unknown"
  return "unknown"
}

function stablePoolPlayerId(e: { playerName: string; position: string; team: string | null; playerId: string | null }): string {
  return e.playerId ?? `pool:${normalize(e.playerName)}|${String(e.position).toUpperCase()}|${normalize(e.team ?? "")}`
}

function poolToOptions(
  pool: Array<{ playerName: string; position: string; team: string | null; playerId: string | null; adp: number | null }>,
  leagueSport: string
): DraftPlayerOption[] {
  return pool.map((e) => ({
    playerId: stablePoolPlayerId(e),
    name: e.playerName,
    position: e.position,
    team: e.team,
    adp: e.adp,
    tier: null,
    sport: leagueSport,
  }))
}

function quickHashLeagueRoster(leagueId: string, rosterId: string): number {
  const s = `${leagueId}:${rosterId}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

async function loadHistoricalPickLitesForNpc(leagueId: string, rosterId: string): Promise<HistoricalPickLite[]> {
  const rows = await prisma.draftPick.findMany({
    where: { rosterId, session: { leagueId } },
    orderBy: { overall: "desc" },
    take: 80,
    select: {
      position: true,
      team: true,
      overall: true,
      assetType: true,
    },
  })
  return rows.map((r) => ({
    position: r.position,
    team: r.team ?? null,
    overallPick: r.overall,
    isRookie: String(r.assetType ?? "").toLowerCase().includes("rookie"),
    age: null,
    expectedAdpRank: null,
  }))
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function pickFromPoolById(
  pool: Array<{ playerName: string; position: string; team: string | null; playerId: string | null; byeWeek: number | null; adp: number | null }>,
  id: string
): (typeof pool)[0] | null {
  const direct = pool.find((p) => p.playerId && p.playerId === id)
  if (direct) return direct
  return pool.find((p) => stablePoolPlayerId(p) === id) ?? pool[0] ?? null
}

/**
 * Create a synthetic bot profile from a draft strategy for orphaned/AI teams.
 * Maps strategy tendencies to bot archetype tendencies.
 */
function createBotProfileFromStrategy(
  teamId: string,
  teamName: string,
  strategy: ReturnType<typeof getStrategy>,
  round: number,
  pickInRound: number,
  rosterCounts: Record<string, number>
): BotProfile {
  if (!strategy) {
    throw new Error('Strategy not found')
  }

  // Build adaptation context for the current draft state
  const adaptationCtx = {
    round,
    pickInRound,
    rosterCounts,
    elitePositionsRemaining: {},
    leaguePositionStatus: {},
  }

  // Get adapted tendencies based on current draft state
  const adaptedTendencies = getAdaptedTendencies(strategy, adaptationCtx)

  // Merge base and adapted tendencies
  const finalTendencies: StrategicTendencies = {
    winNowVsFuture: 0,
    riskTolerance: strategy.riskLevel === 'conservative' ? 0.3 : strategy.riskLevel === 'moderate' ? 0.6 : 0.9,
    tradeAggression: 0.5,
    waiverAggression: 0.5,
    rookieAppetite: adaptedTendencies.rookieAppetite ?? strategy.baseTendencies.rookieAppetite ?? 40,
    positionalPremiumBias: {},
    zeroRbWeight: adaptedTendencies.zeroRbWeight ?? strategy.baseTendencies.zeroRbWeight ?? 0,
    heroRbWeight: adaptedTendencies.heroRbWeight ?? strategy.baseTendencies.heroRbWeight ?? 0,
    qbEarlyWeight: adaptedTendencies.qbEarlyWeight ?? strategy.baseTendencies.qbEarlyWeight ?? 0,
    tePremiumWeight: adaptedTendencies.tePremiumWeight ?? strategy.baseTendencies.tePremiumWeight ?? 0,
    chaosReach: adaptedTendencies.chaosReach ?? strategy.baseTendencies.chaosReach ?? 0,
    devyWeight: adaptedTendencies.devyWeight ?? strategy.baseTendencies.devyWeight ?? 0,
    pickHoarding: 0.5,
    vetBuyerWeight: 0.5,
    floorVsUpside: adaptedTendencies.floorVsUpside ?? strategy.baseTendencies.floorVsUpside ?? 50,
    bluffTendency: 0,
  }

  const bot: BotProfile = {
    botId: `strategy-${strategy.id}`,
    displayName: teamName,
    avatarUrl: null,
    archetypeId: strategy.archetypeId as any, // Map strategy archetype to bot archetype
    description: strategy.description,
    tendencies: finalTendencies,
    activityLevel: 1.0,
  }

  return bot
}

export async function tryAiOpponentAutopickForExpiredTimer(
  leagueId: string,
  onClockRosterId: string
): Promise<{ ok: true; pick: BestAvailableAutopickResolved } | { ok: false }> {
  const leagueRow = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const leagueSettings = getAiOpponentsSettings(leagueRow?.settings)
  if (!leagueSettings.enabled) return { ok: false }

  const ctx = await loadAutopickDraftContextForOnClock(leagueId, onClockRosterId)
  if (!ctx) return { ok: false }

  if (leagueSettings.mockDraftsOnly && ctx.draftSession.sessionKind !== "mock") {
    return { ok: false }
  }

  const leagueTeamId = await resolveLeagueTeamIdFromDraftRosterId(leagueId, onClockRosterId)
  if (!leagueTeamId) return { ok: false }

  let bot: BotProfile | null = null
  let botProfileId: string | null = null
  let strategyId: string | null = null
  let usedStrategy = false

  // Try to get assignment (traditional AI opponent)
  const assign = await getAssignmentForTeam(leagueTeamId)
  if (assign && assign.leagueId === leagueId && !assign.paused) {
    bot = profileFromDbRow(assign.profile)
    botProfileId = assign.profile.botId
  }

  // Fallback: Check if this is an orphaned team with a draft strategy
  if (!bot) {
    const roster = await prisma.roster.findUnique({
      where: { id: onClockRosterId },
      select: { settings: true },
    })

    if (roster?.settings && typeof roster.settings === 'object') {
      const settings = roster.settings as Record<string, any>
      strategyId = settings.draftStrategy

      if (strategyId) {
        const strategy = getStrategy(strategyId)
        if (strategy) {
          // Build bot profile from strategy
          const leagueTeam = await prisma.leagueTeam.findUnique({
            where: { leagueId_externalId: { leagueId, externalId: onClockRosterId } },
            select: { ownerName: true, teamName: true },
          })
          const teamName = leagueTeam?.ownerName || leagueTeam?.teamName || 'AI Team'

          bot = createBotProfileFromStrategy(
            leagueTeamId,
            teamName,
            strategy,
            ctx.current.round,
            ctx.current.slot,
            {} // Will be populated below
          )
          botProfileId = `strategy-${strategyId}`
          usedStrategy = true
        }
      }
    }
  }

  if (!bot) return { ok: false }

  const rosterCounts: Record<string, number> = {}
  for (const p of ctx.draftSession.picks) {
    if (p.rosterId !== onClockRosterId) continue
    const pos = String(p.position || "FL").toUpperCase()
    const key = pos.includes("RB") ? "RB" : pos.includes("WR") ? "WR" : pos.includes("TE") ? "TE" : pos.includes("QB") ? "QB" : "FL"
    rosterCounts[key] = (rosterCounts[key] ?? 0) + 1
  }

  // Rebuild bot profile for strategies with correct rosterCounts
  if (usedStrategy && strategyId) {
    const strategy = getStrategy(strategyId)
    if (strategy) {
      const leagueTeam = await prisma.leagueTeam.findUnique({
        where: { id: leagueTeamId },
        select: { ownerName: true, teamName: true },
      })
      const teamName = leagueTeam?.ownerName || leagueTeam?.teamName || 'AI Team'
      bot = createBotProfileFromStrategy(
        leagueTeamId,
        teamName,
        strategy,
        ctx.current.round,
        ctx.current.slot,
        rosterCounts
      )
    }
  }

  const dsAiRow = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { commissionerAiManagers: true },
  })
  let workingBlob = parseCommissionerAiManagers(dsAiRow?.commissionerAiManagers)
  const commissionerAssign = getAssignmentForRoster(workingBlob, onClockRosterId)
  const hadStoredNpc = Boolean(commissionerAssign?.npcDraftPersonality)

  let npcPersonality: NpcDraftPersonalityId | null = commissionerAssign?.npcDraftPersonality ?? null
  let npcFavorite = commissionerAssign?.npcFavoriteTeamAbbr ?? null

  if (commissionerAssign && !hadStoredNpc) {
    const hist = await loadHistoricalPickLitesForNpc(leagueId, onClockRosterId)
    const roll = assignNpcDraftPersonality({
      existingPersonality: null,
      historicalPicks: hist,
      treatAsFreshLeague: hist.length === 0,
      randomSeed: quickHashLeagueRoster(leagueId, onClockRosterId),
    })
    npcPersonality = roll.personality
    npcFavorite = roll.favoriteTeamAbbr ?? npcFavorite
    workingBlob = mergeNpcPersonalityIntoBlob(workingBlob, onClockRosterId, {
      npcDraftPersonality: npcPersonality,
      npcFavoriteTeamAbbr: npcFavorite,
    })
    await saveCommissionerAiManagers(leagueId, workingBlob)
  } else if (!commissionerAssign) {
    npcPersonality = mapArchetypeToNpcPersonality(bot.archetypeId)
  }

  const rosteredSkillTeams: string[] = []
  for (const p of ctx.draftSession.picks) {
    if (p.rosterId !== onClockRosterId) continue
    const pos = String(p.position || "").toUpperCase()
    if (
      (pos.includes("QB") || pos.includes("RB") || pos.includes("WR") || pos.includes("TE")) &&
      p.team
    ) {
      rosteredSkillTeams.push(String(p.team).trim().toUpperCase())
    }
  }

  const sportUpper = String(ctx.sport || "NFL").toUpperCase()
  const available = poolToOptions(ctx.fallbackPool, sportUpper)
  const settingsJson = (leagueRow?.settings as Record<string, unknown>) ?? {}
  const isSuperflex =
    settingsJson.is_superflex === true ||
    settingsJson.superflex === true ||
    String(settingsJson.roster_format_type ?? "")
      .toLowerCase()
      .includes("superflex")

  const decisionCtx: DraftDecisionContext = {
    leagueId,
    teamId: leagueTeamId,
    bot,
    format: mapDraftType(ctx.draftSession.draftType),
    scoring: null,
    isSuperflex,
    isTePremium: false,
    isDynasty: ctx.isDynasty,
    isDevy: false,
    round: ctx.current.round,
    pickInRound: ctx.current.slot,
    overallPick: ctx.overallPick,
    rosterCounts,
    queue: [],
    available,
    avoidPlayerIds: [],
    npcDraftPersonality: npcPersonality ?? undefined,
    npcFavoriteTeamAbbr: npcFavorite ?? undefined,
    leagueSport: sportUpper,
    rosteredSkillTeams,
  }

  const t0 = Date.now()
  let decision
  let candidateScores: Array<{ playerId: string; score: number }> = []
  try {
    const pack = decideDraftPickWithScores(decisionCtx)
    decision = pack.decision
    candidateScores = pack.candidateScores
  } catch {
    return { ok: false }
  }

  const row = pickFromPoolById(ctx.fallbackPool, decision.playerId)
  if (!row) return { ok: false }

  const pick: BestAvailableAutopickResolved = {
    playerName: row.playerName,
    position: row.position,
    team: row.team,
    playerId: row.playerId,
    byeWeek: row.byeWeek,
    reason: `AI opponent: ${decision.reason}`,
    strategy: "bpa",
  }

  const result = await submitPick({
    leagueId,
    playerName: pick.playerName.trim(),
    position: pick.position.trim(),
    team: pick.team ?? null,
    playerId: pick.playerId ?? null,
    byeWeek: pick.byeWeek ?? null,
    rosterId: onClockRosterId,
    source: "auto",
  })

  if (!result.success) return { ok: false }

  try {
    if (isRosterAiControlled(workingBlob, onClockRosterId) || npcPersonality) {
      await logAction({
        leagueId,
        rosterId: onClockRosterId,
        action: "draft_pick",
        payload: buildNpcAiManagerDraftAuditPayload({
          personality: npcPersonality,
          chosenPlayerId: decision.playerId,
          chosenPlayerName: pick.playerName,
          position: pick.position,
          reason: decision.reason,
          candidateScores,
          leagueSport: sportUpper,
        }),
        reason: decision.reason,
        triggeredBy: null,
      })
    }
  } catch {
    // audit best-effort
  }

  // Log bot action (assignment case)
  if (botProfileId && botProfileId.startsWith('strategy-') === false) {
    await logBotAction({
      leagueId,
      leagueTeamId,
      botProfileId,
      actionType: "draft_pick_autopick",
      payload: decisionCtx as object,
      result: { ...decision } as object,
      durationMs: Date.now() - t0,
    })
  }

  // Log strategy pick if using strategy
  if (usedStrategy && strategyId) {
    const strategy = getStrategy(strategyId)
    if (strategy) {
      logStrategyPick(leagueId, leagueTeamId, {
        overall: ctx.overallPick,
        round: ctx.current.round,
        slot: ctx.current.slot,
        playerName: pick.playerName,
        position: pick.position,
        playerId: pick.playerId ?? undefined,
        source: 'strategy-autopick',
        reasonForPick: decision.reason,
      })
    }
  }

  try {
    const teamRow = await prisma.leagueTeam.findUnique({
      where: { id: leagueTeamId },
      select: { teamName: true },
    })
    const teamName = teamRow?.teamName?.trim() || bot.displayName
    const personality = getPersonalityForArchetype(bot.archetypeId)
    const baseMsg = `${teamName} drafted ${pick.playerName} (${pick.position}) — R${ctx.current.round} P${ctx.current.slot}`
    const feed = getLeagueFeedSettings(leagueRow?.settings)
    let flavorLine: string | null = null
    if (feed.enabled && feed.aiFlavorEnabled && feed.reactions?.draft !== false) {
      const gen = generateFeedFlavorLine({
        personality,
        kind: "auto_pick_made",
        teamName,
        playerName: pick.playerName,
        position: pick.position,
        round: ctx.current.round,
        pick: ctx.current.slot,
        salt: `${ctx.overallPick}|${bot.botId}`,
      })
      const dup = await recentDuplicateFlavor(leagueId, gen.contentHash)
      let throttle = false
      if (feed.verbosity !== "high") {
        throttle = await shouldThrottleFlavor(leagueId, bot.botId)
      }
      let allow = !dup && !throttle
      if (feed.verbosity === "low") {
        allow = allow && ctx.overallPick % 3 === 0
      }
      if (allow) {
        flavorLine = gen.flavor
        await recordBotMessageLine({
          leagueId,
          botId: bot.botId,
          eventType: "auto_pick_made",
          contentHash: gen.contentHash,
          templateKey: gen.templateKey,
        })
      }
    }

    await createLeagueFeedEvent({
      leagueId,
      eventType: "auto_pick",
      message: baseMsg,
      actorType: "ai",
      actorId: bot.botId,
      actorName: bot.displayName,
      actorAvatar: bot.avatarUrl,
      teamId: leagueTeamId,
      teamName,
      flavorLine,
      category: "draft",
      importance: "normal",
      botArchetypeId: bot.archetypeId,
      botArchetypeLabel: personality.label,
      details: {
        overallPick: ctx.overallPick,
        round: ctx.current.round,
        pickInRound: ctx.current.slot,
        playerId: pick.playerId,
      },
    })
  } catch {
    // Feed is best-effort; never fail the pick path.
  }

  return { ok: true, pick }
}
