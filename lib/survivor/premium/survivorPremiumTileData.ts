import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { resolveAfPlanFromEntitlement } from '@/lib/tournament/resolve-af-plan-from-subscription'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { isCouncilReadComplete, toPublicRevealSteps } from '@/lib/survivor/survivorRevealGate'
import { unreadEliminations, WATCH_OUT_STATES } from '@/lib/survivor/spectator/watchModel'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { SURVIVOR_PREMIUM_COMMAND_TILES, resolveSurvivorPremiumTileAccess, type SurvivorPremiumTileAccess } from '@/lib/survivor/survivor-premium-access'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import {
  SOCIAL_PULSE_WINDOW_DAYS,
  buildChallengeOutlookTile,
  buildExileStatusTile,
  buildJuryProjectionTile,
  buildSocialPulseTile,
  buildThreatMapTile,
  type PremiumCastRow,
  type PremiumReadCouncil,
  type SurvivorPremiumTilePayload,
} from './survivorPremiumTiles'
import { buildFairnessRadarTile, buildMinigamePlannerTile, buildRiskAlertsTile } from './survivorHostTiles'
import { WEEKLY_CALL_TYPE } from '@/lib/survivor/survivorWeeklyCall'

/**
 * Loads one premium tile for one viewer. The plan is resolved HERE from the viewer's entitlement,
 * and the access decision comes from `resolveSurvivorPremiumTileAccess` before any league data is
 * read, so a locked tile costs nothing and returns nothing. Every query selects public columns:
 * no votes relation, no voter, no idol, no chat content.
 */
export type SurvivorPremiumTileResult =
  | { ok: true; payload: SurvivorPremiumTilePayload }
  | { ok: false; status: 403 | 404; access?: Exclude<SurvivorPremiumTileAccess, { ok: true }>; error: string }

async function resolveViewerPlan(leagueId: string, userId: string, email: string | null): Promise<{ plan: AfPlanId | null; isCommissioner: boolean }> {
  const [role, entitlement] = await Promise.all([
    getLeagueRole(leagueId, userId),
    new EntitlementResolver().resolveSnapshot(userId, email),
  ])
  return { plan: resolveAfPlanFromEntitlement(entitlement.plans, entitlement.status), isCommissioner: role === 'commissioner' || role === 'co_commissioner' }
}

export type SurvivorPremiumIndex = {
  plan: AfPlanId | null
  tiles: Array<{ tileId: string; access: SurvivorPremiumTileAccess }>
}

/** Every tile's access decision for this viewer, so the page draws the locks the server enforces. */
export async function loadSurvivorPremiumIndex(input: { leagueId: string; userId: string; email: string | null }): Promise<SurvivorPremiumIndex | null> {
  const access = await resolveSurvivorAccessContext(input.leagueId, input.userId)
  if (!access?.isLeagueMember) return null
  const viewer = await resolveViewerPlan(input.leagueId, input.userId, input.email)
  return {
    plan: viewer.plan,
    tiles: SURVIVOR_PREMIUM_COMMAND_TILES.map(tile => ({ tileId: tile.tileId, access: resolveSurvivorPremiumTileAccess({ tileId: tile.tileId, ...viewer }) })),
  }
}

export async function loadSurvivorPremiumTile(input: {
  leagueId: string
  userId: string
  email: string | null
  tileId: string
  now?: Date
}): Promise<SurvivorPremiumTileResult> {
  const { leagueId, userId } = input
  const now = input.now ?? new Date()
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return { ok: false, status: 404, error: 'Not found' }
  const viewerPlan = await resolveViewerPlan(leagueId, userId, input.email)
  const decision = resolveSurvivorPremiumTileAccess({ tileId: input.tileId, ...viewerPlan })
  if (!decision.ok) {
    const error = decision.reason === 'plan_required' ? 'Upgrade to open this tile.'
      : decision.reason === 'commissioner_only' ? 'Only the commissioner can open this tile.'
        : decision.reason === 'coming_next' ? 'This tile is not open yet.' : 'Unknown tile.'
    return { ok: false, status: decision.reason === 'unknown_tile' ? 404 : 403, access: decision, error }
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorRevealMode: true } })
  if (!league) return { ok: false, status: 404, error: 'Not found' }
  const settings = access.settings
  const week = await resolveSurvivorCurrentWeek(leagueId, null)

  const [game, tribes, players, councils] = await Promise.all([
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { mergeTriggeredAt: true } }),
    prisma.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true, name: true, isMerged: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true, tribeId: true, playerState: true, isJuryMember: true } }),
    prisma.survivorTribalCouncil.findMany({
      where: { leagueId },
      // Deliberately no votes relation and no voter columns.
      select: {
        id: true, week: true, councilNumber: true, status: true, closedAt: true, voteDeadlineAt: true, attendingTribeId: true,
        eliminatedUserId: true, eliminatedName: true, isTie: true, tiePhase: true,
        isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true,
      },
    }),
  ])
  const pendingOut = unreadEliminations(councils, league.survivorRevealMode, now)
  const cast: PremiumCastRow[] = players.map(p => ({
    userId: p.userId,
    displayName: p.displayName,
    tribeId: p.tribeId,
    inGame: !WATCH_OUT_STATES.includes(p.playerState) || pendingOut.has(p.userId),
    isJuror: p.isJuryMember,
  }))
  const reads: PremiumReadCouncil[] = councils
    .filter(c => isCouncilReadComplete(c, league.survivorRevealMode, now))
    .map(c => ({
      week: c.week,
      councilNumber: c.councilNumber,
      votedNames: toPublicRevealSteps(c.revealSequence).filter(step => step.status === 'counts' && step.targetName).map(step => step.targetName as string),
    }))
  const merged = Boolean(game?.mergeTriggeredAt) || tribes.some(t => t.isMerged)
  const tribeNames = Object.fromEntries(tribes.map(t => [t.id, stripLeadingTribeIcon(t.name) || t.name]))
  const viewer = players.find(p => p.userId === userId) ?? null
  const viewerInGame = Boolean(viewer && cast.find(c => c.userId === userId)?.inGame)
  const scores = () => prisma.survivorWeeklyScore.findMany({
    where: { leagueId, isFinalized: true },
    select: { userId: true, finalScore: true, wonIndividualImmunity: true, wonTribeImmunity: true },
  })

  switch (input.tileId) {
    case 'threat_map':
      return { ok: true, payload: { tileId: 'threat_map', data: buildThreatMapTile({ viewerUserId: userId, viewerTribeId: viewerInGame ? viewer?.tribeId ?? null : null, merged, tribeNames, cast, scores: await scores(), reads }) } }
    case 'jury_projection':
      return { ok: true, payload: { tileId: 'jury_projection', data: buildJuryProjectionTile({ viewerUserId: userId, finalistCount: readSurvivorFullSeasonPlan(league.settings)?.finalistCount ?? 3, cast, scores: await scores(), reads }) } }
    case 'social_pulse': {
      // Only a huddle the viewer can already read: their tribe's, or the merged camp after the merge.
      const channel = access.canAccessTribeChat && viewerInGame
        ? await prisma.survivorChatChannel.findFirst({
          where: merged
            ? { leagueId, channelType: 'merge', isArchived: false, memberUserIds: { has: userId } }
            : { leagueId, channelType: 'tribe', tribeId: viewer?.tribeId ?? '__none__', isArchived: false, memberUserIds: { has: userId } },
          select: { id: true, name: true, memberUserIds: true },
        })
        : null
      const inChannel = new Set(channel?.memberUserIds ?? [])
      const members = cast.filter(c => c.inGame && inChannel.has(c.userId)).map(c => ({ userId: c.userId, displayName: c.displayName }))
      const messages = channel
        ? await prisma.survivorChatMessage.findMany({
          where: { channelId: channel.id, isDeleted: false, isSystemMessage: false, senderIsHost: false, createdAt: { gte: new Date(now.getTime() - SOCIAL_PULSE_WINDOW_DAYS * 86_400_000) } },
          select: { senderUserId: true, createdAt: true },
        })
        : []
      return { ok: true, payload: { tileId: 'social_pulse', data: buildSocialPulseTile({ viewerUserId: userId, channelName: channel ? stripLeadingTribeIcon(channel.name) || channel.name : null, members, messages }) } }
    }
    case 'challenge_outlook': {
      const challenges = week > 0
        ? await prisma.survivorChallenge.findMany({
          where: { leagueId, week, status: { not: 'cancelled' } },
          select: { id: true, title: true, challengeType: true, status: true, scope: true, locksAt: true, closesAt: true, rewardType: true, rewardAmount: true },
        })
        : []
      const submitted = challenges.length
        ? await prisma.survivorChallengeSubmission.findMany({
          where: { challengeId: { in: challenges.map(c => c.id) }, OR: [{ userId }, ...(access.rosterId ? [{ rosterId: access.rosterId }] : [])] },
          select: { challengeId: true },
        })
        : []
      return { ok: true, payload: { tileId: 'challenge_outlook', data: buildChallengeOutlookTile({ week, now, challenges, submittedChallengeIds: new Set(submitted.map(s => s.challengeId)) }) } }
    }
    case 'exile_status': {
      const onExile = viewer?.playerState === 'exile' && !pendingOut.has(userId)
      const own = onExile ? await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { tokenBalance: true } }) : null
      return {
        ok: true,
        payload: {
          tileId: 'exile_status',
          data: buildExileStatusTile({
            enabled: settings.exileIslandEnabled && settings.eliminationOutcome === 'exile_island',
            returnWeek: settings.exileReturnWeek,
            tokensNeeded: settings.exileReturnTokens,
            currentWeek: week,
            exileCount: players.filter(p => p.playerState === 'exile' && !pendingOut.has(p.userId)).length,
            viewer: { onExile, tokens: own?.tokenBalance ?? 0 },
          }),
        },
      }
    }
    // ── Commissioner lens: access already required a commissioner on AF Commissioner. ──
    case 'minigame_planner': {
      const plan = readSurvivorFullSeasonPlan(league.settings)
      const [config, challenges] = await Promise.all([
        prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { challengesSystemRun: true } }),
        prisma.survivorChallenge.findMany({
          where: { leagueId, status: { not: 'cancelled' } },
          select: { id: true, week: true, title: true, challengeType: true, scope: true, status: true, locksAt: true, closesAt: true, winnerTribeId: true, winnerUserIds: true, _count: { select: { submissions: true } } },
        }),
      ])
      const calls = challenges.filter(c => c.challengeType === WEEKLY_CALL_TYPE)
      return {
        ok: true,
        payload: {
          tileId: 'minigame_planner',
          data: buildMinigamePlannerTile({
            currentWeek: week,
            systemRun: config?.challengesSystemRun !== false,
            seasonWeeks: plan ? Array.from({ length: plan.endWeek - plan.startWeek + 1 }, (_, i) => plan.startWeek + i) : [],
            now,
            tribeNames: Object.fromEntries((await prisma.survivorTribe.findMany({ where: { leagueId }, select: { id: true, name: true } })).map(t => [t.id, stripLeadingTribeIcon(t.name) || t.name])),
            playerNames: Object.fromEntries(players.map(p => [p.userId, p.displayName])),
            challenges: challenges.filter(c => c.challengeType !== WEEKLY_CALL_TYPE),
            weeklyCalls: calls.map(c => ({ week: c.week, answers: c._count.submissions })),
          }),
        },
      }
    }
    case 'risk_alerts': {
      const blind = access.isParticipatingCommissioner
      const activeCast = cast.filter(c => c.inGame).map(c => ({ userId: c.userId, displayName: c.displayName }))
      const [flags, lastMessages, autoCast] = await Promise.all([
        prisma.integrityFlag.findMany({
          where: { leagueId, status: 'open' },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { flagType: true, severity: true, summary: true, affectedTeamNames: true, createdAt: true },
        }),
        // When each manager last spoke anywhere on the island. Never what they said.
        prisma.survivorChatMessage.groupBy({
          by: ['senderUserId'],
          where: { leagueId, isDeleted: false, isSystemMessage: false, senderIsHost: false, senderUserId: { in: activeCast.map(c => c.userId) } },
          _max: { createdAt: true },
        }),
        blind
          ? Promise.resolve([] as Array<{ targetUserId: string | null }>)
          : prisma.survivorAuditEntry.findMany({ where: { leagueId, action: 'non_voter_auto_cast' }, select: { targetUserId: true } }),
      ])
      const autoCastCount = new Map<string, number>()
      for (const row of autoCast) if (row.targetUserId) autoCastCount.set(row.targetUserId, (autoCastCount.get(row.targetUserId) ?? 0) + 1)
      return {
        ok: true,
        payload: {
          tileId: 'risk_alerts',
          data: buildRiskAlertsTile({
            now,
            blind,
            flags,
            activeCast,
            lastMessageAt: new Map(lastMessages.flatMap(row => (row._max.createdAt ? [[row.senderUserId, row._max.createdAt] as const] : []))),
            autoCastCount,
          }),
        },
      }
    }
    case 'host_fairness_radar': {
      // Counts only. Late ballots are counted at councils already read out to everyone.
      const completeIds = councils.filter(c => isCouncilReadComplete(c, league.survivorRevealMode, now)).map(c => c.id)
      const [autoCastBallots, lateBallots, scoreCorrections, actions] = await Promise.all([
        prisma.survivorAuditEntry.count({ where: { leagueId, action: 'non_voter_auto_cast' } }),
        completeIds.length ? prisma.survivorVote.count({ where: { councilId: { in: completeIds }, isLateVote: true } }) : Promise.resolve(0),
        prisma.survivorWeeklyScore.count({ where: { leagueId, correctionApplied: true } }),
        prisma.survivorCommissionerAction.findMany({
          where: { leagueId },
          orderBy: { executedAt: 'desc' },
          take: 200,
          select: { week: true, actionType: true, description: true, commissionerId: true, executedAt: true },
        }),
      ])
      return {
        ok: true,
        payload: {
          tileId: 'host_fairness_radar',
          data: buildFairnessRadarTile({
            councils,
            tieDecisions: actions.filter(a => a.actionType === 'exact_tie_commissioner_decision').length,
            autoCastBallots,
            lateBallots,
            scoreCorrections,
            actions,
          }),
        },
      }
    }
    default:
      return { ok: false, status: 404, error: 'Unknown tile.' }
  }
}
