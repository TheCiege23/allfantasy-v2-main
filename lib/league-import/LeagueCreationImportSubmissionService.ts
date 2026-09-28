/**
 * Client-side service for league creation import: preview fetch and create-from-import submit.
 */

import { isImportProviderAvailable } from './provider-ui-config';
import type { ImportProvider } from './types';

export interface CommissionerAttestation {
  accepted: boolean;
  statement?: string;
}

/**
 * Commissioner Import Attestation UI phase — the wire shape sent to the
 * server, always stamped with the CURRENT request's own `provider`/
 * `sourceInput` (never caller-supplied) so a stale attestation object from a
 * previous league/provider selection can never be silently reused — see
 * `attestationMatchesThisRequest` in `commissionerGate.ts`, which rejects a
 * mismatch server-side.
 */
function toWireAttestation(
  provider: ImportProvider,
  sourceInput: string,
  attestation: CommissionerAttestation
): CommissionerAttestation & { confirmedProvider: ImportProvider; confirmedSourceLeagueId: string } {
  return {
    ...attestation,
    confirmedProvider: provider,
    confirmedSourceLeagueId: sourceInput.trim(),
  };
}

export interface FetchPreviewResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
  /** True when the provider can't be auto-verified; caller must resubmit with an attestation. */
  requiresAttestation?: boolean;
}

export interface SubmitImportResult {
  ok: boolean;
  data?: { league: { id: string; name: string; sport: string } };
  error?: string;
  status?: number;
  requiresAttestation?: boolean;
  /**
   * The server's own classification of a failure — 'LEAGUE_NOT_FOUND',
   * 'PROVIDER_UNAVAILABLE', 'ATTESTATION_REQUIRED', 'NOT_COMMISSIONER',
   * 'UNAUTHORIZED', 'CONNECTION_REQUIRED' — from `mapImportCommitErrorStatus` /
   * `mapGateFailureStatus` (lib/league-import/commissionerGateResponse.ts). Read THIS, not `status`, to decide
   * what a failure means: `status` is the HTTP number (429 today; may be 503 for a
   * provider 5xx), and re-deriving "which numbers mean provider-unavailable" on the
   * client would be a second copy of a rule the server already owns — exactly the
   * two-implementations-of-one-rule shape this repo has been bitten by before.
   */
  code?: string;
  /**
   * True when the commit was an idempotent replay — the league was already
   * imported and nothing was written. Distinct from `ok: false, status: 409`,
   * which only fires for a league that has never completed an import run.
   */
  existed?: boolean;
  /**
   * True when this request attached the caller to a league ANOTHER account already
   * imported, rather than creating a new one. See `claimExistingLeagueForMember` in
   * ImportedLeagueCommitService. Distinct from `existed`, which means THIS account
   * already ran this exact import.
   */
  joinedExisting?: boolean;
}

export interface DiscoverProviderLeaguesResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

function getImportApiErrorMessage(
  data: { error?: string } | null | undefined,
  fallback: string
): string {
  if (data?.error === 'VERIFICATION_REQUIRED') return 'Verify your email or phone before importing a league.';
  /*
   * ⚠ AGE_REQUIRED IS MAPPED AGAIN, AND THE COMMENT THAT REMOVED IT WAS WRONG.
   * It read: "That code is emitted only by the brackets product (app/api/bracket/**)
   * … No import endpoint returns it." Observed otherwise on 2026-08-29, running a
   * real Sleeper import against staging: POST /api/leagues/import/discover answered
   * 403 {"error":"AGE_REQUIRED"} three times, and the screen rendered the raw enum
   * as the user's error message.
   *
   * The source is `lib/auth-guard.ts` — `isAgeConfirmed(profile)` is false whenever
   * `profile.ageConfirmedAt` is null, and the shared guard the import routes use
   * returns AGE_REQUIRED at 403 (auth-guard.ts:182 and :247). That is a server-side
   * gate on the import path, which is exactly the condition the old comment set for
   * restoring this ("add it server-side first and map it back here") — it simply had
   * not noticed the gate was already there.
   *
   * /verify is the right destination: `lib/require-verified.ts` redirects to
   * `/verify?error=AGE_REQUIRED` for the same condition, so the two paths now agree.
   */
  if (data?.error === 'AGE_REQUIRED') {
    return 'Confirm your date of birth before importing a league — you can do it on the verification screen.';
  }
  if (data?.error === 'UNAUTHENTICATED' || data?.error === 'Unauthorized') return 'Sign in to import a league.';
  if (data?.error?.includes('Connect Yahoo')) return 'Connect Yahoo in League Sync before importing from Yahoo.';
  if (data?.error?.includes('Connect ESPN')) return 'Connect ESPN in League Sync before importing private ESPN leagues.';
  if (data?.error?.includes('saved ESPN cookies')) return 'Reconnect ESPN in League Sync, then try importing again.';
  if (data?.error?.includes('MFL API key')) return 'Save your MFL API key under Settings → Connected Accounts before importing from MyFantasyLeague.';
  return data?.error ?? fallback;
}

/**
 * Fetch import preview for the given provider and source input.
 */
/**
 * ⚠ A FETCH WITH NO TIMEOUT IS WHY "This is my team" HUNG FOREVER.
 *
 * `runPreview` in ImportV4 sets the row's phase to `previewing` and awaits this
 * call; that row's button renders "Reading…" and disables itself while the phase
 * holds. Nothing here ever aborted, so a provider that stalls — Fantrax reads
 * every team's roster, one request per team — left the row reading forever, with
 * no error, no recovery, and no way out but a page reload. Observed on a 12-team
 * Fantrax league.
 *
 * The bound belongs HERE rather than in the caller: all three import entry points
 * go through this module, and a timeout added per-caller is one somebody forgets
 * on the next one.
 *
 * 60s is deliberately generous — a real Fantrax league sweep is slow, and cutting
 * a working import short would be a worse bug than the hang. This is a backstop
 * against never returning, not a latency budget.
 */
const IMPORT_REQUEST_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An aborted request is not a "network error" — the user needs to know it was
 * still working and ran out of time, which implies a different next action.
 */
function importRequestErrorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return 'That league took too long to read. It may be a large league — try again.';
  }
  return e instanceof Error ? e.message : 'Network error';
}

/** Shown when the server answered with something that is not JSON — an empty 500, an HTML error page. */
export const IMPORT_SERVER_FAILURE_MESSAGE =
  'Import failed on our side — nothing was changed. Try again in a minute.';

/**
 * Read an import route's body without trusting it to be JSON.
 *
 * 🛑 `await res.json()` ON AN EMPTY 500 THROWS "Unexpected end of JSON input", and the catch below
 * used to hand THAT string to the screen as the user's error message. A proxy's HTML error page
 * does the same with "Unexpected token '<'". Neither is something a person can act on, and both
 * are what an import failure looked like whenever the server failed in a way it had not planned for.
 *
 * `null` means "there was no readable body" — the caller decides what to say, from the status.
 */
async function readImportResponseBody(res: Response): Promise<Record<string, unknown> | null> {
  /* A Response-like without `text()` (a partial test double) still gets the defensive read. */
  if (typeof res.text !== 'function') {
    try {
      const parsed: unknown = await res.json();
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The error for a failed response, falling back to a human sentence when the body was unreadable. */
function failedResponseMessage(
  data: Record<string, unknown> | null,
  status: number,
  fallback: string
): string {
  if (!data) return status >= 500 || status === 0 ? IMPORT_SERVER_FAILURE_MESSAGE : fallback;
  return getImportApiErrorMessage(data as { error?: string }, fallback);
}

export async function fetchImportPreview(
  provider: ImportProvider,
  sourceInput: string,
  attestation?: CommissionerAttestation,
  /**
   * `allowPreviewOnly`: accept a 200 carrying `importable: false`. Pass it only from a screen that
   * renders that state — a caller treating every 200 as ready-to-import must leave it off.
   */
  options?: { allowPreviewOnly?: boolean }
): Promise<FetchPreviewResult> {
  if (!isImportProviderAvailable(provider)) {
    return { ok: false, error: `Import from ${provider} is not yet available.` };
  }
  const trimmed = sourceInput?.trim();
  if (!trimmed) {
    return { ok: false, error: 'League ID is required.' };
  }

  try {
    const res = await fetchWithTimeout('/api/leagues/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        sourceId: trimmed,
        ...(attestation?.accepted ? { attestation: toWireAttestation(provider, trimmed, attestation) } : {}),
        ...(options?.allowPreviewOnly ? { allowPreviewOnly: true } : {}),
      }),
    });
    const data = await readImportResponseBody(res);
    if (!res.ok) {
      return {
        ok: false,
        error: failedResponseMessage(data, res.status, 'Failed to load league'),
        status: res.status,
        requiresAttestation: Boolean((data as { requiresAttestation?: boolean } | null)?.requiresAttestation),
      };
    }
    if (!data) return { ok: false, error: IMPORT_SERVER_FAILURE_MESSAGE, status: res.status };
    return { ok: true, data };
  } catch (e) {
    const message = importRequestErrorMessage(e);
    return { ok: false, error: message };
  }
}

/**
 * Submit create-from-import for the given provider and source input.
 */
export async function submitImportCreation(
  provider: ImportProvider,
  sourceInput: string,
  _userId: string,
  attestation?: CommissionerAttestation,
  options?: {
    force?: boolean
    /**
     * The user ticked a league they had previously deleted, which is the
     * confirmation the import route requires before undoing a deletion.
     *
     * ⚠ SEPARATE FROM `force`. `force` means "overwrite the league I already
     * have"; this means "bring back one I threw away". Folding them together
     * would let any caller that sets `force` for an unrelated reason silently
     * resurrect a deleted league.
     */
    confirmReimportOfDeleted?: boolean
    /**
     * The `source_team_id` the importer picked as theirs, for a provider that cannot say (Fleaflicker).
     * The server validates it against the league's rosters and uses it ONLY to claim that team.
     */
    claimSourceTeamId?: string
  }
): Promise<SubmitImportResult> {
  if (!isImportProviderAvailable(provider)) {
    return { ok: false, error: `Import from ${provider} is not yet available.` };
  }
  const trimmed = sourceInput?.trim();
  if (!trimmed) {
    return { ok: false, error: 'League ID is required.' };
  }

  try {
    const res = await fetchWithTimeout('/api/leagues/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        sourceId: trimmed,
        ...(attestation?.accepted ? { attestation: toWireAttestation(provider, trimmed, attestation) } : {}),
        ...(options?.force ? { force: true } : {}),
        ...(options?.confirmReimportOfDeleted ? { confirmReimportOfDeleted: true } : {}),
        ...(options?.claimSourceTeamId?.trim() ? { claimSourceTeamId: options.claimSourceTeamId.trim() } : {}),
      }),
    });
    const data = await readImportResponseBody(res);
    if (!res.ok) {
      return {
        ok: false,
        error: failedResponseMessage(data, res.status, 'Failed to create league'),
        status: res.status,
        requiresAttestation: Boolean((data as { requiresAttestation?: boolean } | null)?.requiresAttestation),
        code: (data as { code?: string } | null)?.code,
      };
    }
    if (!data) return { ok: false, error: IMPORT_SERVER_FAILURE_MESSAGE, status: res.status };
    /*
     * `existed` distinguishes a real import from an idempotent replay. The commit
     * route 200s for both — see its own note — so without this the bulk importer
     * reports "Imported" for leagues where nothing happened.
     */
    return {
      ok: true,
      data: data as unknown as SubmitImportResult['data'],
      existed: Boolean((data as { existed?: boolean })?.existed),
      joinedExisting: Boolean((data as { joinedExisting?: boolean })?.joinedExisting),
    };
  } catch (e) {
    const message = importRequestErrorMessage(e);
    return { ok: false, error: message };
  }
}

export async function discoverProviderLeagues(
  provider: ImportProvider,
  accountIdentifier: string,
  options?: { season?: string; sport?: string }
): Promise<DiscoverProviderLeaguesResult> {
  if (!isImportProviderAvailable(provider)) {
    return { ok: false, error: `Import from ${provider} is not yet available.` };
  }

  const trimmed = accountIdentifier?.trim();
  // Yahoo reads the CONNECTED Yahoo account (OAuth), Sleeper falls back to the
  // caller's own linked Sleeper account, and Fantrax reads the stored Secret ID —
  // none of the three needs an identifier typed here.
  if (!trimmed && provider !== 'yahoo' && provider !== 'sleeper' && provider !== 'fantrax') {
    return { ok: false, error: 'Account identifier is required.' };
  }

  try {
    const res = await fetchWithTimeout('/api/leagues/import/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        ...(trimmed ? { accountIdentifier: trimmed } : {}),
        ...(options?.season ? { season: options.season } : {}),
        ...(options?.sport ? { sport: options.sport } : {}),
      }),
    });
    const data = await readImportResponseBody(res);
    if (!res.ok) {
      return {
        ok: false,
        error: failedResponseMessage(data, res.status, 'Failed to discover leagues'),
        status: res.status,
      };
    }
    if (!data) return { ok: false, error: IMPORT_SERVER_FAILURE_MESSAGE, status: res.status };
    return { ok: true, data };
  } catch (e) {
    const message = importRequestErrorMessage(e);
    return { ok: false, error: message };
  }
}
