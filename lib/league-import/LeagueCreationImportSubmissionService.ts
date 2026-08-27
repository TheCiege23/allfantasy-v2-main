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
   * True when the commit was an idempotent replay — the league was already
   * imported and nothing was written. Distinct from `ok: false, status: 409`,
   * which only fires for a league that has never completed an import run.
   */
  existed?: boolean;
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
   * No AGE_REQUIRED mapping. That code is emitted only by the brackets product
   * (app/api/bracket/**), where an 18+ check gates paid contest entry and is a
   * real control worth keeping. No import endpoint returns it, so mapping it here
   * only ever promised the user an age problem they did not have -- and told them
   * to fix it on a screen that has never checked their age.
   *
   * If an import gate ever genuinely needs an age check, add it server-side first
   * and map it back here; do not reintroduce the message on its own.
   */
  if (data?.error === 'UNAUTHENTICATED' || data?.error === 'Unauthorized') return 'Sign in to import a league.';
  if (data?.error?.includes('Connect Yahoo')) return 'Connect Yahoo in League Sync before importing from Yahoo.';
  if (data?.error?.includes('Connect ESPN')) return 'Connect ESPN in League Sync before importing private ESPN leagues.';
  if (data?.error?.includes('saved ESPN cookies')) return 'Reconnect ESPN in League Sync, then try importing again.';
  if (data?.error?.includes('MFL API key')) return 'Save your MFL API key in League Sync before importing from MyFantasyLeague.';
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

export async function fetchImportPreview(
  provider: ImportProvider,
  sourceInput: string,
  attestation?: CommissionerAttestation
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
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: getImportApiErrorMessage(data, 'Failed to load league'),
        status: res.status,
        requiresAttestation: Boolean((data as { requiresAttestation?: boolean })?.requiresAttestation),
      };
    }
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
  options?: { force?: boolean }
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
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: getImportApiErrorMessage(data, 'Failed to create league'),
        status: res.status,
        requiresAttestation: Boolean((data as { requiresAttestation?: boolean })?.requiresAttestation),
      };
    }
    /*
     * `existed` distinguishes a real import from an idempotent replay. The commit
     * route 200s for both — see its own note — so without this the bulk importer
     * reports "Imported" for leagues where nothing happened.
     */
    return { ok: true, data, existed: Boolean((data as { existed?: boolean })?.existed) };
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
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: getImportApiErrorMessage(data, 'Failed to discover leagues'),
        status: res.status,
      };
    }
    return { ok: true, data };
  } catch (e) {
    const message = importRequestErrorMessage(e);
    return { ok: false, error: message };
  }
}
