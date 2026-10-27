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
        week: true, councilNumber: true, status: true, closedAt: true, voteDeadlineAt: true, attendingTribeId: true,
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
    default:
      return { ok: false, status: 404, error: 'Unknown tile.' }
  }
}
