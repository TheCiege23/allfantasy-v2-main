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
import { assertImportCommissioner, recordImportAttestation } from '@/lib/league-import/commissionerGate'

function mapImportCommitErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
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
    attestation?: { accepted?: boolean; statement?: string }
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
      ? { accepted: true, statement: body.attestation.statement }
      : undefined,
  })
  if (!gate.ok) {
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
    const { persisted, runId } = await persistImportWithCanonicalAudit({
      userId: auth.userId,
      provider,
      normalized: result.normalized,
      canonical,
      allowUpdateExisting: Boolean(body.force),
    })

    // Stamp the attestation on the new league so the gate is auditable.
    if (gate.verification === 'attestation' && body.attestation?.accepted) {
      void recordImportAttestation({
        leagueId: persisted.league.id,
        appUserId: auth.userId,
        provider,
        sourceLeagueId: sourceId,
        attestation: { accepted: true, statement: body.attestation.statement },
      }).catch(() => {})
    }

    /*
     * ⚠ `existed` WAS COMPUTED AND THEN DROPPED HERE, AND IT IS THE WHOLE ANSWER
     * TO "WHY DID MY IMPORT DO NOTHING". `persistImportWithCanonicalAudit`
     * short-circuits on the import idempotency key: a previously-completed run
     * for (user, provider, sourceLeagueId, season) returns `existed: true` and
     * never reaches `persistImportedLeagueFromNormalization`, so it never throws
     * `ImportedLeagueConflictError` and never 409s. The route then answered 200
     * with no way to tell the two apart, and the bulk importer maps any `res.ok`
     * to "Imported".
     *
     * Measured on production 2026-08-20: a bulk run over 55 discovered Sleeper
     * leagues reported "33 imported", every one of which was already present —
     * the account's league count did not move, because nothing was imported.
     * The 409/"Already imported" path is unreachable for anything imported once
     * before, which is precisely the case a re-run hits.
     */
    return NextResponse.json({
      leagueId: persisted.league.id,
      name: persisted.league.name,
      sport: persisted.league.sport,
      league: persisted.league,
      historicalBackfill: persisted.historicalBackfill,
      importRunId: runId,
      existed: persisted.existed === true,
    })
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
