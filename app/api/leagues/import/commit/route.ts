/**
 * POST /api/leagues/import/commit
 *
 * Unified import commit: deterministic (no AI). Accepts provider + sourceId,
 * runs same normalization as preview, creates League and bootstraps rosters,
 * scoring (in settings), draft/waiver/playoff/schedule. Returns new league id/name/sport.
 *
 * Body: { provider: 'sleeper', sourceId: string }
 * Returns: { leagueId: string, name: string, sport: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { ImportedLeagueConflictError } from '@/lib/league-import/ImportedLeagueCommitService'
import { persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { assertImportCommissioner, recordImportAttestation, recordCommissionerVerificationMethod } from '@/lib/league-import/commissionerGate'
import {
  runSleeperImportValidation,
  toImportWarningRecords,
  type SleeperImportValidationResult,
} from '@/lib/league-import/sleeper/SleeperImportValidation'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

function mapImportCommitErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
  if (code === 'NORMALIZATION_FAILED') return 422
  return 500
}

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  let body: {
    provider?: string
    sourceId?: string
    attestation?: {
      accepted?: boolean
      statement?: string
      confirmedProvider?: string
      confirmedSourceLeagueId?: string
    }
    /** When true, re-import over an existing league instead of returning 409. */
    force?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const provider = resolveProvider(body.provider ?? '')
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''

  if (!sourceId) {
    return NextResponse.json({ error: 'sourceId is required' }, { status: 400 })
  }

  if (!provider) {
    return NextResponse.json({ error: 'Unsupported import provider' }, { status: 400 })
  }

  if (!isImportProviderAvailable(provider)) {
    return NextResponse.json(
      { error: `Import from ${provider} is not yet available.` },
      { status: 400 }
    )
  }

  // Only the commissioner/co-commissioner of the source league may import.
  const gate = await assertImportCommissioner({
    appUserId: auth.userId,
    provider,
    sourceLeagueId: sourceId,
    // Phase 2.2: committing a full (playable) league is commissioner-only. Enforced for
    // providers where commissioner status is determinable (Sleeper); no-op for others.
    requireCommissioner: true,
    attestation: body.attestation?.accepted
      ? {
          accepted: true,
          statement: body.attestation.statement,
          confirmedProvider: resolveProvider(body.attestation.confirmedProvider ?? '') ?? undefined,
          confirmedSourceLeagueId: body.attestation.confirmedSourceLeagueId,
        }
      : undefined,
  })
  if (!gate.ok) {
    if (gate.notFound) {
      return NextResponse.json(
        { error: gate.reason ?? 'League not found.', code: 'LEAGUE_NOT_FOUND' },
        { status: 404 },
      )
    }
    return NextResponse.json(
      {
        error: gate.reason ?? 'Commissioner verification failed.',
        code: gate.requiresAttestation ? 'ATTESTATION_REQUIRED' : 'NOT_COMMISSIONER',
        requiresAttestation: gate.requiresAttestation ?? false,
      },
      { status: 403 },
    )
  }

  const result = await runImportedLeagueNormalizationPipeline({
    provider,
    sourceId,
    userId: auth.userId,
  })
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: mapImportCommitErrorStatus(result.code) }
    )
  }

  try {
    const canonical = buildCanonicalImportBundle(result.normalized)
    let validation: SleeperImportValidationResult | undefined
    if (provider === 'sleeper') {
      try {
        validation = await runSleeperImportValidation(result.rawPayload as SleeperImportPayload, auth.userId)
      } catch (validationError) {
        console.warn('[import commit] Sleeper validation failed (import still proceeds):', validationError)
      }
    }
    const additionalWarnings = validation ? toImportWarningRecords(validation.findings) : undefined
    const { persisted, runId } = await persistImportWithCanonicalAudit({
      userId: auth.userId,
      provider,
      normalized: result.normalized,
      canonical,
      allowUpdateExisting: Boolean(body.force),
      additionalWarnings,
    })

    // Stamp the attestation on the new league so the gate is auditable.
    if (gate.verification === 'attestation' && body.attestation?.accepted) {
      void recordImportAttestation({
        leagueId: persisted.league.id,
        appUserId: auth.userId,
        provider,
        sourceLeagueId: sourceId,
        attestation: { accepted: true, statement: body.attestation.statement },
        importRunId: runId,
      }).catch(() => {})
    }

    // Import Security Closure phase (Part 10) — always record how
    // commissioner status was established, not just when it was an
    // attestation. Every full-league commit answers "provider-verified" vs
    // "user-attested" vs "no commissioner claim required" from this one
    // durable field, without inferring it from other data.
    void recordCommissionerVerificationMethod({
      leagueId: persisted.league.id,
      appUserId: auth.userId,
      provider,
      sourceLeagueId: sourceId,
      method: gate.verification === 'attestation' ? 'attestation' : gate.verification === 'api' ? 'api' : 'membership-only',
      sourceManagerId: gate.sourceManagerId,
      importRunId: runId,
    }).catch(() => {})

    return NextResponse.json(
      {
        leagueId: persisted.league.id,
        name: persisted.league.name,
        sport: persisted.league.sport,
        league: persisted.league,
        historicalBackfill: persisted.historicalBackfill,
        importRunId: runId,
        replayed: Boolean(persisted.existed),
        validation,
      },
      { status: persisted.existed ? 200 : 201 },
    )
  } catch (error) {
    if (error instanceof ImportedLeagueConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'LEAGUE_ALREADY_IMPORTED',
          hint: 'Open the existing league or use League Sync to refresh it instead of re-importing.',
        },
        { status: 409 },
      )
    }
    throw error
  }
}
