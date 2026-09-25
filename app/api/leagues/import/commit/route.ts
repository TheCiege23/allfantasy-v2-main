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
import { ImportRunInFlightError, persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import {
  assertImportCommissioner,
  OPEN_READ_PROVIDERS,
  recordImportAttestation,
} from '@/lib/league-import/commissionerGate'
import { commissionerGateFailureResponse } from '@/lib/league-import/commissionerGateResponse'
import { redactAndCap } from '@/lib/security/redactSecrets'

/**
 * What the caller sees when something we did not anticipate throws.
 *
 * 🛑 AN UNCAUGHT THROW HERE USED TO BECOME AN EMPTY-BODY 500, and the import screen then showed
 * the browser's own parse error — "Failed to execute 'json' on 'Response': Unexpected end of JSON
 * input" — as if it were an explanation. Every branch of this route answers JSON; this makes the
 * unexpected one do the same, with a sentence a person can act on.
 *
 * "nothing was changed" is true of the source platform in every case (import never writes there),
 * and true of AllFantasy for any throw before the league row is created; after it, the idempotent
 * run record means pressing Import again resumes rather than duplicates.
 */
const IMPORT_FAILED_MESSAGE =
  'Import failed on our side — nothing was changed. Try again in a minute.'

/** Log line for an unexpected failure: the error's name and message, credentials and URLs removed. */
function describeUnexpectedImportError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  /* A provider fetch failure can carry the full request URL — and Rolling Insights puts its
     token in the query string. Drop URLs outright, then run the shared redactor. */
  return redactAndCap(raw.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]'), 500)
}

function mapImportCommitErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  /* The provider never answered — a retry is worth making, so this must not read as
     404 ("no such league", permanent) or 500 ("we are broken"). */
  if (code === 'PROVIDER_UNAVAILABLE') return 503
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
  return 500
}

/* The gate-refusal status mapping (404 / 429 / 503 / 403) lives in
   `lib/league-import/commissionerGateResponse.ts`, shared with the two legacy import routes. */

export async function POST(req: NextRequest) {
  try {
    return await handleImportCommit(req)
  } catch (error) {
    console.error('[api/leagues/import/commit] unexpected failure:', describeUnexpectedImportError(error))
    return NextResponse.json({ error: IMPORT_FAILED_MESSAGE, code: 'IMPORT_FAILED' }, { status: 500 })
  }
}

async function handleImportCommit(req: NextRequest): Promise<Response> {
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
    /**
     * The team the importer says is theirs, for a provider that cannot tell us (Fleaflicker, and
     * Fantrax without a stored Secret ID). A `source_team_id` from the preview's `managers`.
     *
     * 🛑 DELIBERATELY NOT `importerSourceManagerId`. That value is PROVIDER-PROVEN and also lets
     * `claimExistingLeagueForMember` attach the caller to ANOTHER account's league. A team someone
     * picked from a list proves nothing, so it is validated against this league's own rosters and
     * only ever claims a team in the league row this request creates or already owns.
     */
    claimSourceTeamId?: string
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
    return commissionerGateFailureResponse(gate)
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

  /*
   * The self-identified team, accepted only where nothing better exists: an OPEN_READ provider
   * whose gate proved no identity of its own. Where the provider DID say which team is the
   * caller's, a client-picked one must not compete with it.
   */
  const claimSourceTeamId =
    typeof body.claimSourceTeamId === 'string' ? body.claimSourceTeamId.trim() : ''
  if (claimSourceTeamId) {
    if (!OPEN_READ_PROVIDERS.includes(provider) || gate.sourceManagerId) {
      return NextResponse.json(
        {
          error: 'Choosing your team is not needed for this league — we already know which team is yours.',
          code: 'CLAIM_TEAM_NOT_ACCEPTED',
        },
        { status: 400 },
      )
    }
    const known = result.normalized.rosters.some(
      (r) => String(r.source_team_id) === claimSourceTeamId,
    )
    if (!known) {
      return NextResponse.json(
        {
          error: 'That team is not in this league. Go back and pick your team again.',
          code: 'CLAIM_TEAM_NOT_IN_LEAGUE',
        },
        { status: 400 },
      )
    }
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
      /* Validated above against this league's rosters; feeds ONLY the bootstrap's claim on the
         importer's own league row — never the cross-account join. */
      importerSourceTeamId: claimSourceTeamId || null,
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
    if (error instanceof ImportRunInFlightError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'IMPORT_IN_PROGRESS',
          hint: 'Wait a moment and try again.',
        },
        { status: 409 },
      )
    }
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
