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
  // yahoo discovery lists leagues from the user's CONNECTED Yahoo account (OAuth
  // use_login=1) — no account identifier input; requires Yahoo connected in League Sync.
  { provider: 'yahoo', label: 'Yahoo', available: true, supportsDiscovery: true, supportedSports: ['NFL'] },
  /*
   * fantrax: LIVE. Fantrax turned out to have a real read API (`fxea`), so the
   * CSV upload is no longer the only way in — a league id is enough.
   *
   * ⚠ DISCOVERY LISTS TEAMS, NOT LEAGUES, and that is not a shortcut. Listing
   * someone's leagues needs their Fantrax Secret ID, which is a credential and
   * does not belong in an import box; a league id is public, so the flow asks
   * for the league and then which team is theirs. `supportsDiscovery` is true
   * because the import UI can populate a pickable list from an identifier,
   * which is exactly what that flag gates.
   *
   * NFL as well as NCAAF: the sport is measured by resolving the rosters
   * against both player maps and keeping whichever names more, because
   * getLeagueInfo does not report a sport and the two id spaces do not overlap.
   */
  { provider: 'fantrax', label: 'Fantrax', available: true, supportsDiscovery: true, supportedSports: ['NFL', 'NCAAF'] },
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
