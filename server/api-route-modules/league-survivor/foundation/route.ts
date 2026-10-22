import { setCouncilPaused } from '@/lib/survivor/survivorCouncilPause'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { buildSurvivorStateForUser } from '@/lib/survivor/survivorStateService'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import {
  buildSurvivorLeagueColumnPatch,
  buildSurvivorSettingsSnapshotPatch,
  normalizeSurvivorFoundationSettings,
} from '@/lib/survivor/normalizeSurvivorSettings'
import { upsertSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import {
  initializeSurvivorPhase2,
  getSurvivorPhase2Status,
  resetSurvivorPhase2State,
} from '@/lib/survivor/survivorPhase2Init'
import { assignSurvivorTribes } from '@/lib/survivor/survivorTribeProvisioning'
import { provisionSurvivorChats } from '@/lib/survivor/survivorTribeChatProvisioning'
import { seedSurvivorIdols } from '@/lib/survivor/survivorIdolProvisioning'
import { postSurvivorIntroAnnouncement } from '@/lib/survivor/survivorAnnouncementService'
import type { SurvivorTribeAssignmentMode } from '@/lib/survivor/normalizeSurvivorSettings'
import { openTribalCouncil, closeVoteWindow, cancelCouncil, loadCouncilContext, getLatestCouncil } from '@/lib/survivor/survivorCouncilService'
import { submitPrivateVoteCommand } from '@/lib/survivor/survivorPrivateVoteCommand'
import { playVoteShield, playExtraVote, playSkipTribal, playVoteSteal, getCouncilIdolPreview } from '@/lib/survivor/survivorIdolResolutionService'
import { tallyCouncil, revealCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { resolveElimination } from '@/lib/survivor/survivorEliminationService'
import { finishCouncilReadIfComplete } from '@/lib/survivor/survivorCouncilReadFinish'
import { sendPushToUser } from '@/lib/push-notifications'
import { getStealThreePreview, playStealThree } from '@/lib/survivor/survivorStealThree'
import { getNbaSurvivorGameOptions, saveNbaSurvivorGamePick } from '@/lib/survivor/survivorNbaWeeklyScoring'
import { createSurvivorChatMessage } from '@/lib/survivor/survivorChatBridge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { leagueId?: string; action?: string }
type RouteContext = { params: Promise<RouteParams> | RouteParams }
type JsonRecord = Record<string, unknown>

async function readParams(ctx: RouteContext): Promise<RouteParams> {
  return typeof (ctx.params as Promise<RouteParams>)?.then === 'function'
    ? await (ctx.params as Promise<RouteParams>)
    : (ctx.params as RouteParams)
}

async function requireUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function actionFromBody(body: JsonRecord, fallback: string | undefined): string {
  const raw = typeof body.action === 'string' ? body.action : fallback
  return String(raw ?? 'get-state').trim().toLowerCase()
}

function validateTribeSettings(input: JsonRecord) {
  const normalized = normalizeSurvivorFoundationSettings(input)
  const errors: string[] = []
  const warnings: string[] = []
  if (normalized.defaultTeamCount < normalized.minTeamCount || normalized.defaultTeamCount > normalized.maxTeamCount) {
    errors.push(`Cast size must stay between ${normalized.minTeamCount} and ${normalized.maxTeamCount}.`)
  }
  if (normalized.tribeCount !== 4) {
    warnings.push('Phase 1 canonical setup recommends four tribes.')
  }
  if (normalized.defaultTeamCount % normalized.tribeCount !== 0) {
    warnings.push('Cast size is not evenly divisible by tribe count; tribe assignment will need manual review.')
  }
  if (Math.ceil(normalized.defaultTeamCount / normalized.tribeCount) > 5) {
    warnings.push('More than five players per tribe is outside the Phase 1 default shell.')
  }
  return { ok: errors.length === 0, settings: normalized, errors, warnings }
}

async function readLeagueSettings(leagueId: string): Promise<JsonRecord | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league) return null
  return asRecord(league.settings)
}

async function updateFoundationSettings(leagueId: string, body: JsonRecord, userId: string) {
  const current = await readLeagueSettings(leagueId)
  if (!current) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  const incoming = asRecord(body.settings)
  const mergedInput = { ...current, ...incoming, ...body }
  const settings = normalizeSurvivorFoundationSettings(mergedInput)
  if (!settings.sitOutsEnabled || !settings.noConsecutiveSitOuts) {
    return NextResponse.json({ error: 'Survivor requires fair tribe sit-outs without consecutive weeks for the same manager.' }, { status: 409 })
  }
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (access?.isParticipant && access.isLeagueCommissioner && settings.commissionerParticipationMode !== 'participating_player') {
    return NextResponse.json({ error: 'A manager cannot switch into host visibility while participating in this season.' }, { status: 409 })
  }
  if (settings.commissionerParticipationMode === 'participating_player' && settings.tribeAssignmentMode === 'commissioner_manual') {
    return NextResponse.json({ error: 'A playing commissioner must use system-run tribe formation.' }, { status: 409 })
  }
  const previousSettings = normalizeSurvivorFoundationSettings(current)
  if (settings.defaultTeamCount !== previousSettings.defaultTeamCount) return NextResponse.json({ error: 'Choose league size during creation. Changing it here would leave draft seats and rosters inconsistent.' }, { status: 409 })
  if (settings.tribeCount !== previousSettings.tribeCount || JSON.stringify(settings.survivorTribeSlots) !== JSON.stringify(previousSettings.survivorTribeSlots)) return NextResponse.json({ error: 'Use Tribe identities and capacities to save tribe structure together.' }, { status: 409 })
  const exileChanged = settings.exileIslandEnabled !== previousSettings.exileIslandEnabled || settings.exileReturnWeek !== previousSettings.exileReturnWeek || settings.exileReturnTokens !== previousSettings.exileReturnTokens
  const mutableAfterDraft = new Set(['tribalCouncilDay', 'tribalCouncilTime', 'voteOpenOffset', 'voteCloseOffset', 'shareCardsEnabled', 'publicMomentPages'])
  const lockedRuleChanged = Object.keys(settings).some(key => !mutableAfterDraft.has(key) &&
    JSON.stringify(settings[key as keyof typeof settings]) !== JSON.stringify(previousSettings[key as keyof typeof previousSettings]))
  if (lockedRuleChanged && await prisma.draftSession.findFirst({ where: { leagueId, status: { in: ['in_progress', 'paused', 'completed'] } }, select: { id: true } })) {
    return NextResponse.json({ error: 'Season rules lock when the draft starts. Only the vote schedule can change during the season.' }, { status: 409 })
  }
  const settingsPatch = buildSurvivorSettingsSnapshotPatch(settings as unknown as JsonRecord)
  const columnPatch = buildSurvivorLeagueColumnPatch(settings)
  const savedPlan = readSurvivorFullSeasonPlan(current)
  let planPatch: JsonRecord = {}
  if (exileChanged && savedPlan) {
    if (settings.exileIslandEnabled && (settings.exileReturnWeek <= savedPlan.startWeek || settings.exileReturnWeek >= savedPlan.endWeek - 1)) return NextResponse.json({ error: 'Return week must follow the opening week and leave an elimination before the finale.' }, { status: 422 })
    const count = savedPlan.castSize - 3 + (settings.exileIslandEnabled ? 1 : 0)
    const available = savedPlan.endWeek - savedPlan.startWeek - 1
    if (count > available) return NextResponse.json({ error: 'This season has no room for an Exile return. Choose a later finale or smaller cast before drafting.' }, { status: 422 })
    const eliminationWeeks = Array.from({ length: count }, (_, i) => savedPlan.startWeek + Math.ceil((i + 1) * available / count))
    const { exileReturnWeek: _oldWeek, exileReturnSlots: _oldSlots, ...basePlan } = savedPlan
    planPatch = { survivor_full_season_plan: { ...basePlan, ...(settings.exileIslandEnabled ? { exileReturnWeek: settings.exileReturnWeek, exileReturnSlots: 1 } : {}), eliminationWeeks,
      noEliminationWeeks: Array.from({ length: savedPlan.endWeek - savedPlan.startWeek }, (_, i) => savedPlan.startWeek + i).filter(week => !eliminationWeeks.includes(week)) } }
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      /*
       * A Prisma Json column takes `InputJsonValue`, not `Record<string, unknown>` — `unknown`
       * admits values JSON cannot hold. Both halves ARE json here: `current` was read straight
       * back out of this column, and `settingsPatch` is a built snapshot. The cast asserts
       * something already true rather than papering over a shape mismatch.
       *
       * Plain cast, not the JSON round-trip used in writeAfProjectionSnapshots.ts — that one
       * exists for a nested bare `null`, which this object does not carry.
       */
      settings: { ...current, ...settingsPatch, ...planPatch } as Prisma.InputJsonValue,
      ...columnPatch,
    },
  })

  await upsertSurvivorConfig(leagueId, {
    tribeCount: settings.tribeCount,
    tribeSize: Math.max(1, Math.ceil(settings.defaultTeamCount / settings.tribeCount)),
    tribeFormation: settings.tribeAssignmentMode === 'commissioner_manual' ? 'commissioner' : 'random',
    mergeTrigger: settings.mergeTriggerType === 'active_player_count' ? 'player_count' : 'week',
    mergeWeek: settings.mergeWeek,
    mergePlayerCount: settings.mergeActivePlayerCount,
    selfVoteDisallowed: !settings.selfVotesAllowed,
    exileReturnEnabled: settings.exileIslandEnabled,
    exileReturnTokens: settings.exileReturnTokens,
    idolCount: settings.idolCount,
    tribalCouncilTimeUtc: settings.tribalCouncilTime,

  })

  return NextResponse.json({ ok: true, settings, noFakeGameplayState: true })
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userId = await requireUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await readParams(ctx)
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const result = await buildSurvivorStateForUser(leagueId, userId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.state)
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const userId = await requireUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = await readParams(ctx)
  const leagueId = params.leagueId
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const body = asRecord(await req.json().catch(() => ({})))
  const action = actionFromBody(body, params.action)
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!access.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (action === 'nba-game-options' || action === 'nba-game-pick') {
    if (!access.isUserActivePlayer || !access.rosterId) return NextResponse.json({ error: 'Only an active manager may choose a counting game.' }, { status: 403 })
    if (access.settings.nbaWeeklyScoringMode !== 'one_game_per_player') return NextResponse.json({ error: 'This league counts every NBA game.' }, { status: 409 })
    const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } })
    const plan = readSurvivorFullSeasonPlan(await readLeagueSettings(leagueId))
    const activeWeek = game?.currentWeek && game.currentWeek > 0 ? game.currentWeek : plan?.startWeek
    const week = Number(body.week ?? activeWeek)
    if (!Number.isInteger(week) || week < 1 || week > 52 || (plan && (week < plan.startWeek || week > plan.endWeek)) || (activeWeek && week !== activeWeek && week !== activeWeek + 1)) return NextResponse.json({ error: 'Choose the current or upcoming NBA fantasy week.' }, { status: 422 })
    if (action === 'nba-game-options') {
      const result = await getNbaSurvivorGameOptions({ leagueId, rosterId: access.rosterId, week })
      return NextResponse.json(result, { status: result.ok ? 200 : 422 })
    }
    const playerId = typeof body.playerId === 'string' ? body.playerId : ''
    const gameKey = typeof body.gameKey === 'string' ? body.gameKey : ''
    if (!playerId || !gameKey) return NextResponse.json({ error: 'Player and game are required.' }, { status: 422 })
    const result = await saveNbaSurvivorGamePick({ leagueId, rosterId: access.rosterId, userId, week, playerId, gameKey })
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  }

  if (action === 'get-state') {
    const result = await buildSurvivorStateForUser(leagueId, userId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.state)
  }

  if (action === 'privacy-check') {
    return NextResponse.json({
      ok: true,
      access: {
        role: access.role,
        isParticipant: access.isParticipant,
        isCommissionerParticipating: access.isCommissionerParticipating,
        isNonParticipatingCommissionerHost: access.isNonParticipatingCommissionerHost,
        decisions: access.decisions,
        warnings: access.privacyWarnings,
      },
      noFakeGameplayState: true,
    })
  }

  if (action === 'validate-tribe-settings' || action === 'assign-tribes-placeholder') {
    return NextResponse.json({
      ...validateTribeSettings({ ...access.settings, ...body }),
      action,
      assignmentStatus: 'not_started',
      noMutation: true,
      noFakeGameplayState: true,
    })
  }

  if (action === 'update-settings' || action === 'set-commissioner-participation-mode') {
    if (!access.decisions.canUpdateSettings) {
      return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
    }
    if (action === 'set-commissioner-participation-mode') {
      const mode =
        body.mode === 'participating_player' || body.commissionerParticipationMode === 'participating_player'
          ? 'participating_player'
          : 'non_participating_host'
      return updateFoundationSettings(leagueId, {
        settings: { ...access.settings, commissionerParticipationMode: mode },
      }, userId)
    }
    return updateFoundationSettings(leagueId, body, userId)
  }

  if (action === 'audit-log') {
    if (!access.decisions.canPerformAdminAction) {
      return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
    }
    const entries = await prisma.survivorAuditEntry.findMany({
      where: access.decisions.canSeeHiddenIdolAssignments
        ? { leagueId }
        : {
            leagueId,
            OR: [{ isVisibleToPublic: true }, { actorUserId: userId }, { targetUserId: userId }],
          },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        week: true,
        category: true,
        action: true,
        actorUserId: true,
        targetUserId: true,
        targetTribeId: true,
        relatedEntityId: true,
        relatedEntityType: true,
        data: true,
        isVisibleToPublic: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ ok: true, entries, noFakeGameplayState: true })
  }

  // ---- Phase 2: tribes, chats, idols, intro ----
  const PHASE2_ADMIN_ACTIONS = new Set([
    'initialize-survivor',
    'assign-tribes',
    'create-tribe-chats',
    'seed-idols',
    'post-intro',
    'reset-phase-2-test-state',
  ])
  if (PHASE2_ADMIN_ACTIONS.has(action) && !access.decisions.canPerformAdminAction) {
    return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
  }

  function parseTribeMode(): SurvivorTribeAssignmentMode | undefined {
    const raw = typeof body.mode === 'string' ? body.mode : undefined
    if (raw === 'random' || raw === 'commissioner_manual' || raw === 'draft_pattern') return raw
    return undefined
  }
  function parseManualMapping(): Record<string, number> | null {
    const m = asRecord(body.manualMapping)
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.floor(v)
    }
    return Object.keys(out).length > 0 ? out : null
  }
  function parseDraftOrder(): string[] | null {
    return Array.isArray(body.draftOrder) ? body.draftOrder.filter((x): x is string => typeof x === 'string') : null
  }
  const seedInput = typeof body.seed === 'number' && Number.isFinite(body.seed) ? Math.floor(body.seed) : null
  const allowReassign = body.allowReassign === true

  if (['seed-idols', 'assign-tribes', 'reset-phase-2-test-state'].includes(action) && !access.decisions.canPerformSensitiveHostAction) {
    return NextResponse.json({ error: 'The system manages secret assignments for participating commissioners.' }, { status: 403 })
  }
  if (action === 'initialize-survivor' && !access.decisions.canPerformSensitiveHostAction && (seedInput !== null || allowReassign || body.mode != null || body.manualMapping != null || body.draftOrder != null)) {
    return NextResponse.json({ error: 'Playing commissioners may retry system setup without overriding assignments.' }, { status: 403 })
  }

  if (action === 'initialize-survivor') {
    const result = await initializeSurvivorPhase2(leagueId, {
      actorUserId: userId,
      mode: parseTribeMode(),
      seed: seedInput,
      manualMapping: parseManualMapping(),
      draftOrder: parseDraftOrder(),
      allowReassign,
    })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true }, { status: result.ok ? 200 : 422 })
  }

  if (action === 'assign-tribes') {
    const result = await assignSurvivorTribes(leagueId, {
      actorUserId: userId,
      mode: parseTribeMode(),
      seed: seedInput,
      manualMapping: parseManualMapping(),
      draftOrder: parseDraftOrder(),
      allowReassign,
    })
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'create-tribe-chats') {
    const result = await provisionSurvivorChats(leagueId, { actorUserId: userId })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'seed-idols') {
    const result = await seedSurvivorIdols(leagueId, { actorUserId: userId, seed: seedInput, allowReseed: allowReassign })
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'post-intro') {
    const result = await postSurvivorIntroAnnouncement(leagueId, { actorUserId: userId })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'phase-2-status') {
    const status = await getSurvivorPhase2Status(leagueId)
    return NextResponse.json({ ok: true, action, status, noFakeGameplayState: true })
  }

  if (action === 'reset-phase-2-test-state') {
    if (process.env.NODE_ENV === 'production' && process.env.SURVIVOR_ALLOW_TEST_RESET !== 'true') {
      return NextResponse.json({ error: 'Reset is disabled in production' }, { status: 403 })
    }
    const result = await resetSurvivorPhase2State(leagueId, { actorUserId: userId })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  // ---- Phase 3: Tribal Council voting, idol resolution, reveal, elimination ----
  const PHASE3_ADMIN_ACTIONS = new Set([
    'open-tribal',
    'close-vote-window',
    'tally-votes',
    'reveal-votes',
    'resolve-elimination',
    'cancel-tribal',
    'council-control',
    'nudge-voter',
    'extend-votes-hour',
    'set-auto-reveal',
    'resolve-exact-tie',
    'pause-league',
    'resume-league',
  ])
  const PHASE3_PARTICIPANT_ACTIONS = new Set(['submit-vote', 'play-idol', 'play-extra-vote', 'play-skip-tribal', 'play-vote-steal', 'steal-three-preview', 'play-steal-three', 'idol-play-preview'])

  // Status is safe for playing commissioners; every mutation uses hostCanControl.
  if (PHASE3_ADMIN_ACTIONS.has(action) && (!access.decisions.canPerformAdminAction || (action !== 'council-control' && !access.decisions.canPerformSensitiveHostAction))) {
    return NextResponse.json({ error: 'Independent commissioner host access required' }, { status: 403 })
  }
  if (action === 'pause-league' || action === 'resume-league') {
    const result = await setCouncilPaused(leagueId, userId, action === 'pause-league')
    return NextResponse.json(result, { status: result.ok ? 200 : result.status })
  }
  if (PHASE3_ADMIN_ACTIONS.has(action) && !['council-control', 'set-auto-reveal'].includes(action)) {
    const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return NextResponse.json({ error: 'Resume the league before changing Council state' }, { status: 409 })
  }
  if (PHASE3_PARTICIPANT_ACTIONS.has(action) && !access.isParticipant) {
    return NextResponse.json({ error: 'Only an active player can take this action' }, { status: 403 })
  }

  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null

  if (action === 'set-auto-reveal') {
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 422 })
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
      const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      const current = asRecord(league?.settings)
      const settings = normalizeSurvivorFoundationSettings(current)
      const patch = buildSurvivorSettingsSnapshotPatch({ ...settings, autoReveal: body.enabled })
      await tx.league.update({ where: { id: leagueId }, data: { settings: { ...current, ...patch, autoReveal: body.enabled } as Prisma.InputJsonValue } })
      const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } })
      await tx.survivorCommissionerAction.create({ data: { leagueId, commissionerId: userId, week: game?.currentWeek, actionType: 'council_reveal_mode', description: body.enabled ? 'Automatic reveal enabled' : 'Manual reveal enabled' } })
    })
    return NextResponse.json({ ok: true, autoReveal: body.enabled })
  }

  if (action === 'council-control' || action === 'nudge-voter' || action === 'extend-votes-hour') {
    const activeContext = await loadCouncilContext(leagueId)
    const ctx = activeContext ?? (action === 'council-control' ? await loadCouncilContext(leagueId, (await getLatestCouncil(leagueId))?.id) : null)
    if (!ctx) return NextResponse.json({ error: 'No active council' }, { status: 404 })
    const councilId = ctx.council.id
    if (action === 'council-control') {
      const votes = await prisma.survivorVote.findMany({ where: { councilId }, select: { voterUserId: true, voterRosterId: true, doesNotCount: true } })
      const voted = new Set(votes.filter(v => !v.doesNotCount).map(v => v.voterUserId ?? ctx.rosterToUser[v.voterRosterId]))
      // Reconstruct attendance after elimination, without deriving it from secret idol effects.
      const attendees = await prisma.survivorPlayer.findMany({ where: { leagueId, ...(ctx.council.attendingTribeId ? { tribeId: ctx.council.attendingTribeId } : {}), OR: [{ playerState: 'active' }, { eliminatedWeek: { gte: ctx.council.week } }] }, select: { userId: true, displayName: true } })
      const voterIds = attendees.map(player => player.userId).filter(id => ctx.council.phase !== 'revote' || !ctx.council.tiePlayerIds.includes(id))
      const names = new Map(attendees.map(player => [player.userId, player.displayName]))
      const nudges = await prisma.survivorCommissionerAction.findMany({ where: { leagueId, actionType: 'council_vote_nudge', week: ctx.council.week, description: councilId }, select: { targetUserId: true } })
      const nudged = new Set(nudges.map(n => n.targetUserId))
      const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, weekScoringLockedAt: true, weekScoringFinalAt: true, immunePlayerId: true, immuneTribeId: true, tribalCompleteAt: true, pausedSnapshot: true } })
      const sealedCouncil = await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId }, select: { isRevealed: true, revealSequence: true, phase: true, tiePhase: true, tiePlayerIds: true, eliminatedUserId: true } })
      const [commissionerActions, councilActions] = await Promise.all([
        prisma.survivorCommissionerAction.findMany({ where: { leagueId, week: ctx.council.week, actionType: { in: ['council_vote_nudge', 'council_vote_extended', 'council_reveal_mode', 'pause_season', 'resume_season'] } }, orderBy: { executedAt: 'desc' }, take: 20, select: { id: true, actionType: true, description: true, executedAt: true } }),
        prisma.survivorAuditEntry.findMany({ where: { leagueId, week: ctx.council.week, action: { in: ['council_closed', 'votes_revealed', 'revote_opened', 'exact_tie_commissioner_decision', 'player_eliminated'] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, createdAt: true, relatedEntityId: true } }),
      ])
      const audit = [...commissionerActions.map(entry => ({ id: entry.id, actionType: entry.actionType, description: '', executedAt: entry.executedAt })), ...councilActions.map(entry => ({ id: entry.id, actionType: entry.action, description: '', executedAt: entry.createdAt }))].sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime()).slice(0, 20)
      const revoteWithNoBallots = sealedCouncil?.phase === 'revote' && (Boolean(sealedCouncil.eliminatedUserId) || sealedCouncil.tiePhase === 'commissioner_tiebreak_required')
      const isRevealed = Boolean(sealedCouncil?.isRevealed)
      const windowClosed = ['closed', 'tie_pending', 'voting_closed'].includes(ctx.council.status)
      const paused = game?.pausedSnapshot != null
      const deadlinePassed = !paused && ctx.council.voteDeadlineAt <= new Date()
      const readPrepared = (Array.isArray(sealedCouncil?.revealSequence) && sealedCouncil.revealSequence.length > 0) ||
        revoteWithNoBallots || (sealedCouncil?.tiePhase === 'system_score_fallback' && Boolean(sealedCouncil.eliminatedUserId))
      // Explicit operational allowlist: no ballot targets, raw audit data, or idol effects.
      return NextResponse.json({
        ok: true, councilId, week: ctx.council.week,
        status: ctx.council.status === 'tie_pending' && !isRevealed ? 'sealed' : ctx.council.status,
        canControl: access.decisions.canPerformSensitiveHostAction,
        lineupsLocked: Boolean(game?.weekScoringLockedAt || game?.weekScoringFinalAt),
        scoringFinal: Boolean(game?.weekScoringFinalAt),
        immunitySet: Boolean(game?.immunePlayerId || game?.immuneTribeId),
        afterReadComplete: isRevealed && councilActions.some(entry => entry.action === 'player_eliminated' && entry.relatedEntityId === councilId),
        idolsHidden: access.settings.hideIdolsFromCommissioner || !access.decisions.canSeeHiddenIdolAssignments,
        canReveal: !paused && windowClosed && !isRevealed && Boolean(readPrepared),
        isRevealed, paused, deadline: ctx.council.voteDeadlineAt.toISOString(), autoReveal: access.settings.autoReveal,
        exactTieCandidates: isRevealed && sealedCouncil?.tiePhase === 'commissioner_tiebreak_required'
          ? sealedCouncil.tiePlayerIds.map(candidateId => ({ userId: candidateId, name: names.get(candidateId) ?? 'Manager' })) : [],
        canResolveExactTie: access.decisions.canPerformSensitiveHostAction,
        voters: voterIds.map(voterUserId => ({
          userId: voterUserId, name: names.get(voterUserId) ?? 'Manager',
          status: voted.has(voterUserId) ? 'voted' : windowClosed || isRevealed || deadlinePassed ? 'missed' : 'not_yet',
          nudged: nudged.has(voterUserId),
        })),
        submittedCount: voterIds.filter(id => voted.has(id)).length,
        eligibleVoterCount: voterIds.length, audit, sealed: true,
      })
    }
    if (ctx.council.status !== 'voting_open') return NextResponse.json({ error: 'Voting is not open' }, { status: 409 })
    if (action === 'nudge-voter') {
      if (!targetUserId || !ctx.scopePlayers.some(player => player.userId === targetUserId && (ctx.council.phase !== 'revote' || !ctx.council.tiePlayerIds.includes(player.userId)))) return NextResponse.json({ error: 'Choose an eligible voter' }, { status: 422 })
      const outcome = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
        const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
        const current = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId, status: 'voting_open', voteDeadlineAt: { gt: new Date() } }, select: { id: true } })
        if (!current || game?.pausedSnapshot != null) return false
        const already = await tx.survivorCommissionerAction.findFirst({ where: { leagueId, actionType: 'council_vote_nudge', targetUserId, week: ctx.council.week, description: councilId } })
        if (already) return false
        const voted = await tx.survivorVote.findFirst({ where: { councilId, voterUserId: targetUserId, doesNotCount: false }, select: { id: true } })
        if (voted) return false
        await tx.survivorCommissionerAction.create({ data: { leagueId, commissionerId: userId, week: ctx.council.week, actionType: 'council_vote_nudge', targetUserId, description: councilId } })
        await tx.platformNotification.create({ data: { userId: targetUserId, type: 'survivor:vote_nudge', title: 'Your vote is still due', body: 'Message @Chimmy before the Council deadline.', severity: 'medium', productType: 'sports', meta: { leagueId, councilId, deepLinkPath: `/survivor/${leagueId}/tribal` } } })
        return true
      })
      if (outcome) await sendPushToUser(targetUserId, { title: 'Your vote is still due', body: 'Message @Chimmy before the Council deadline.', href: `/survivor/${leagueId}/tribal` }).catch(() => [])
      return NextResponse.json(outcome ? { ok: true, sent: true } : { ok: false, error: 'Reminder already sent or voting unavailable' }, { status: outcome ? 200 : 429 })
    }
    const deadline = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
      const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
      if (game?.pausedSnapshot != null) return null
      const latest = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId, status: 'voting_open' }, select: { voteDeadlineAt: true } })
      if (!latest) return null
      const next = new Date(latest.voteDeadlineAt.getTime() + 60 * 60 * 1000)
      await tx.survivorTribalCouncil.update({ where: { id: councilId }, data: { voteDeadlineAt: next, votingDeadline: next } })
      await tx.survivorGameState.updateMany({ where: { leagueId, activeCouncilId: councilId }, data: { tribalDeadline: next } })
      await tx.survivorCommissionerAction.create({ data: { leagueId, commissionerId: userId, week: ctx.council.week, actionType: 'council_vote_extended', description: `Council deadline extended by one hour.` } })
      return next
    })
    if (!deadline) return NextResponse.json({ error: 'Voting already closed' }, { status: 409 })
    await Promise.allSettled(ctx.scopePlayers.map(player => sendPushToUser(player.userId, { title: 'Council voting extended', body: 'You have one more hour to message @Chimmy.', href: `/survivor/${leagueId}/tribal` })))
    return NextResponse.json({ ok: true, deadline: deadline.toISOString() })
  }

  if (action === 'resolve-exact-tie') {
    const councilId = typeof body.councilId === 'string' ? body.councilId : ''
    const eliminatedUserId = typeof body.eliminatedUserId === 'string' ? body.eliminatedUserId : ''
    if (!councilId || !eliminatedUserId) return NextResponse.json({ error: 'Council and tied manager required' }, { status: 422 })
    const council = await prisma.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId, phase: 'revote', isRevealed: true, isTie: true, tiePhase: 'commissioner_tiebreak_required' } })
    if (!council || !council.tiePlayerIds.includes(eliminatedUserId)) return NextResponse.json({ error: 'No unresolved exact tie for that manager' }, { status: 409 })
    const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: eliminatedUserId } }, select: { displayName: true, redraftRosterId: true } })
    if (!player?.redraftRosterId) return NextResponse.json({ error: 'Manager roster unavailable' }, { status: 409 })
    const channel = await prisma.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (!channel) return NextResponse.json({ error: 'Restore league chat before resolving this tie' }, { status: 409 })
    const decided = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
      const current = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId, phase: 'revote', isRevealed: true, isTie: true, tiePhase: 'commissioner_tiebreak_required' }, select: { id: true } })
      if (!current) return false
      await tx.survivorTribalCouncil.update({ where: { id: councilId }, data: { eliminatedUserId, eliminatedRosterId: player.redraftRosterId, eliminatedName: player.displayName, isTie: false, tiePhase: 'commissioner_resolved', status: 'revealed' } })
      await createSurvivorChatMessage(tx, { data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement', content: `Torch Ceremony · Week ${council.week}\nThe revote and finalized season points were tied. The independent commissioner selected ${player.displayName}. The choice is in the public audit.` } })
      await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'tribal', action: 'exact_tie_commissioner_decision', actorUserId: userId, targetUserId: eliminatedUserId, relatedEntityId: councilId, relatedEntityType: 'council', data: { candidates: council.tiePlayerIds }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
      return true
    })
    if (!decided) return NextResponse.json({ error: 'Tie was already resolved' }, { status: 409 })
    const eliminated = await resolveElimination(leagueId, councilId, userId)
    return NextResponse.json({ ok: eliminated.ok, councilId, eliminatedUserId, elimination: eliminated }, { status: eliminated.ok ? 200 : eliminated.status })
  }

  if (action === 'tribal-status') {
    // Sanitized council view comes from the state sanitizer (privacy-aware).
    const result = await buildSurvivorStateForUser(leagueId, userId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, action, tribalCouncil: result.state.tribalCouncil, noFakeGameplayState: true })
  }

  if (action === 'open-tribal') {
    const result = await openTribalCouncil(leagueId, {
      attendingTribeId: typeof body.attendingTribeId === 'string' ? body.attendingTribeId : null,
      week: typeof body.week === 'number' ? body.week : undefined,
      votingOpensAt: typeof body.votingOpensAt === 'string' ? new Date(body.votingOpensAt) : null,
      voteDeadlineAt: typeof body.voteDeadlineAt === 'string' ? new Date(body.voteDeadlineAt) : null,
      actorUserId: userId,
    })
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'submit-vote') {
    const result = await submitPrivateVoteCommand(leagueId, userId, typeof body.message === 'string' ? body.message : '')
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  const idolId = typeof body.idolId === 'string' ? body.idolId : undefined
  if (action === 'idol-play-preview') {
    if (!idolId) return NextResponse.json({ error: 'idolId required' }, { status: 422 })
    const preview = await getCouncilIdolPreview(leagueId, userId, idolId)
    return preview ? NextResponse.json(preview) : NextResponse.json({ error: 'Idol unavailable' }, { status: 404 })
  }

  if (action === 'play-idol') {
    const result = await playVoteShield(leagueId, userId, idolId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'play-extra-vote') {
    const result = await playExtraVote(leagueId, userId, targetUserId ?? undefined, idolId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'play-skip-tribal') {
    const result = await playSkipTribal(leagueId, userId, { forfeitsVote: body.forfeitsVote === true, idolId })
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'play-vote-steal') {
    if (typeof body.stolenVoterUserId !== 'string') return NextResponse.json({ error: 'Choose an eligible vote target and a manager whose vote to take.', action }, { status: 422 })
    const result = await playVoteSteal(leagueId, userId, body.stolenVoterUserId, targetUserId ?? undefined, idolId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'steal-three-preview') {
    if (typeof body.idolId !== 'string') return NextResponse.json({ error: 'idolId required' }, { status: 422 })
    const result = await getStealThreePreview(leagueId, userId, body.idolId)
    return result.ok ? NextResponse.json({ ok: true, ...result.value }) : NextResponse.json(result, { status: result.status })
  }

  if (action === 'play-steal-three') {
    if (typeof body.idolId !== 'string' || !Array.isArray(body.playerRowIds) || !Array.isArray(body.dropRowIds) ||
        !body.playerRowIds.every((id: unknown) => typeof id === 'string') || !body.dropRowIds.every((id: unknown) => typeof id === 'string')) {
      return NextResponse.json({ error: 'Choose an idol, three players, and any needed bench drops.' }, { status: 422 })
    }
    const result = await playStealThree(leagueId, userId, { idolId: body.idolId, playerRowIds: body.playerRowIds, dropRowIds: body.dropRowIds })
    if (!result.ok) return NextResponse.json(result, { status: result.status })
    return NextResponse.json({ ok: true, playerNames: result.value.playerNames, dropNames: result.value.dropNames, week: result.value.week })
  }

  // Resolve a council id for lifecycle actions: explicit body id, else the active council,
  // else the latest council (so post-reveal actions like resolve-elimination still find it).
  const resolveCouncilId = async (lid: string): Promise<string | null> => {
    if (typeof body.councilId === 'string') return body.councilId
    const active = await loadCouncilContext(lid)
    if (active) return active.council.id
    return (await getLatestCouncil(lid))?.id ?? null
  }

  if (action === 'close-vote-window') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await closeVoteWindow(leagueId, councilId, userId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    const tallied = await tallyCouncil(leagueId, councilId)
    if (!tallied.ok) return NextResponse.json({ ok: false, error: 'Votes closed; retry tally before the read' }, { status: 409 })
    return NextResponse.json({ ok: true, action, status: 'sealed' })
  }

  if (action === 'tally-votes') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await tallyCouncil(leagueId, councilId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ok: true, action, status: 'sealed', tallied: true, noFakeGameplayState: true })
  }

  if (action === 'reveal-votes') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await revealCouncil(leagueId, councilId, userId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    // The verdict and elimination follow when the last ballot is read (now, for all-at-once pacing;
    // otherwise reveal_next or the next automation tick). Ballots never travel back to this page.
    const finished = await finishCouncilReadIfComplete(leagueId, councilId, userId)
    const aftermathPending = !finished.ok || !finished.complete || (finished.elimination != null && !finished.elimination.ok)
    return NextResponse.json({ ok: true, action, aftermathPending, readInProgress: finished.ok && !finished.complete })
  }

  if (action === 'resolve-elimination') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await resolveElimination(leagueId, councilId, userId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'cancel-tribal') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await cancelCouncil(leagueId, councilId, userId)
    return NextResponse.json({ ...result, action, noFakeGameplayState: true }, { status: result.ok ? 200 : 409 })
  }

  return NextResponse.json({ error: 'Unsupported Survivor foundation action', action }, { status: 400 })
}
