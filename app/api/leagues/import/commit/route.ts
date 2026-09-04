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
import {
  ImportedLeagueConflictError,
  ImportedLeagueTombstonedError,
} from '@/lib/league-import/ImportedLeagueCommitService'
import { persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { assertImportCommissioner, recordImportAttestation } from '@/lib/league-import/commissionerGate'

function mapImportCommitErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  /* The provider never answered — a retry is worth making, so this must not read as
     404 ("no such league", permanent) or 500 ("we are broken"). */
  if (code === 'PROVIDER_UNAVAILABLE') return 503
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
  return 500
}

/**
 * The gate's own failure, mapped to a real HTTP status instead of the flat 403 every
 * `!gate.ok` used to get.
 *
 * 🛑 `CommissionerGateResult.notFound`'S OWN DOC COMMENT ALREADY SAID "maps to 404, not
 * 403" — nothing ever read it here. Every gate rejection answered 403 regardless of
 * cause, so a league that does not exist, a league Sleeper is rate-limiting us on right
 * now, and a genuine "you are not this league's commissioner" all produced the identical
 * response shape. A bulk run over many leagues needs exactly this distinction: a 429 on
 * one league is a signal to slow the whole run down, a 404 never resolves on retry, and
 * neither is the caller lacking permission.
 *
 * Mirrors the two lines directly above for the SAME reasoning, applied to the gate's
 * result instead of the normalization pipeline's `code` — 404 for "does not exist", 503
 * for "the provider itself is unavailable" (5xx is bucketed with 429 here: both mean
 * "their side, retry later", and REST convention reserves 429 for the rate-limit case
 * specifically, so it passes through as its own number rather than being folded into
 * 503). Everything else this function has never had a status for (not-linked, not-a-
 * member, attestation-required) keeps the 403 it already had — this only corrects the
 * two cases that were provably wrong, not every judgement call in the file.
 */
function mapGateFailureStatus(gate: { notFound?: boolean; status?: number | null }): number {
  if (gate.notFound) return 404
  if (gate.status === 429) return 429
  if (gate.status != null && gate.status >= 500) return 503
  return 403
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
    /**
     * When true, import a league this user previously DELETED, instead of
     * returning 409 `LEAGUE_PREVIOUSLY_DELETED`.
     *
     * ⚠ Deliberately not folded into `force`. `force` overwrites a league they
     * still have; this undoes a deletion. A client setting `force` for its own
     * reasons must not silently resurrect something the user threw away.
     */
    confirmReimportOfDeleted?: boolean
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
        code: gate.requiresAttestation
          ? 'ATTESTATION_REQUIRED'
          : gate.notFound
            ? 'LEAGUE_NOT_FOUND'
            : gate.status === 429 || (gate.status != null && gate.status >= 500)
              ? 'PROVIDER_UNAVAILABLE'
              : 'NOT_COMMISSIONER',
        requiresAttestation: gate.requiresAttestation ?? false,
      },
      { status: mapGateFailureStatus(gate) },
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
    const { persisted, runId, skipped } = await persistImportWithCanonicalAudit({
      userId: auth.userId,
      provider,
      normalized: result.normalized,
      canonical,
      allowUpdateExisting: Boolean(body.force),
      /*
       * The user saw "you deleted this before" and said yes.
       *
       * ⚠ NOT folded into `body.force`. `force` means "overwrite the league I
       * already have"; this means "bring back one I threw away". They are
       * different questions with different prompts, and a client that set
       * `force` for an unrelated reason must not silently also undo a deletion.
       */
      confirmReimportOfDeleted: Boolean(body.confirmReimportOfDeleted),
      /*
       * The gate resolved this on the way in — it has to, to decide whether this
       * caller may import at all — and it was dropped here. That is why every
       * non-Sleeper import landed with no claimed team and went invisible.
       */
      importerSourceManagerId: gate.sourceManagerId ?? null,
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
      /*
       * ⚠ NOT THE SAME QUESTION AS `existed`. `existed` means this account already ran this
       * exact import before. `joinedExisting` means a DIFFERENT account did, and this request
       * proved real membership (the commissioner gate's own manager id, not a claim the user
       * typed in) and was attached to that league's own team rather than getting a duplicate.
       * The UI must not say "your league has been imported" for this case — see
       * `claimExistingLeagueForMember` in ImportedLeagueCommitService.
       */
      joinedExisting: persisted.joinedExisting === true,
      /*
       * ⚠ WHAT DID NOT FINISH, SO "Imported" STOPS BEING AN UNQUALIFIED CLAIM.
       *
       * Every post-create bootstrap step is deliberately non-fatal — failing a whole import
       * because a playoff default could not be written would throw away a league that is
       * otherwise fine. But the swallow used to be total: a run where
       * `bootstrapLeagueFromImport` threw still answered 200 with a league id, and the user
       * got an empty league with no rosters and no explanation.
       *
       * Empty array = every step completed. Non-empty is NOT a failed import — the league is
       * real and the affected step is cheap to re-run — it is the statement of what is
       * missing that this response could not previously make.
       */
      incompleteSteps: persisted.incompleteSteps ?? [],
      /* Whether this request actually re-read the provider, or matched a completed run
         and returned it untouched. `existed` cannot answer that — see the persistence
         service. */
      skipped: skipped === true,
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
    /*
     * The user deleted this league before. Not an error state to recover from —
     * an offer, which is why it carries the identity and the original name back
     * so the client can name the league in its confirmation prompt.
     *
     * ⚠ A SEPARATE CODE FROM `LEAGUE_ALREADY_IMPORTED`, and the two must not be
     * merged. They are opposites: one means the league is already on the
     * dashboard, the other means it is deliberately absent. A client that showed
     * "you already have this league" for a tombstone would be telling the user
     * to go open something they cannot see.
     */
    if (error instanceof ImportedLeagueTombstonedError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'LEAGUE_PREVIOUSLY_DELETED',
          hint: 'Re-send this import with confirmReimportOfDeleted: true to bring it back.',
          tombstone: {
            platform: error.tombstone.platform,
            platformLeagueId: error.tombstone.platformLeagueId,
            leagueName: error.tombstone.leagueName,
            deletedAt: error.tombstone.deletedAt?.toISOString() ?? null,
          },
        },
        { status: 409 },
      )
    }
    throw error
  }
}
