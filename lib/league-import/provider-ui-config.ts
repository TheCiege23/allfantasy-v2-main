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

/**
 * Why a provider is not selectable. Drives honest, provider-specific UI copy instead of a
 * blanket "coming soon", which reads as "we haven't built it" even when the real reason is
 * "this works, but only through a different entry point".
 */
export type ImportProviderUnavailableReason =
  /** Import works, but only via a separate entry point (not the main wizard). */
  | 'manual-upload-required'
  /** The importer's credential store has no UI that writes it. */
  | 'credential-entry-missing'
  /** Adapter exists but provider coverage is too thin to certify. */
  | 'provider-coverage-insufficient';

export const IMPORT_PROVIDER_UI_OPTIONS: {
  provider: ImportProvider;
  label: string;
  /** True if preview + create-from-import are implemented AND reachable/working end-to-end for a real user today. */
  available: boolean;
  /** Why `available` is false. Omitted when the provider is available. */
  unavailableReason?: ImportProviderUnavailableReason;
  /** Short, user-facing explanation of the limitation. Omitted when the provider is available. */
  unavailableDetail?: string;
  /** True if the import UI can discover leagues from an account identifier. */
  supportsDiscovery?: boolean;
  /** Sports proven by the provider fetch/normalization source path. */
  supportedSports: readonly ('NFL' | 'NCAAF')[];
}[] = [
  { provider: 'sleeper', label: 'Sleeper', available: true, supportsDiscovery: true, supportedSports: ['NFL'] },
  { provider: 'espn', label: 'ESPN', available: true, supportedSports: ['NFL'] },
  { provider: 'yahoo', label: 'Yahoo', available: true, supportedSports: ['NFL'] },
  // fantrax — Import Certification Phase A corrected this entry.
  //
  // STALE CLAIM REMOVED: this previously read "appUserId is never stamped by the upload
  // route". That is no longer true and was verified false against this branch —
  // `server/api-route-modules/legacy/fantrax/route.ts` stamps `appUserId: auth.userId` on
  // BOTH the create and update branches of its upsert, rejects a re-upload owned by a
  // different account, and scopes its listing to the caller. The read-side ownership gate in
  // `FantraxLeagueFetchService` matches it and fails closed.
  //
  // ACTUAL LIMITATION: Fantrax has no live API integration at all. Its data reaches AF only
  // as user-uploaded CSV snapshots (`/af-legacy` → `prisma.fantraxLeague`), and the main
  // import wizard offers no upload step — so a user who picks "Fantrax" there has no way to
  // supply data. The gap is a missing entry point, not authorization.
  {
    provider: 'fantrax',
    label: 'Fantrax',
    available: false,
    unavailableReason: 'manual-upload-required',
    unavailableDetail:
      'Fantrax has no live API. Leagues are imported from CSV exports uploaded in AF Legacy, which the main import wizard does not yet offer.',
    supportedSports: ['NFL', 'NCAAF'],
  },
  // mfl: the importer reads an encrypted `LeagueAuth.apiKey` row (`getDecryptedAuth(userId,
  // 'mfl')`). `POST /api/league/auth` can write exactly that row securely — but no UI in the
  // app ever calls it with an MFL API key, so the credential is never populated. The only MFL
  // credential UI posted a username/password to `/api/auth/mfl`, a different, unauthenticated
  // route writing a different table (`MFLConnection`) the importer never reads; Phase A
  // disabled it rather than leave an unauthenticated credential-writing endpoint exposed.
  {
    provider: 'mfl',
    label: 'MyFantasyLeague (MFL)',
    available: false,
    unavailableReason: 'credential-entry-missing',
    unavailableDetail:
      'MFL imports need an MFL API key, and AF has no screen to save one yet. Connecting with an MFL username and password is not supported.',
    supportedSports: ['NFL'],
  },
  // fleaflicker: the adapter reads only `FetchLeagueStandings` + `FetchLeagueRosters`, so it
  // has no scoring, schedule, draft, transaction, or previous-season data, and no historical
  // backfill service exists for it (`runHistoricalBackfill` returns null for fleaflicker).
  {
    provider: 'fleaflicker',
    label: 'Fleaflicker',
    available: false,
    unavailableReason: 'provider-coverage-insufficient',
    unavailableDetail:
      'Fleaflicker imports currently cover only standings and rosters — no scoring, schedule, draft, or past seasons.',
    supportedSports: ['NFL'],
  },
];

export function getImportProviderLabel(provider: ImportProvider): string {
  return IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === provider)?.label ?? provider;
}

export function isImportProviderAvailable(provider: ImportProvider): boolean {
  return IMPORT_PROVIDER_UI_OPTIONS.some((o) => o.provider === provider && o.available);
}

/** Machine-readable reason a provider is unavailable; `null` when it is available. */
export function getImportProviderUnavailableReason(
  provider: ImportProvider,
): ImportProviderUnavailableReason | null {
  const option = IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === provider);
  if (!option || option.available) return null;
  return option.unavailableReason ?? null;
}

/**
 * User-facing explanation of why a provider can't be used yet. Returns `null` when the
 * provider is available. Callers should prefer this over a generic "coming soon" string —
 * "coming soon" is wrong for Fantrax (it works, just not from this screen).
 */
export function getImportProviderUnavailableDetail(provider: ImportProvider): string | null {
  const option = IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === provider);
  if (!option || option.available) return null;
  return option.unavailableDetail ?? null;
}

export function supportsImportProviderDiscovery(provider: ImportProvider): boolean {
  return IMPORT_PROVIDER_UI_OPTIONS.some(
    (o) => o.provider === provider && o.available && o.supportsDiscovery === true,
  );
}

export function getImportProviderSupportedSports(provider: ImportProvider): readonly ('NFL' | 'NCAAF')[] {
  return IMPORT_PROVIDER_UI_OPTIONS.find((option) => option.provider === provider)?.supportedSports ?? [];
}
