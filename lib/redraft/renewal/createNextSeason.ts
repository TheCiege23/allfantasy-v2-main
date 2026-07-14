import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EVENT, getPlatformEvents } from '@/lib/events'
import { evaluateNextSeasonEligibility } from './nextSeasonEligibility'
import type { CreateNextSeasonInput, CreateNextSeasonResult } from './nextSeasonContract'

/**
 * Test-only, disposable-database-only failure injection. Named stages map
 * onto real points inside the transaction below. Gated so it can never fire
 * outside a non-production environment even if a caller supplied it by
 * mistake — production code paths never pass this parameter at all.
 */
export type NextSeasonFailureStage =
  | 'after_eligibility'
  | 'after_destination_creation'
  | 'after_roster_creation'
  | 'after_event_creation'
  | 'after_audit_creation'
  | 'after_renewal_completion'

function maybeInjectFailure(stage: NextSeasonFailureStage, requested: NextSeasonFailureStage | undefined) {
  if (process.env.NODE_ENV === 'production') return
  if (requested === stage) throw new Error(`INJECTED_TEST_FAILURE:${stage}`)
}

/**
 * Atomic next-season creation for NFL/NCAAF redraft leagues.
 *
 * Scope, stated honestly: this is the first real implementation of the
 * capability the prior Gate C phase found completely absent (only the
 * renewal open/decide proposal lifecycle existed). It covers the essential
 * materialization steps — destination season, source/destination linkage,
 * an immutable settings/scoring snapshot, roster shells, and manager
 * ownership — all inside one transaction, plus the canonical event and
 * audit record. Draft configuration, schedule generation, and playoff
 * bracket initialization are explicitly `deferred` (see the result's
 * `*Status` fields and `limitations`) — those are real, separate,
 * substantially larger subsystems (Draft OS / Schedule Runtime / Playoff
 * Engine) this phase's guardrail explicitly forbids redesigning.
 */
export async function createNextSeason(
  input: CreateNextSeasonInput,
  /** Test-only. Never set by any production caller. See `NextSeasonFailureStage`. */
  __failAfterStage?: NextSeasonFailureStage,
): Promise<CreateNextSeasonResult> {
  // Idempotency: exact replay by completion key returns the original stable
  // result without re-entering the transaction at all.
  const existingByKey = await prisma.leagueRenewal.findUnique({ where: { completionIdempotencyKey: input.idempotencyKey } })
  if (existingByKey) {
    if (existingByKey.sourceSeasonId !== input.sourceSeasonId || existingByKey.leagueId !== input.sourceLeagueId) {
      return conflictResult(input, 'CONFLICTING_IDEMPOTENCY_PAYLOAD: idempotency key already used for a different source league/season.')
    }
    return resultFromRenewal(existingByKey, input, 'already_created')
  }

  return prisma.$transaction(
    async (tx) => {
      const [league, season] = await Promise.all([
        tx.league.findUnique({ where: { id: input.sourceLeagueId }, select: { id: true, userId: true, sport: true, lifecycleState: true, settings: true, settingsSnapshotVersion: true, teams: { select: { isCommissioner: true, isCoCommissioner: true, claimedByUserId: true, platformUserId: true } } } }),
        tx.redraftSeason.findUnique({ where: { id: input.sourceSeasonId }, select: { id: true, leagueId: true, sport: true, season: true, status: true, totalWeeks: true, playoffStartWeek: true } }),
      ])
      const rosters = season
        ? await tx.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, ownerId: true, ownerName: true, teamName: true, avatarUrl: true } })
        : []
      const bracket = season ? await tx.redraftPlayoffBracket.findUnique({ where: { seasonId: season.id }, select: { status: true } }) : null
      const existingRenewal = await tx.leagueRenewal.findUnique({ where: { leagueId_season: { leagueId: input.sourceLeagueId, season: input.requestedSeason } } })

      if (existingRenewal?.nextSeasonId) {
        return resultFromRenewal(existingRenewal, input, 'already_created')
      }

      const eligibility = evaluateNextSeasonEligibility({
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        requestedSeason: input.requestedSeason,
        league: league ? { id: league.id, userId: league.userId, sport: league.sport, lifecycleState: league.lifecycleState, teams: league.teams } : null,
        season: season ?? null,
        rosters,
        playoffBracketStatus: bracket?.status ?? null,
        existingRenewal: existingRenewal ? { status: existingRenewal.status, nextSeasonId: existingRenewal.nextSeasonId } : null,
        overrideEnabled: input.override?.enabled === true,
      })

      if (!eligibility.eligible) {
        const event = await getPlatformEvents().emitInTx(tx, EVENT.RENEWAL_BLOCKED, {
          leagueId: input.sourceLeagueId,
          actor: { type: input.actorRole === 'administrator' ? 'administrator' : 'commissioner', id: input.actorUserId },
          idempotencyKey: `renewal-blocked:${input.sourceLeagueId}:${input.requestedSeason}:${input.idempotencyKey}`,
          source: 'next_season_creation',
          subjects: [{ kind: 'league', id: input.sourceLeagueId }],
          payload: { renewalId: existingRenewal?.id, sourceLeagueId: input.sourceLeagueId, sourceSeasonId: input.sourceSeasonId, violationCodes: eligibility.violations.map((v) => v.code) },
        })
        await tx.leagueAuditLog.create({ data: { leagueId: input.sourceLeagueId, userId: input.actorUserId, actionType: 'league_season_renewal_blocked', entityType: 'league_renewal', entityId: existingRenewal?.id ?? input.sourceLeagueId, metadata: { violations: eligibility.violations, idempotencyKey: input.idempotencyKey, eventId: event.eventId } } })
        return blockedResult(input, eligibility.violations.map((v) => v.code))
      }

      maybeInjectFailure('after_eligibility', __failAfterStage)

      // From here, `league`, `season`, and `rosters` are guaranteed non-null/non-empty by eligibility.
      const src = league!
      const srcSeason = season!

      const destinationSeason = await tx.redraftSeason.create({
        data: {
          leagueId: src.id,
          sport: srcSeason.sport,
          season: input.requestedSeason,
          status: 'setup',
          totalWeeks: srcSeason.totalWeeks,
          playoffStartWeek: srcSeason.playoffStartWeek,
          currentWeek: 0,
        },
      })
      maybeInjectFailure('after_destination_creation', __failAfterStage)

      // Roster shells: preserve identity/ownership, reset all mutable per-season
      // state (wins/losses/points/streak/playoffSeed/eliminated all default to 0/
      // null/false per schema; faabBalance/waiverPriority reset to schema defaults
      // — a deliberate, documented policy: prior-season results and FAAB spend
      // never carry forward, matching the Part 8 requirement not to copy mutable
      // prior-season results).
      const rosterCreates = rosters.map((r) =>
        tx.redraftRoster.create({
          data: {
            seasonId: destinationSeason.id,
            leagueId: src.id,
            ownerId: r.ownerId!,
            ownerName: r.ownerName,
            teamName: r.teamName,
            avatarUrl: r.avatarUrl,
          },
        }),
      )
      const createdRosters = await Promise.all(rosterCreates)
      maybeInjectFailure('after_roster_creation', __failAfterStage)

      const completionIdempotencyKey = input.idempotencyKey
      // Generate the renewal id up front (rather than after the event) so the
      // event can reference a real, stable renewal identity even on the
      // first-ever completion for this league/season, when no renewal row
      // exists yet to read an id back from.
      const renewalId = existingRenewal?.id ?? randomUUID()
      const event = await getPlatformEvents().emitInTx(tx, EVENT.NEXT_SEASON_CREATED, {
        leagueId: src.id,
        seasonId: destinationSeason.id,
        sport: srcSeason.sport,
        leagueConcept: 'redraft',
        actor: { type: input.actorRole === 'administrator' ? 'administrator' : 'commissioner', id: input.actorUserId },
        idempotencyKey: completionIdempotencyKey,
        source: 'next_season_creation',
        subjects: [{ kind: 'league', id: src.id }, { kind: 'redraft_season', id: destinationSeason.id }],
        payload: {
          renewalId,
          sourceLeagueId: src.id,
          sourceSeasonId: srcSeason.id,
          destinationLeagueId: src.id,
          destinationSeasonId: destinationSeason.id,
          sport: srcSeason.sport,
          requestedSeason: input.requestedSeason,
          actorRole: input.actorRole,
          rosterCount: createdRosters.length,
          managerAssignmentCount: createdRosters.filter((r) => r.ownerId).length,
          settingsSnapshotVersion: src.settingsSnapshotVersion ?? null,
          idempotencyKey: completionIdempotencyKey,
        },
      })
      maybeInjectFailure('after_event_creation', __failAfterStage)

      // Durable, transactional evidence of deferred work — per the Part 10/11
      // decision (draft/schedule/playoff initialization remain a separate
      // commissioner action this phase, not silently absent). Each is
      // idempotent by its own idempotencyKey, deduplicating on retry.
      for (const [type, key] of [
        [EVENT.NEXT_SEASON_DRAFT_INITIALIZATION_REQUESTED, `draft-init-requested:${destinationSeason.id}`],
        [EVENT.NEXT_SEASON_SCHEDULE_INITIALIZATION_REQUESTED, `schedule-init-requested:${destinationSeason.id}`],
        [EVENT.NEXT_SEASON_PLAYOFF_INITIALIZATION_REQUESTED, `playoff-init-requested:${destinationSeason.id}`],
      ] as const) {
        await getPlatformEvents().emitInTx(tx, type, {
          leagueId: src.id,
          seasonId: destinationSeason.id,
          sport: srcSeason.sport,
          leagueConcept: 'redraft',
          actor: { type: 'system', id: null },
          idempotencyKey: key,
          source: 'next_season_creation',
          subjects: [{ kind: 'redraft_season', id: destinationSeason.id }],
          payload: { destinationSeasonId: destinationSeason.id, destinationLeagueId: src.id, sport: srcSeason.sport },
        })
      }

      const auditId = randomUUID()
      await tx.leagueAuditLog.create({
        data: {
          id: auditId,
          leagueId: src.id,
          userId: input.actorUserId,
          actionType: 'league_next_season_created',
          entityType: 'redraft_season',
          entityId: destinationSeason.id,
          beforeState: { sourceSeasonId: srcSeason.id, sourceSeasonStatus: srcSeason.status },
          afterState: { destinationSeasonId: destinationSeason.id, rosterCount: createdRosters.length },
          metadata: { requestedSeason: input.requestedSeason, actorRole: input.actorRole, idempotencyKey: completionIdempotencyKey, eventId: event.eventId, overrideReason: input.override?.reason ?? null },
        },
      })
      maybeInjectFailure('after_audit_creation', __failAfterStage)

      const renewal = existingRenewal
        ? await tx.leagueRenewal.update({
            where: { id: existingRenewal.id },
            data: renewalCompletionData(src, srcSeason, destinationSeason.id, input, createdRosters.length, completionIdempotencyKey, event.eventId, auditId),
          })
        : await tx.leagueRenewal.create({
            data: {
              id: renewalId,
              leagueId: src.id,
              season: input.requestedSeason,
              renewalKind: 'redraft_reset',
              status: 'completed',
              initiatedBy: input.actorUserId,
              windowClosesAt: new Date(input.requestTimestamp),
              ...renewalCompletionData(src, srcSeason, destinationSeason.id, input, createdRosters.length, completionIdempotencyKey, event.eventId, auditId),
            },
          })
      maybeInjectFailure('after_renewal_completion', __failAfterStage)

      return {
        sourceLeagueId: input.sourceLeagueId,
        sourceSeasonId: input.sourceSeasonId,
        destinationLeagueId: src.id,
        destinationSeasonId: destinationSeason.id,
        requestedSeason: input.requestedSeason,
        status: 'created',
        rosterCount: createdRosters.length,
        managerAssignmentCount: createdRosters.filter((r) => r.ownerId).length,
        settingsSnapshotId: renewal.id,
        scoringSnapshotId: renewal.id,
        scheduleStatus: 'deferred',
        waiverStatus: 'initialized',
        draftStatus: 'deferred',
        eventId: event.eventId,
        auditId,
        idempotencyKey: completionIdempotencyKey,
        limitations: [
          'SCHEDULE_INITIALIZATION_REQUIRES_COMMISSIONER_ACTION — a durable schedule-initialization-requested event was recorded transactionally, but no schedule was generated.',
          'DRAFT_INITIALIZATION_REQUIRES_COMMISSIONER_ACTION — a durable draft-initialization-requested event was recorded transactionally, but no draft was created or configured.',
          'PLAYOFF_INITIALIZATION_REQUIRES_COMMISSIONER_ACTION — a durable playoff-initialization-requested event was recorded transactionally, but no bracket structure was initialized.',
          'Waiver priority and FAAB reset to schema defaults for every roster; no league-specific reset policy is applied.',
        ],
      } satisfies CreateNextSeasonResult
    },
    { isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel },
  )
}

function renewalCompletionData(
  league: { id: string; settings: unknown; settingsSnapshotVersion: number | null },
  srcSeason: { id: string },
  destinationSeasonId: string,
  input: CreateNextSeasonInput,
  rosterCount: number,
  completionIdempotencyKey: string,
  completionEventId: string,
  completionAuditId: string,
) {
  return {
    nextSeasonId: destinationSeasonId,
    nextSeason: input.requestedSeason,
    priorSeasonId: srcSeason.id,
    sourceSeasonId: srcSeason.id,
    completedAt: new Date(),
    settingsSnapshot: league.settings as Prisma.InputJsonValue,
    settingsSnapshotVersion: league.settingsSnapshotVersion,
    rosterCount,
    managerAssignmentCount: rosterCount,
    completionIdempotencyKey,
    completionEventId,
    completionAuditId,
  }
}

function resultFromRenewal(
  renewal: { id: string; leagueId: string; nextSeasonId: string | null; nextSeason: number | null; rosterCount: number | null; managerAssignmentCount: number | null; completionEventId: string | null; completionAuditId: string | null; completionIdempotencyKey: string | null },
  input: CreateNextSeasonInput,
  status: 'already_created',
): CreateNextSeasonResult {
  return {
    sourceLeagueId: input.sourceLeagueId,
    sourceSeasonId: input.sourceSeasonId,
    destinationLeagueId: renewal.leagueId,
    destinationSeasonId: renewal.nextSeasonId ?? '',
    requestedSeason: renewal.nextSeason ?? input.requestedSeason,
    status,
    rosterCount: renewal.rosterCount ?? 0,
    managerAssignmentCount: renewal.managerAssignmentCount ?? 0,
    settingsSnapshotId: renewal.id,
    scoringSnapshotId: renewal.id,
    scheduleStatus: 'deferred',
    waiverStatus: 'initialized',
    draftStatus: 'deferred',
    eventId: renewal.completionEventId,
    auditId: renewal.completionAuditId,
    idempotencyKey: renewal.completionIdempotencyKey ?? input.idempotencyKey,
    limitations: ['Result returned from prior completion evidence (idempotent replay).'],
  }
}

function blockedResult(input: CreateNextSeasonInput, violationCodes: string[]): CreateNextSeasonResult {
  return {
    sourceLeagueId: input.sourceLeagueId,
    sourceSeasonId: input.sourceSeasonId,
    destinationLeagueId: '',
    destinationSeasonId: '',
    requestedSeason: input.requestedSeason,
    status: 'blocked',
    rosterCount: 0,
    managerAssignmentCount: 0,
    settingsSnapshotId: null,
    scoringSnapshotId: null,
    scheduleStatus: 'not_applicable',
    waiverStatus: 'not_applicable',
    draftStatus: 'not_applicable',
    eventId: null,
    auditId: null,
    idempotencyKey: input.idempotencyKey,
    limitations: violationCodes,
  }
}

function conflictResult(input: CreateNextSeasonInput, reason: string): CreateNextSeasonResult {
  return {
    sourceLeagueId: input.sourceLeagueId,
    sourceSeasonId: input.sourceSeasonId,
    destinationLeagueId: '',
    destinationSeasonId: '',
    requestedSeason: input.requestedSeason,
    status: 'conflict',
    rosterCount: 0,
    managerAssignmentCount: 0,
    settingsSnapshotId: null,
    scoringSnapshotId: null,
    scheduleStatus: 'not_applicable',
    waiverStatus: 'not_applicable',
    draftStatus: 'not_applicable',
    eventId: null,
    auditId: null,
    idempotencyKey: input.idempotencyKey,
    limitations: [reason],
  }
}
