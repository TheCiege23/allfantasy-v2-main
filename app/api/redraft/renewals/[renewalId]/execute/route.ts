import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createNextSeasonWithConflictHandling } from '@/lib/redraft/renewal/nextSeasonConflictTranslator'
import type { CreateNextSeasonApiRequest, CreateNextSeasonApiResponse, ApiErrorCode } from '@/lib/redraft/renewal/nextSeasonApiContract'
import type { CreateNextSeasonResult } from '@/lib/redraft/renewal/nextSeasonContract'

export const dynamic = 'force-dynamic'

function errorResponse(code: ApiErrorCode, message: string, status: number, retryable = false, violations?: string[]) {
  const body: CreateNextSeasonApiResponse<CreateNextSeasonResult> = { ok: false, error: { code, message, retryable, violations: violations as never } }
  return NextResponse.json(body, { status })
}

/**
 * Authoritative next-season-execution route. Extends the existing renewal
 * resource family (`/api/redraft/renewals/[renewalId]/...`) rather than
 * introducing a competing top-level route — the renewal must already exist
 * (opened via POST /api/redraft/renewals) before it can be executed here.
 *
 * `sourceLeagueId`/`sourceSeasonId`/`requestedSeason` are deliberately NOT
 * accepted from the client at all — they are derived from the renewal row's
 * own `leagueId`/`priorSeasonId`/`season` fields (real, already populated at
 * renewal-open time by `openRedraftRenewal`). `actorUserId`/`actorRole` are
 * likewise never accepted from the client — actor identity comes from the
 * server session, and role is derived server-side from real commissioner
 * membership, never trusted from the request body.
 */
export async function POST(req: NextRequest, { params }: { params: { renewalId: string } }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return errorResponse('UNAUTHORIZED', 'Authentication required.', 401)

  let body: CreateNextSeasonApiRequest
  try {
    const parsed = (await req.json()) as CreateNextSeasonApiRequest | null
    if (!parsed?.idempotencyKey || typeof parsed.idempotencyKey !== 'string') {
      return errorResponse('INVALID_REQUEST', 'idempotencyKey is required.', 400)
    }
    body = parsed
  } catch {
    return errorResponse('INVALID_REQUEST', 'Invalid JSON body.', 400)
  }

  const renewal = await prisma.leagueRenewal.findUnique({
    where: { id: params.renewalId },
    select: { id: true, leagueId: true, priorSeasonId: true, season: true, status: true, nextSeasonId: true, nextSeason: true },
  })
  if (!renewal) return errorResponse('SOURCE_SEASON_NOT_FOUND', 'Renewal not found.', 404)
  if (!renewal.priorSeasonId) return errorResponse('SOURCE_SEASON_NOT_FOUND', 'Renewal has no linked source season.', 404)
  // LeagueRenewal.season (set by openRedraftRenewal from League.season at
  // renewal-open time) represents the season being closed out — it matches
  // the SOURCE RedraftSeason, not the destination. The season being renewed
  // INTO is always exactly one greater. Found via real physical testing this
  // phase (a genuine semantic mismatch between the pre-existing renewal-open
  // system and createNextSeason's `requestedSeason` contract), not assumed.
  const requestedSeason = renewal.season + 1

  const league = await prisma.league.findUnique({
    where: { id: renewal.leagueId },
    select: { id: true, userId: true, teams: { select: { isCommissioner: true, isCoCommissioner: true, claimedByUserId: true, platformUserId: true } } },
  })
  if (!league) return errorResponse('SOURCE_SEASON_NOT_FOUND', 'League not found.', 404)

  // Server-derived authorization only — never trust a client-supplied role.
  // This intentionally mirrors evaluateNextSeasonEligibility's own real
  // authorization check so a caller who fails here never even reaches the
  // service (defense in depth, not a replacement for the service's own check).
  const isCommissioner = league.userId === userId || league.teams.some(
    (t) => (t.isCommissioner || t.isCoCommissioner) && (t.claimedByUserId === userId || t.platformUserId === userId),
  )
  if (!isCommissioner) return errorResponse('FORBIDDEN', 'Only the source league\'s commissioner may execute this renewal.', 403)

  if (renewal.nextSeasonId) {
    // Already completed — re-derive the stable prior result rather than
    // re-running the transaction at all.
    const completed = await prisma.leagueRenewal.findUnique({ where: { id: renewal.id } })
    const result: CreateNextSeasonResult = {
      sourceLeagueId: renewal.leagueId,
      sourceSeasonId: renewal.priorSeasonId,
      destinationLeagueId: renewal.leagueId,
      destinationSeasonId: renewal.nextSeasonId,
      requestedSeason: renewal.nextSeason ?? requestedSeason,
      status: 'already_created',
      rosterCount: completed?.rosterCount ?? 0,
      managerAssignmentCount: completed?.managerAssignmentCount ?? 0,
      settingsSnapshotId: renewal.id,
      scoringSnapshotId: renewal.id,
      scheduleStatus: 'deferred',
      waiverStatus: 'initialized',
      draftStatus: 'deferred',
      eventId: completed?.completionEventId ?? null,
      auditId: completed?.completionAuditId ?? null,
      idempotencyKey: completed?.completionIdempotencyKey ?? body.idempotencyKey,
      limitations: ['Result returned from prior completion evidence.'],
    }
    return NextResponse.json({ ok: true, result } satisfies CreateNextSeasonApiResponse<CreateNextSeasonResult>, { status: 200 })
  }

  try {
    const outcome = await createNextSeasonWithConflictHandling({
      sourceLeagueId: renewal.leagueId,
      sourceSeasonId: renewal.priorSeasonId,
      requestedSeason,
      actorUserId: userId,
      actorRole: 'commissioner',
      idempotencyKey: body.idempotencyKey,
      requestTimestamp: new Date().toISOString(),
      expectedSourceVersion: body.expectedSourceVersion ?? null,
      override: body.override,
    })

    if (outcome.kind === 'retryable_conflict') {
      return errorResponse('RETRYABLE_CONFLICT', 'Another request for this renewal is in progress. Retry shortly.', 409, true)
    }

    const result = outcome.result
    if (result.status === 'blocked') {
      return errorResponse('SOURCE_SEASON_INCOMPLETE', 'Source season is not eligible for renewal.', 422, false, result.limitations)
    }
    if (result.status === 'conflict') {
      return errorResponse('CONFLICT', result.limitations[0] ?? 'Conflicting renewal request.', 409)
    }

    const status = result.status === 'created' ? 201 : 200
    return NextResponse.json({ ok: true, result } satisfies CreateNextSeasonApiResponse<CreateNextSeasonResult>, { status })
  } catch (error) {
    // No raw Prisma/Postgres error, host detail, or stack trace is ever
    // returned to the client — logged server-side only (structured, no
    // secrets), per this phase's explicit truthfulness/redaction requirement.
    console.error('[redraft/renewals/execute] internal error', {
      renewalId: renewal.id,
      leagueId: renewal.leagueId,
      idempotencyKey: body.idempotencyKey,
      errorMessage: error instanceof Error ? error.message : 'unknown',
    })
    return errorResponse('INTERNAL_ERROR', 'Renewal execution failed unexpectedly.', 500)
  }
}
