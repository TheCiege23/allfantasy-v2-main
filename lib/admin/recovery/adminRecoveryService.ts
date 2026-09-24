import type { LeagueLifecycleState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAdminAudit } from '@/lib/admin-audit'
import { transitionLeagueState } from '@/server/services/leagueLifecycleService'
import { enqueueLeagueEngineJob } from '@/lib/jobs/enqueue'
import { reprocessWeekAfterStatCorrection } from '@/server/services/statCorrectionService'
import { buildLeagueInspectSnapshot } from '@/lib/admin/operations/leagueInspectService'
import { pauseDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type AdminRecoveryAction =
  | {
      type: 'lifecycle_transition'
      nextState: LeagueLifecycleState
      force?: boolean
    }
  | { type: 'enqueue_waiver_process' }
  | {
      type: 'enqueue_scoring_week'
      season: number
      weekOrRound: number
      lockScores?: boolean
    }
  | {
      type: 'enqueue_specialty_automation'
      season: number
      week?: number | null
      trigger?: string
    }
  | {
      type: 'stat_correction_sync'
      season: number
      week: number
    }
  | {
      type: 'draft_pause'
      confirm: true
    }

export type AdminRecoveryResult =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Privileged league repairs: always writes `AdminAuditLog` with before/after snapshots when possible.
 */
export async function runAdminLeagueRecovery(input: {
  leagueId: string
  adminUserId: string
  action: AdminRecoveryAction
}): Promise<AdminRecoveryResult> {
  const { leagueId, adminUserId, action } = input
  const beforeSnap = await buildLeagueInspectSnapshot(leagueId)
  if (!beforeSnap?.league) {
    return { ok: false, error: 'League not found' }
  }

  try {
    switch (action.type) {
      case 'lifecycle_transition': {
        const res = await transitionLeagueState(leagueId, action.nextState, adminUserId, {
          force: action.force === true,
          metadata: { adminRepair: true, source: 'admin_operations' },
        })
        if (!res.ok) {
          return { ok: false, error: res.error }
        }
        const after = await buildLeagueInspectSnapshot(leagueId)
        await logAdminAudit({
          adminUserId,
          action: 'ops_lifecycle_repair',
          targetType: 'league',
          targetId: leagueId,
          details: {
            before: beforeSnap.league?.lifecycleState,
            after: after?.league?.lifecycleState,
            nextState: action.nextState,
            force: action.force === true,
          },
        })
        return { ok: true, detail: { lifecycleState: after?.league?.lifecycleState } }
      }
      case 'enqueue_waiver_process': {
        const idempotencyKey = `admin:waiver:${adminUserId}:${Date.now()}`
        const enq = await enqueueLeagueEngineJob(
          {
            kind: 'waiver_process',
            leagueId,
            idempotencyKey,
          },
          { jobId: idempotencyKey },
        )
        await logAdminAudit({
          adminUserId,
          action: 'ops_enqueue_waiver',
          targetType: 'league',
          targetId: leagueId,
          details: { idempotencyKey, enqueue: enq },
        })
        return { ok: true, detail: { enqueue: enq } }
      }
      case 'enqueue_scoring_week': {
        const idempotencyKey = `admin:score:${leagueId}:${action.season}:${action.weekOrRound}:${Date.now()}`
        const enq = await enqueueLeagueEngineJob(
          {
            kind: 'scoring_week',
            leagueId,
            idempotencyKey,
            payload: {
              season: action.season,
              weekOrRound: action.weekOrRound,
              lockScores: action.lockScores === true,
            },
          },
          { jobId: idempotencyKey },
        )
        await logAdminAudit({
          adminUserId,
          action: 'ops_enqueue_scoring',
          targetType: 'league',
          targetId: leagueId,
          details: { season: action.season, weekOrRound: action.weekOrRound, enqueue: enq },
        })
        return { ok: true, detail: { enqueue: enq } }
      }
      case 'enqueue_specialty_automation': {
        const idempotencyKey = `admin:auto:${leagueId}:${Date.now()}`
        const enq = await enqueueLeagueEngineJob(
          {
            kind: 'specialty_automation',
            leagueId,
            idempotencyKey,
            payload: {
              season: action.season,
              week: action.week ?? null,
              trigger: action.trigger ?? 'onScheduledPass',
              force: true,
            },
          },
          { jobId: idempotencyKey },
        )
        await logAdminAudit({
          adminUserId,
          action: 'ops_enqueue_automation',
          targetType: 'league',
          targetId: leagueId,
          details: { enqueue: enq, payload: action },
        })
        return { ok: true, detail: { enqueue: enq } }
      }
      case 'stat_correction_sync': {
        const idempotencyKey = `admin:statfix:${leagueId}:${action.season}:${action.week}:${Date.now()}`
        const r = await reprocessWeekAfterStatCorrection({
          leagueId,
          season: action.season,
          week: action.week,
          idempotencyKey,
        })
        await logAdminAudit({
          adminUserId,
          action: 'ops_stat_reprocess',
          targetType: 'league',
          targetId: leagueId,
          details: { season: action.season, week: action.week, skipped: r.skipped ?? false },
        })
        return { ok: true, detail: { reprocess: r } }
      }
      case 'draft_pause': {
        if (action.confirm !== true) {
          return { ok: false, error: 'draft_pause requires confirm: true' }
        }
        const ds = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
        if (!ds) {
          return { ok: false, error: 'No draft session for league' }
        }
        const before = { status: ds.status, version: ds.version }
        const okPause = await pauseDraftSession(leagueId, adminUserId)
        if (!okPause) {
          return {
            ok: false,
            error: 'Draft pause only applies when session is in_progress (use inspect to verify state).',
          }
        }
        const after = await prisma.draftSession.findFirst({
          where: { leagueId },
          orderBy: CURRENT_DRAFT_SESSION_ORDER,
          select: { id: true, status: true, version: true },
        })
        await logAdminAudit({
          adminUserId,
          action: 'ops_draft_pause',
          targetType: 'league',
          targetId: leagueId,
          details: { before, after },
        })
        return { ok: true, detail: { draftSession: after } }
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await logAdminAudit({
      adminUserId,
      action: 'ops_recovery_error',
      targetType: 'league',
      targetId: leagueId,
      details: { action, error: msg.slice(0, 2000) },
    })
    return { ok: false, error: msg }
  }
}
