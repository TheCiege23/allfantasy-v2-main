/**
 * Single authoritative native league creation pipeline (preset engine + canonical transaction + post-create hooks).
 * Used by POST /api/leagues and by the legacy POST /api/league/create compatibility wrapper for manual leagues.
 */

import type { LeagueSport, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { normalizeDraftTypeForEngine } from '@/lib/league-creation/canonical/validateCreateLeague'
import type { ValidatedCreateLeagueBody } from '@/lib/league-creation/canonical/validateCreateLeague'
import type { CreateLeagueErrorResponse, CreateLeagueSuccessResponse } from '@/lib/league-creation/canonical/types'
import { logLeagueCreated } from '@/server/services/auditService'
import { CREATE_LEAGUE } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { carryOverImportedLeague, ImportedLeagueCarryoverError } from '@/lib/league-creation/canonical/carryOverImportedLeague'

const LOG_PREFIX = '[create-league-canonical]'

function log(event: string, payload: Record<string, unknown>) {
  console.info(`${LOG_PREFIX} ${event}`, payload)
}

function prismaErrorDetail(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const o = e as { code?: string; message?: string; meta?: unknown }
    const meta = o.meta && typeof o.meta === 'object' ? JSON.stringify(o.meta) : ''
    return [o.code, o.message, meta].filter(Boolean).join(' · ')
  }
  return e instanceof Error ? e.message : String(e)
}

export type ExecuteCanonicalLeagueCreationResult =
  | { ok: true; response: CreateLeagueSuccessResponse }
  | { ok: false; status: number; response: CreateLeagueErrorResponse }

export async function executeCanonicalLeagueCreation(args: {
  appUserId: string
  body: ValidatedCreateLeagueBody
  sourceLeagueId?: string
}): Promise<ExecuteCanonicalLeagueCreationResult> {
  const { appUserId, body } = args
  const engineDraft = normalizeDraftTypeForEngine(body.draftType)

  let engine
  try {
    engine = runPresetEngine({
      concept: body.concept,
      sport: body.sport,
      teamCount: body.teamCount,
      draftType: engineDraft,
      scoringPreset: body.scoringPreset,
      leagueName: body.leagueName,
      commissionerId: appUserId,
      conceptSetup: body.conceptSetup ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('preset_engine_failed', { msg })
    recordProductEvent(CREATE_LEAGUE.SERVER_FAIL, {
      userId: appUserId,
      meta: { stage: 'preset', sport: String(body.sport), message: msg.slice(0, 400) },
    })
    return {
      ok: false,
      status: 400,
      response: {
        success: false,
        error: 'Preset resolution failed',
        errors: [{ path: 'preset', message: msg }],
      },
    }
  }

  let createdLeagueId = ''
  let homepageUrl = ''

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const created = await createCanonicalLeagueInTransaction(
          tx as Prisma.TransactionClient,
          appUserId,
          body,
          engine,
          (ev, payload) => log(ev, payload)
        )
        if (args.sourceLeagueId) {
          await carryOverImportedLeague(tx as Prisma.TransactionClient, {
            sourceLeagueId: args.sourceLeagueId,
            targetLeagueId: created.leagueId,
            creatorUserId: appUserId,
            sport: String(body.sport),
            teamCount: body.teamCount,
          })
        }
        return created
      },
      { maxWait: 20000, timeout: args.sourceLeagueId ? 60000 : 25000 }
    )
    createdLeagueId = result.leagueId
    homepageUrl = result.homepageUrl
  } catch (e) {
    if (e instanceof ImportedLeagueCarryoverError) {
      return {
        ok: false,
        status: 400,
        response: { success: false, error: e.message, errors: [{ path: 'sourceLeagueId', message: e.message }] },
      }
    }
    const detail = prismaErrorDetail(e)
    console.error(`${LOG_PREFIX} transaction_failed`, detail)
    recordProductEvent(CREATE_LEAGUE.SERVER_FAIL, {
      userId: appUserId,
      meta: { stage: 'database', sport: String(body.sport), detail: detail.slice(0, 400) },
    })
    return {
      ok: false,
      status: 500,
      response: {
        success: false,
        error: 'Failed to create league',
        errors: [{ path: 'database', message: 'League creation failed' }],
        detail,
      },
    }
  }

  try {
    await logLeagueCreated({
      leagueId: createdLeagueId,
      userId: appUserId,
      leagueName: body.leagueName,
      sport: String(body.sport),
      concept: engine.leagueFormatId,
      presetKey: engine.presetKey,
    })
  } catch (e) {
    console.error(`${LOG_PREFIX} audit_log_league_created_failed`, e)
  }

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId: createdLeagueId,
        eventType: 'league_created',
        title: 'League created',
        message: `${body.leagueName} is ready to set up.`,
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: appUserId,
        meta: { sport: String(body.sport), concept: engine.leagueFormatId, presetKey: engine.presetKey },
        dedupeKey: `league_created:${createdLeagueId}`,
      }),
    )
    .catch(() => {})

  try {
    const { runPostCreateInitialization } = await import('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator')
    await runPostCreateInitialization(createdLeagueId, body.sport as LeagueSport, engine.leagueFormatId)
  } catch (e) {
    console.warn(`${LOG_PREFIX} post_create_bootstrap_non_fatal`, e)
  }

  try {
    const { generateLeagueConstitutionArtifact } = await import('@/lib/league/format-artifact-service')
    await generateLeagueConstitutionArtifact(createdLeagueId)
  } catch (e) {
    console.warn(`${LOG_PREFIX} constitution_non_fatal`, e)
  }

  // Slice 7: auto-materialize the draft so every joined human is seated and
  // remaining slots are AI-managed orphans. Best-effort — commissioner can
  // always click "Fill empty slots" in the Pre-Draft Setup card if this fails.
  // The create response must return after the transaction commits. A full imported
  // roster can take longer to materialize than this request's runtime budget.
  // The wizard invokes the commissioner-only finalizer in a separate retryable request.
  if (!args.sourceLeagueId) {
    try {
      const { autoMaterializeDraftForLeague } = await import('@/lib/league-setup/autoMaterializeDraftForLeague')
      const result = await autoMaterializeDraftForLeague(createdLeagueId)
      if (result.ok) {
        log('auto_materialize_success', {
          leagueId: createdLeagueId,
          slotOrderSeeded: result.slotOrderSeeded,
          materializedCreated: result.materializedCreated,
          materializedAlready: result.materializedAlready,
        })
      } else {
        console.warn(`${LOG_PREFIX} auto_materialize_non_fatal`, result.reason)
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} auto_materialize_non_fatal`, e)
    }
  }

  const resBody: CreateLeagueSuccessResponse = {
    success: true,
    league: {
      id: createdLeagueId,
      leagueName: body.leagueName,
      concept: engine.leagueFormatId,
      sport: String(body.sport),
      teamCount: body.teamCount,
      draftType: body.draftType,
      scoringPreset: body.scoringPreset,
      status: 'setup',
      presetKey: engine.presetKey,
    },
    homepageUrl,
  }

  if (engine.warnings.length > 0) {
    resBody.warnings = engine.warnings
  }
  if (args.sourceLeagueId) {
    resBody.warnings = [
      ...(resBody.warnings ?? []),
      {
        path: 'sourceLeagueId',
        code: 'IMPORT_MATERIALIZATION_PENDING',
        message: 'Imported teams and rosters were copied, but native season materialization is pending. League setup remains open.',
      },
    ]
  }

  log('success', { leagueId: createdLeagueId, homepageUrl })

  recordProductEvent(CREATE_LEAGUE.SERVER_SUCCESS, {
    userId: appUserId,
    meta: {
      leagueId: createdLeagueId,
      sport: String(body.sport),
      concept: engine.leagueFormatId,
      draftType: body.draftType,
      teamCount: body.teamCount,
      presetKey: engine.presetKey,
    },
  })

  return { ok: true, response: resBody }
}
