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
import { submitVote } from '@/lib/survivor/survivorVoteService'
import { playVoteShield, playExtraVote, playSkipTribal } from '@/lib/survivor/survivorIdolResolutionService'
import { tallyCouncil, revealCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { resolveElimination } from '@/lib/survivor/survivorEliminationService'

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

async function updateFoundationSettings(leagueId: string, body: JsonRecord) {
  const current = await readLeagueSettings(leagueId)
  if (!current) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  const incoming = asRecord(body.settings)
  const mergedInput = { ...current, ...incoming, ...body }
  const settings = normalizeSurvivorFoundationSettings(mergedInput)
  const settingsPatch = buildSurvivorSettingsSnapshotPatch(settings as unknown as JsonRecord)
  const columnPatch = buildSurvivorLeagueColumnPatch(settings)

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
      settings: { ...current, ...settingsPatch } as Prisma.InputJsonValue,
      ...columnPatch,
    },
  })

  await upsertSurvivorConfig(leagueId, {
    tribeCount: settings.tribeCount,
    tribeSize: Math.max(1, Math.ceil(settings.defaultTeamCount / settings.tribeCount)),
    tribeFormation: settings.tribeAssignmentMode,
    mergeTrigger: settings.mergeTriggerType === 'active_player_count' ? 'player_count' : 'week',
    mergeWeek: settings.mergeWeek,
    mergePlayerCount: settings.mergeActivePlayerCount,
    selfVoteDisallowed: !settings.selfVotesAllowed,
    exileReturnEnabled: settings.exileIslandEnabled,
    idolCount: settings.defaultTeamCount + settings.tribeCount,
    tribalCouncilTimeUtc: settings.tribalCouncilTime,
    minigameFrequency: 'none',
    challengesSystemRun: false,
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
      })
    }
    return updateFoundationSettings(leagueId, body)
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
  ])
  const PHASE3_PARTICIPANT_ACTIONS = new Set(['submit-vote', 'play-idol', 'play-extra-vote', 'play-skip-tribal'])

  if (PHASE3_ADMIN_ACTIONS.has(action) && !access.decisions.canPerformAdminAction) {
    return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
  }
  if (PHASE3_PARTICIPANT_ACTIONS.has(action) && !access.isParticipant) {
    return NextResponse.json({ error: 'Only an active player can take this action' }, { status: 403 })
  }

  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null

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
    if (!targetUserId) return NextResponse.json({ error: 'targetUserId required', action }, { status: 422 })
    const result = await submitVote(leagueId, userId, targetUserId, {
      allowLateOverride: body.allowLateOverride === true && access.decisions.canOverrideVoteDeadline,
    })
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'play-idol') {
    const result = await playVoteShield(leagueId, userId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'play-extra-vote') {
    if (!targetUserId) return NextResponse.json({ error: 'targetUserId required', action }, { status: 422 })
    const result = await playExtraVote(leagueId, userId, targetUserId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'play-skip-tribal') {
    const result = await playSkipTribal(leagueId, userId, { forfeitsVote: body.forfeitsVote === true })
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
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
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'tally-votes') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await tallyCouncil(leagueId, councilId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    // Participating commissioner must NOT see the pre-reveal tally; return only operational status.
    if (!access.decisions.canSeeVoteTallyBeforeReveal) {
      return NextResponse.json(
        { ok: true, action, status: result.status, isTie: result.tally.isTie, tallied: true, noFakeGameplayState: true },
        { status: 200 },
      )
    }
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
  }

  if (action === 'reveal-votes') {
    const councilId = await resolveCouncilId(leagueId)
    if (!councilId) return NextResponse.json({ error: 'No council', action }, { status: 404 })
    const result = await revealCouncil(leagueId, councilId, userId)
    if (!result.ok) return NextResponse.json({ ...result, action }, { status: result.status })
    return NextResponse.json({ ...result, action, noFakeGameplayState: true })
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
