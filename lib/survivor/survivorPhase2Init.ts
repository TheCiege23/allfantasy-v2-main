import { reconcileSurvivorDraftPlan } from './reconcileSurvivorDraftPlan'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import 'server-only'

import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { prepareSurvivorDraftParticipants } from './survivorDraftParticipants'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { assignSurvivorTribes, getTribeAssignmentStatus } from './survivorTribeProvisioning'
import { provisionSurvivorChats } from './survivorTribeChatProvisioning'
import { seedSurvivorIdols, getIdolSeedStatus } from './survivorIdolProvisioning'
import { postSurvivorIntroAnnouncement } from './survivorAnnouncementService'
import type { TribeAssignmentMode } from './survivorTribeAssignmentEngine'

export interface SurvivorPhase2InitOptions {
  actorUserId?: string
  /** Override assignment mode (defaults to league setting). */
  mode?: TribeAssignmentMode
  tribeCount?: number
  seed?: number | null
  manualMapping?: Record<string, number> | null
  draftOrder?: string[] | null
  tribeMeta?: Record<number, { name?: string; colorHex?: string; logoUrl?: string }> | null
  /** Reset path: tear down and rebuild tribes/chats/idols. */
  allowReassign?: boolean
  /** Server-provided completed native draft; never accepted directly from request JSON. */
  completedDraftSessionId?: string
}

export interface SurvivorPhase2InitResult {
  ok: boolean
  /** True only if every step succeeded (or was already done). */
  complete: boolean
  steps: {
    tribes: { ok: boolean; created: boolean; alreadyAssigned: boolean; tribeCount: number; detail: string }
    chats: { ok: boolean; created: boolean; leagueChannelId: string | null; tribeChannelCount: number }
    idols: { ok: boolean; seeded: boolean; alreadySeeded: boolean; voteShieldCount: number }
    intro: { ok: boolean; posted: boolean; pending: boolean }
  }
  blockers: string[]
}

/**
 * Phase 2 initialization orchestrator. Runs the canonical sequence in order:
 *   1. assign tribes  →  2. provision league + tribe chats  →  3. seed Vote Shield idols  →
 *   4. post host intro announcement  →  5. mark game stage `pre_merge`.
 *
 * Every underlying service is idempotent, so re-running is safe and reports `already*` states
 * rather than duplicating work. If tribe assignment cannot proceed (e.g. draft_pattern with
 * incomplete draft data), the orchestrator stops truthfully and surfaces the blocker — it never
 * fabricates downstream gameplay state.
 */
function setupStatus(complete: boolean, detail: string, blockers: string[] = []): SurvivorPhase2InitResult {
  return {
    ok: complete, complete, blockers,
    steps: {
      tribes: { ok: complete, created: false, alreadyAssigned: complete, tribeCount: 0, detail },
      chats: { ok: complete, created: false, leagueChannelId: null, tribeChannelCount: 0 },
      idols: { ok: complete, seeded: false, alreadySeeded: complete, voteShieldCount: 0 },
      intro: { ok: complete, posted: false, pending: !complete },
    },
  }
}

/** Atomic, serialized initialization for automatic completion and manual repair. */
export function initializeSurvivorPhase2(
  leagueId: string,
  opts: SurvivorPhase2InitOptions = {},
): Promise<SurvivorPhase2InitResult> {
  return withSurvivorSetupTransaction(leagueId, async (db) => {
    let sessionId = opts.completedDraftSessionId
    if (!sessionId) {
      const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
      const snapshot = league?.settings as Record<string, unknown> | null
      if (league && resolveWriteAuthority(league.platform) === 'NATIVE' && snapshot?.survivorFoundationSettingsVersion === 1) {
        const current = await db.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true, status: true, sessionKind: true } })
        if (!current || current.status !== 'completed' || current.sessionKind === 'mock') {
          return setupStatus(false, 'Complete the current native league draft before starting Survivor.', ['draft_not_ready'])
        }
        sessionId = current.id
      }
    }
    if (sessionId && !opts.allowReassign && !opts.mode && !opts.manualMapping) {
      const ready = await db.survivorAuditEntry.findFirst({
        where: { leagueId, action: 'draft_setup_ready', relatedEntityId: sessionId }, select: { id: true },
      })
      if (ready) return setupStatus(true, 'Survivor was already initialized from this draft.')
    }
    let draftOrder = opts.draftOrder
    if (sessionId) {
      await reconcileSurvivorDraftPlan(db, leagueId, sessionId)
      const preparation = await prepareSurvivorDraftParticipants(leagueId, sessionId, db)
      if (!preparation.ok) {
        await recordDraftSetupStatus(db, leagueId, sessionId, false, [preparation.error], opts.actorUserId)
        return setupStatus(false, preparation.error, [preparation.code])
      }
      if (preparation.alreadyStarted) return setupStatus(true, 'Survivor has already progressed; existing gameplay was preserved.')
      draftOrder ??= preparation.draftOrder
    }
    const result = await initializeSurvivorPhase2Locked(leagueId, { ...opts, draftOrder }, db)
    if (sessionId) {
      const detail = result.complete ? [] : [result.steps.tribes.detail, ...result.blockers]
      await recordDraftSetupStatus(db, leagueId, sessionId, result.complete, detail, opts.actorUserId)
    }
    return result
  })
}

async function recordDraftSetupStatus(
  db: Prisma.TransactionClient, leagueId: string, sessionId: string, complete: boolean, blockers: string[], actorUserId?: string,
): Promise<void> {
  const action = complete ? 'draft_setup_ready' : 'draft_setup_pending'
  const previous = await db.survivorAuditEntry.findFirst({
    where: { leagueId, relatedEntityId: sessionId, action: { in: ['draft_setup_ready', 'draft_setup_pending'] } },
    orderBy: { createdAt: 'desc' }, select: { action: true, data: true },
  })
  if (previous?.action === action && JSON.stringify(previous.data) === JSON.stringify({ blockers })) return
  await db.survivorAuditEntry.create({ data: {
    leagueId, category: 'phase', action, actorUserId: actorUserId ?? null,
    relatedEntityId: sessionId, relatedEntityType: 'draft', data: { blockers },
    isVisibleToCommissioner: true, isVisibleToPublic: false,
  } })
}

async function initializeSurvivorPhase2Locked(
  leagueId: string,
  opts: SurvivorPhase2InitOptions,
  db: Prisma.TransactionClient,
): Promise<SurvivorPhase2InitResult> {
  const blockers: string[] = []
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = normalizeSurvivorFoundationSettings(
    league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {},
  )

  // 1. Tribes.
  const tribesOutcome = await assignSurvivorTribes(leagueId, {
    mode: opts.mode ?? settings.tribeAssignmentMode,
    tribeCount: opts.tribeCount ?? settings.tribeCount,
    seed: opts.seed ?? null,
    manualMapping: opts.manualMapping ?? null,
    draftOrder: opts.draftOrder ?? null,
    tribeMeta: opts.tribeMeta ?? null,
    allowReassign: opts.allowReassign ?? false,
    actorUserId: opts.actorUserId,
    db,
  })

  if (!tribesOutcome.ok) {
    blockers.push(`tribe_assignment:${tribesOutcome.code}`)
    const status = await getTribeAssignmentStatus(leagueId, db)
    return {
      ok: false,
      complete: false,
      steps: {
        tribes: { ok: false, created: false, alreadyAssigned: status.assigned, tribeCount: status.tribeCount, detail: tribesOutcome.error },
        chats: { ok: false, created: false, leagueChannelId: null, tribeChannelCount: 0 },
        idols: { ok: false, seeded: false, alreadySeeded: false, voteShieldCount: 0 },
        intro: { ok: false, posted: false, pending: false },
      },
      blockers,
    }
  }

  // 2. Chats (depends on tribe membership being persisted).
  const chatsOutcome = await provisionSurvivorChats(leagueId, { actorUserId: opts.actorUserId, db })

  // 3. Idols (count = rosterSpots + tribeCount).
  const idolsOutcome = settings.idolsEnabled ? await seedSurvivorIdols(leagueId, {
    tribeCount: opts.tribeCount ?? settings.tribeCount,
    seed: opts.seed ?? null,
    actorUserId: opts.actorUserId,
    allowReseed: opts.allowReassign ?? false,
    db,
  }) : { ok: true as const, seeded: false, alreadySeeded: false, voteShieldCount: 0 }
  if (!idolsOutcome.ok) throw new Error(`Survivor idol setup failed: ${idolsOutcome.error}`)

  // 4. Intro announcement (real message if a league channel exists; pending audit otherwise).
  const introOutcome = await postSurvivorIntroAnnouncement(leagueId, { actorUserId: opts.actorUserId, db })

  // A previous intro message is success too; a pending intro is not a playable setup.
  const idolStatus = await getIdolSeedStatus(leagueId, db)
  const complete = chatsOutcome.ok && (!settings.idolsEnabled || idolStatus.seeded) && Boolean(introOutcome.messageId) && blockers.length === 0
  if (complete) {
    const previous = await db.survivorAuditEntry.findFirst({ where: { leagueId, action: 'phase_2_initialized' }, select: { id: true } })
    if (!previous || opts.allowReassign) {
      await db.survivorAuditEntry.create({ data: {
        leagueId, category: 'phase', action: 'phase_2_initialized', actorUserId: opts.actorUserId ?? null,
        data: { tribes: tribesOutcome.tribes.length, chats: chatsOutcome.tribeChannels.length, idols: idolsOutcome.voteShieldCount, introPosted: true },
        isVisibleToCommissioner: true, isVisibleToPublic: true,
      } })
    }
    const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { draftCompletedAt: true, preMergeStartedAt: true } })
    await db.survivorGameState.updateMany({
      where: { leagueId, phase: { in: ['pre_draft', 'draft', 'pre_merge'] }, currentWeek: { lte: 0 } },
      data: { phase: 'pre_merge', currentWeek: readSurvivorFullSeasonPlan(league?.settings)?.startWeek ?? 0, draftCompletedAt: game?.draftCompletedAt ?? new Date(), preMergeStartedAt: game?.preMergeStartedAt ?? new Date() },
    })
    await db.league.updateMany({ where: { id: leagueId, survivorPhase: { in: ['pre_draft', 'draft', 'pre_merge'] } }, data: { survivorPhase: 'pre_merge' } })
  }

  return {
    ok: true,
    complete,
    steps: {
      tribes: {
        ok: true,
        created: tribesOutcome.created,
        alreadyAssigned: tribesOutcome.alreadyAssigned,
        tribeCount: tribesOutcome.tribes.length,
        detail: tribesOutcome.alreadyAssigned ? 'Tribes already assigned (idempotent).' : 'Tribes assigned.',
      },
      chats: {
        ok: chatsOutcome.ok,
        created: chatsOutcome.created,
        leagueChannelId: chatsOutcome.leagueChannelId,
        tribeChannelCount: chatsOutcome.tribeChannels.length,
      },
      idols: {
        ok: idolsOutcome.ok,
        seeded: idolsOutcome.ok ? idolsOutcome.seeded : false,
        alreadySeeded: idolsOutcome.ok ? idolsOutcome.alreadySeeded : false,
        voteShieldCount: idolStatus.voteShieldCount,
      },
      intro: { ok: introOutcome.ok, posted: introOutcome.posted, pending: introOutcome.pending },
    },
    blockers,
  }
}

/** Read-only Phase 2 initialization status for the dashboard/state sanitizer. */
export async function getSurvivorPhase2Status(leagueId: string): Promise<{
  tribesAssigned: boolean
  tribeCount: number
  chatsProvisioned: boolean
  idolsSeeded: boolean
  voteShieldCount: number
  introPosted: boolean
}> {
  const [tribeStatus, idolStatus, leagueChannel, introMessage] = await Promise.all([
    getTribeAssignmentStatus(leagueId),
    getIdolSeedStatus(leagueId),
    prisma.survivorChatChannel.count({ where: { leagueId, channelType: 'league', isArchived: false } }),
    prisma.survivorChatMessage.count({ where: { leagueId, contentType: 'survivor_intro' } }),
  ])
  return {
    tribesAssigned: tribeStatus.assigned,
    tribeCount: tribeStatus.tribeCount,
    chatsProvisioned: leagueChannel > 0,
    idolsSeeded: idolStatus.seeded,
    voteShieldCount: idolStatus.voteShieldCount,
    introPosted: introMessage > 0,
  }
}

/**
 * DEV/TEST-ONLY reset: tears down tribes, tribe members, tribe/league chats, chat messages,
 * idols + ledgers, and resets player tribe/idol state so the Phase 2 flow can be re-run from a
 * clean slate. Guarded by the route to non-production + commissioner only. Never deletes the
 * league or its configured settings.
 */
export async function resetSurvivorPhase2State(
  leagueId: string,
  opts: { actorUserId?: string } = {},
): Promise<{ ok: true; cleared: Record<string, number> }> {
  const cleared: Record<string, number> = {}
  await withSurvivorSetupTransaction(leagueId, async (tx) => {
    const idolIds = ((await tx.survivorIdol.findMany({ where: { leagueId }, select: { id: true } })) as Array<{ id: string }>).map((i) => i.id)
    cleared.idolLedger = (await tx.survivorIdolLedgerEntry.deleteMany({ where: { idolId: { in: idolIds } } })).count
    cleared.idols = (await tx.survivorIdol.deleteMany({ where: { leagueId } })).count
    cleared.chatMessages = (await tx.survivorChatMessage.deleteMany({ where: { leagueId } })).count
    cleared.chatChannels = (await tx.survivorChatChannel.deleteMany({ where: { leagueId } })).count
    const tribeIds = ((await tx.survivorTribe.findMany({ where: { leagueId }, select: { id: true } })) as Array<{ id: string }>).map((t) => t.id)
    cleared.tribeMembers = (await tx.survivorTribeMember.deleteMany({ where: { tribeId: { in: tribeIds } } })).count
    cleared.tribes = (await tx.survivorTribe.deleteMany({ where: { leagueId } })).count
    await tx.survivorAuditEntry.deleteMany({ where: { leagueId, action: { in: ['draft_setup_ready', 'draft_setup_pending', 'phase_2_initialized'] } } })
    cleared.players = (await tx.survivorPlayer.updateMany({ where: { leagueId }, data: { tribeId: null, idolIds: [], canAccessTribeChat: false } })).count
    await tx.survivorAuditEntry.create({
      data: {
        leagueId,
        category: 'phase',
        action: 'phase_2_reset',
        actorUserId: opts.actorUserId ?? null,
        data: { cleared },
        isVisibleToCommissioner: true,
        isVisibleToPublic: false,
      },
    })
  })
  return { ok: true, cleared }
}
