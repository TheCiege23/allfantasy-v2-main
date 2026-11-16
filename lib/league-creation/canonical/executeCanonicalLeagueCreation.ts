/**
 * Single authoritative native league creation pipeline (preset engine + canonical transaction + post-create hooks).
 * Used by POST /api/leagues and by the legacy POST /api/league/create compatibility wrapper for manual leagues.
 */

import { createZombieUniverseInTransaction } from './createZombieUniverseInTransaction'
import { zombieCreationLeagueCount } from '@/lib/zombie/creationPolicy'
import type { PresetEngineOutput } from './types'
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
import { getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'
import { computeStartupDraftCapacity, formatCountsTaxiAndDevy } from '@/lib/draft/draftSettingsPolicy'
import { resolveSGCreateConfig, sgSetupHref } from '@/lib/survivor-guillotine/createFit'
import { writeSGRulesInTransaction } from '@/lib/survivor-guillotine/rulesWrite'

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

  let leagueCount = 1
  try {
    leagueCount = engine.leagueFormatId === 'zombie' ? zombieCreationLeagueCount(body.conceptSetup) : 1
    if (args.sourceLeagueId && leagueCount > 1) throw new Error('Imported rosters can carry into only one league at a time.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Zombie universe size.'
    return { ok: false, status: 400, response: { success: false, error: message,
      errors: [{ path: 'conceptSetup.zombieLeagueCount', message }] } }
  }
  // Survivor Guilly: the season rules are fitted and validated here, before anything is written, and
  // committed in the same transaction as the league below. A request that cannot be fitted is refused
  // whole rather than leaving a plain redraft league behind without its rules.
  const sgCreate = resolveSGCreateConfig({
    concept: body.concept,
    sport: body.sport,
    teamCount: body.teamCount,
    conceptSetup: body.conceptSetup,
  })
  if (sgCreate.kind === 'invalid') {
    return { ok: false, status: 400, response: { success: false, error: sgCreate.message,
      errors: [{ path: sgCreate.path, message: sgCreate.message }] } }
  }
  let createdLeagueId = ''
  let homepageUrl = ''
  let universeId: string | undefined
  let children: Array<{ leagueId: string; homepageUrl: string; body: ValidatedCreateLeagueBody }> = []

  try {
    const result = await prisma.$transaction<{
      leagueId: string
      homepageUrl: string
      universeId?: string
      children: Array<{ leagueId: string; homepageUrl: string; body: ValidatedCreateLeagueBody }>
    }>(
      async (tx) => {
        if (leagueCount > 1) {
          const batch = await createZombieUniverseInTransaction(tx as Prisma.TransactionClient, appUserId, body, engine)
          return { ...batch.leagues[0], universeId: batch.universeId, children: batch.leagues }
        }
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
            acceptWeeklyLineups: body.conceptSetup?.acceptWeeklyLineups === true,
          })
        }
        if (sgCreate.kind === 'ok') {
          await writeSGRulesInTransaction(tx as Prisma.TransactionClient, created.leagueId, sgCreate.config)
          // Land on the season setup page: tribes, powers and the calendar are tuned there.
          return { ...created, homepageUrl: sgSetupHref(created.leagueId), universeId: undefined, children: [] }
        }
        return { ...created, universeId: undefined, children: [] }
      },
      { maxWait: 20000, timeout: leagueCount > 1 ? 90000 : args.sourceLeagueId ? 60000 : 25000 }
    )
    createdLeagueId = result.leagueId
    homepageUrl = result.homepageUrl
    universeId = result.universeId
    children = result.children
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

  if (universeId) {
    let primary: ExecuteCanonicalLeagueCreationResult | undefined
    for (const child of children) {
      const result = await finishCreatedLeague({ ...args, body: child.body }, engine, child.leagueId, child.homepageUrl)
      primary ??= result
    }
    if (primary?.ok) {
      primary.response.universeId = universeId
      primary.response.leagueIds = children.map((child) => child.leagueId)
      primary.response.homepageUrl = `/zombie/universe/${universeId}`
      return primary
    }
    throw new Error('Zombie universe committed without a primary league response.')
  }
  return finishCreatedLeague(args, engine, createdLeagueId, homepageUrl)
}

async function finishCreatedLeague(
  args: { appUserId: string; body: ValidatedCreateLeagueBody; sourceLeagueId?: string },
  engine: PresetEngineOutput,
  createdLeagueId: string,
  homepageUrl: string,
): Promise<ExecuteCanonicalLeagueCreationResult> {
  const { appUserId, body } = args
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

  await import('@/lib/league-events/publisher')
    .then(({ publishLeagueCreatedNotice }) => publishLeagueCreatedNotice({
      leagueId: createdLeagueId, actorUserId: appUserId, leagueName: body.leagueName, sport: String(body.sport),
    }))
    .catch((e) => console.error(`${LOG_PREFIX} league_created_notification_failed`, e))

  try {
    const { runPostCreateInitialization } = await import('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator')
    await runPostCreateInitialization(createdLeagueId, body.sport as LeagueSport, engine.leagueFormatId)
  } catch (e) {
    console.warn(`${LOG_PREFIX} post_create_bootstrap_non_fatal`, e)
  }

  // The tanking monitor starts on (lib/integrity/integrityDefaults.ts). Non-fatal: a league is never
  // refused over its integrity settings, and the integrity page creates the same row on first visit.
  try {
    const { NEW_LEAGUE_INTEGRITY_DEFAULTS } = await import('@/lib/integrity/integrityDefaults')
    await prisma.leagueIntegritySettings.upsert({
      where: { leagueId: createdLeagueId },
      create: { leagueId: createdLeagueId, ...NEW_LEAGUE_INTEGRITY_DEFAULTS },
      update: {},
    })
  } catch (e) {
    console.warn(`${LOG_PREFIX} integrity_defaults_non_fatal`, e)
  }

  // Post-create roster bootstrap can install a sport/format roster smaller than the generic
  // draft preset (NHL guillotine was 18 rounds for a 14-slot roster). Reconcile the actual
  // draft gate's template before returning a league whose first draft cannot finish.
  if (!args.sourceLeagueId) {
    try {
      const template = await getLeagueDraftTemplatePayload(createdLeagueId)
      // Dynasty-family startups: only the spots a drafted player is placed in (starters + bench + devy).
      // The total also holds IR and taxi, which finalization never fills — a board that size left every
      // team over its active roster limit, and every trade was refused (computeStartupDraftCapacity).
      const startupCapacity = formatCountsTaxiAndDevy([engine.leagueFormatId])
        ? computeStartupDraftCapacity(template.template?.slots ?? [])
        : 0
      const capacity = startupCapacity > 0 ? Math.min(template.totalRosterSlots, startupCapacity) : template.totalRosterSlots
      if (capacity > 0) {
        const session = await prisma.draftSession.findFirst({
          where: { leagueId: createdLeagueId, status: 'pre_draft' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, rounds: true, devyConfig: true },
        })
        /*
         * A plain dynasty startup also GROWS to its active roster. The sport presets' startup depth is
         * not chosen in the form and lagged the default rosters — NHL 26 rounds for 27 active spots,
         * MLB 34 for 41 — so every team finished the startup with empty spots, while the first roster
         * edit resized the draft to the full roster (syncDraftRoundsToRoster). Not when college rounds
         * sit at the end of the draft (devyConfig): they are numbered from the last round.
         */
        const devyRounds = (session?.devyConfig as { enabled?: unknown } | null)?.enabled === true
        /*
         * A plain REDRAFT draft grows the same way, to the spots a drafted player is placed in (starters +
         * bench; IR is never filled by a draft). College basketball's preset was 12 rounds for 13 such
         * spots, so every team finished the draft one player short — while the first roster edit already
         * resizes a redraft draft to that same count (syncDraftRoundsToRoster). Found by the redraft
         * simulation, 2026-11-09.
         *
         * A KEEPER league's first draft grows too. It was left alone on the reasoning that "keepers fill the
         * rest", but a new league has no keepers, and in later years each keeper takes a pick on the board in
         * the round he cost (createNextLeagueDraft) rather than a spot beside it. So the first draft left
         * every team short — NFL 16 rounds for 17 spots — while the first roster edit resized it anyway
         * (keeper simulation, 2026-11-10: 26 of 27 leagues).
         */
        const redraftActive = engine.leagueFormatId === 'redraft' || engine.leagueFormatId === 'keeper'
          ? computeStartupDraftCapacity(template.template?.slots ?? [])
          : 0
        const growTo = engine.leagueFormatId === 'dynasty' && startupCapacity > 0 && !devyRounds
          ? capacity
          : redraftActive > 0 && !devyRounds ? Math.min(template.totalRosterSlots, redraftActive) : 0
        const target = session && session.rounds > capacity ? capacity : session && growTo > session.rounds ? growTo : null
        if (session && target != null) {
          await prisma.$transaction(async (tx) => {
            const league = await tx.league.findUniqueOrThrow({ where: { id: createdLeagueId }, select: { settings: true } })
            const settings = (league.settings ?? {}) as Record<string, unknown>
            const draftSettings = (settings.draftSettings ?? {}) as Record<string, unknown>
            const foundation = (settings.foundation_defaults ?? {}) as Record<string, unknown>
            const foundationDraft = (foundation.draft ?? {}) as Record<string, unknown>
            await tx.league.update({
              where: { id: createdLeagueId },
              data: {
                rosterSize: capacity,
                settings: {
                  ...settings,
                  draftSettings: { ...draftSettings, rounds: target },
                  foundation_defaults: { ...foundation, draft: { ...foundationDraft, rounds: target } },
                } as Prisma.InputJsonValue,
              },
            })
            await tx.draftSession.update({ where: { id: session.id }, data: { rounds: target } })
            await tx.leagueSettings.updateMany({ where: { leagueId: createdLeagueId }, data: { rounds: target } })
            await tx.redraftLeagueDraftProfile.updateMany({ where: { leagueId: createdLeagueId }, data: { rounds: target } })
          })
          log('draft_rounds_fit_roster', { leagueId: createdLeagueId, requestedRounds: session.rounds, rounds: target })
        }
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} draft_rounds_fit_roster_failed`, e)
    }
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

  const initialDraftTime = await prisma.leagueSettings.findUnique({ where: { leagueId: createdLeagueId }, select: { draftDateUtc: true } }).catch(() => null)
  if (initialDraftTime?.draftDateUtc) {
    await import('@/lib/draft-notifications').then(m => m.notifyDraftTimeSet(createdLeagueId, initialDraftTime.draftDateUtc!))
      .catch((e) => console.error(`${LOG_PREFIX} draft_time_notification_failed`, e))
  }

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
