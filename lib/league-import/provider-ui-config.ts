/**
 * Client-safe config for import provider UI: which providers to show and which are wired end-to-end.
 *
 * `available` means "a real, logged-in user can select this in ImportProviderSelector and
 * successfully complete an import today" — it is a product/UX-readiness signal, not a backend
 * registration check. hasFullAdapter() (LeagueImportRegistry.ts) answers a narrower, structural
 * question ("is an adapter class registered") that is true for every provider below regardless of
 * `available` here, so it cannot serve as a sync check for this list. See
 * docs/redraft/G61_IMPORT_PROVIDER_AVAILABILITY_RECONCILIATION.md for the audit behind the current
 * values, and __tests__/league-import/provider-availability-reconciliation.test.ts, which fails
 * loudly if this list drifts from that audit without a conscious update.
 */

import type { ImportProvider } from './types';

export const IMPORT_PROVIDER_UI_OPTIONS: {
  provider: ImportProvider;
  label: string;
  /** True if preview + create-from-import are implemented AND reachable/working end-to-end for a real user today. */
  available: boolean;
  /** True if the import UI can discover leagues from an account identifier. */
  supportsDiscovery?: boolean;
  /** Sports proven by the provider fetch/normalization source path. */
  supportedSports: readonly ('NFL' | 'NCAAF')[];
}[] = [
  { provider: 'sleeper', label: 'Sleeper', available: true, supportsDiscovery: true, supportedSports: ['NFL'] },
  { provider: 'espn', label: 'ESPN', available: true, supportedSports: ['NFL'] },
  // yahoo: FALSE because YAHOO refuses the app, not because anything here is unfinished.
  //
  // The OAuth round-trip is correct and verified end to end in production on 2026-08-20:
  // redirect_uri registered and matching, `fspt-r` requested, token exchange SUCCEEDS. The
  // very next call, GET /fantasy/v2/users;use_login=1, comes back:
  //     "This application is not authorized to perform this action."
  //
  // Everything on our side of that line was eliminated one at a time:
  //   - client id / secret / redirect_uri — proven correct, because the token exchange passed
  //   - a stale grant predating the permission — the grant was revoked and re-approved, with a
  //     consent screen shown (a 25-second round trip, versus the 1-second silent replays
  //     before it). Fresh token, identical refusal.
  //   - the app's own API permission — "Fantasy Sports - Read" is ticked and persists a reload
  //
  // So this is Yahoo declining to grant the app fantasy access. Leaving it selectable meant
  // every user who picked Yahoo hit a guaranteed dead end, which is worse than saying plainly
  // that we cannot offer it.
  //
  // ⚠ KEEP THE CODE. It is correct and tested. If Yahoo ever approves the app this is a flag
  // flip, not a rebuild — do not delete lib/yahoo/** or the callback on the assumption it is
  // dead.
  { provider: 'yahoo', label: 'Yahoo', available: false, supportsDiscovery: true, supportedSports: ['NFL'] },
  // fantrax: STILL false, but the stated reason is out of date — corrected here so the
  // next person does not re-diagnose a bug that was already fixed.
  //
  // The note read "appUserId is never stamped by the upload route". It is stamped now:
  // server/api-route-modules/legacy/fantrax/route.ts sets `appUserId: auth.userId` in BOTH
  // upsert branches, and requireVerifiedUser() returns session.user.id — the same id the
  // import gate compares against via fetchFantraxLeagueForImport(session.user.id, …). So a
  // fresh upload is no longer orphaned, and the gate (which still fails closed on a null or
  // foreign appUserId) should no longer reject its own uploads.
  //
  // Verified live 2026-08-20: BOTH routes exist and answer 401 (auth required), not 404 —
  // POST /api/legacy/fantrax (dispatched from app/api/legacy/[...path]/route.ts, pattern
  // ["fantrax"]) and POST /api/league/import/fantrax/preview. A working multi-CSV upload UI
  // also already exists, on app/af-legacy/page.tsx. So the pipeline is reachable today; the
  // old reason "upload pipeline is not accepting new leagues" was wrong on both counts.
  //
  // What is NOT yet done, and is what this flag is waiting on:
  //   1. an end-to-end run — upload a CSV as a real account, then import it — which is the
  //      bar the reconciliation guard sets, deliberately, because "the adapter is registered"
  //      was true for three providers while they were unusable.
  //   2. ImportV4 has no FIELD_BY_PROVIDER entry for fantrax and it does not support
  //      discovery, so selecting it today renders neither a field nor a discover button:
  //      selectable and impossible to finish. The field needs adding WITH the flip, not after.
  //      ⚠ And it cannot be a text field: this provider takes UPLOADED CSV EXPORTS, so the
  //      flip needs a file input, not the one-line entry the other providers use.
  { provider: 'fantrax', label: 'Fantrax', available: false, supportedSports: ['NFL', 'NCAAF'] },
  // mfl: real adapter, but no credential-entry UI exists anywhere for the API key a private league needs.
  { provider: 'mfl', label: 'MyFantasyLeague (MFL)', available: false, supportedSports: ['NFL'] },
  // fleaflicker: real adapter, but no confirmed reachable path in the main import flow (only an
  // orphaned, unlinked page) — see the G61 doc for what's unresolved.
  { provider: 'fleaflicker', label: 'Fleaflicker', available: false, supportedSports: ['NFL'] },
];

export function getImportProviderLabel(provider: ImportProvider): string {
  return IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === provider)?.label ?? provider;
}

export function isImportProviderAvailable(provider: ImportProvider): boolean {
  return IMPORT_PROVIDER_UI_OPTIONS.some((o) => o.provider === provider && o.available);
}

export function supportsImportProviderDiscovery(provider: ImportProvider): boolean {
  return IMPORT_PROVIDER_UI_OPTIONS.some(
    (o) => o.provider === provider && o.available && o.supportsDiscovery === true,
  );
}

export function getImportProviderSupportedSports(provider: ImportProvider): readonly ('NFL' | 'NCAAF')[] {
  return IMPORT_PROVIDER_UI_OPTIONS.find((option) => option.provider === provider)?.supportedSports ?? [];
}
