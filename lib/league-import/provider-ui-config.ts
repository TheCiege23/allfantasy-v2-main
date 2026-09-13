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
  /*
   * yahoo: NOT AVAILABLE — switched back off 2026-09-13, the same day it was switched on (#795).
   *
   * 🛑 YAHOO GATES THE FANTASY SPORTS API BEHIND AN APPROVAL, AND ALLFANTASY IS NOT APPROVED YET.
   * Everything on our side now works: `PUBLIC_SITE_URL` points at www, connect reaches Yahoo, a real
   * consent screen names "Yahoo Fantasy Sports — Read", and the token is saved to `league_auths`.
   * Measured in production that day, Yahoo then answered every fantasy call — the account-wide league
   * list AND a single named league — with 403 "This application is not authorized to perform this
   * action", after a fresh consent as well as a cached one. The Yahoo Sports Developer Portal describes
   * an application → review → access process, and an unapproved app gets exactly that 403 on every
   * call however it is configured; re-authorizing, re-saving or recreating the app does not change it.
   *
   * The owner submitted the access request on 2026-09-13 (https://sports.yahoo.com/developer/access/,
   * read-only, existing Client ID). Left `true`, every manager who picked Yahoo would connect, approve,
   * and then hit a refusal nothing on their side can fix.
   *
   * FLIP BACK ONLY WHEN BOTH ARE TRUE: Yahoo has approved the app, and a real account has connected
   * and imported — `select count(*) from import_runs where provider='yahoo'` non-zero. The landing
   * strip and chips follow this flag on their own.
   *
   * The Yahoo app must NOT be deleted or recreated; new apps are not offered Fantasy Sports at all.
   */
  { provider: 'yahoo', label: 'Yahoo', available: false, supportsDiscovery: true, supportedSports: ['NFL'] },
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
  /*
   * mfl: FLIPPED 2026-08-27 with the missing piece built. The adapter, the fetch
   * service, the pipeline entry and the storage column all existed; what did not
   * was anywhere to type the API key `MflLeagueFetchService` requires — so
   * `getMflAuthForUser` threw on every import. `MflApiKeyConnection` in
   * Settings → Connected Accounts saves one, through the endpoint that already
   * encrypted it.
   *
   * ⚠ THE KEY IS REQUIRED FOR EVERY LEAGUE, NOT JUST PRIVATE ONES. MFL's export
   * API takes `APIKEY` on every call this service makes, so there is no
   * public-league shortcut and the tile must name the setup step the way ESPN's
   * does.
   *
   * ⚠ AND THIS IS THE ONE FLAG HERE NOT VERIFIED AGAINST A REAL LEAGUE.
   * Fantrax and Fleaflicker were both proven end to end before they flipped;
   * MFL cannot be, because the verification needs a key nobody on this side
   * holds. It is flipped on the same standard ESPN was held to — the missing
   * piece is built, and the failure path already names the fix in the user's
   * terms ("Save your MFL API key in League Sync before importing").
   */
  { provider: 'mfl', label: 'MyFantasyLeague (MFL)', available: true, supportedSports: ['NFL'] },
  /*
   * fleaflicker: FLIPPED 2026-08-27 with the missing piece built, not to unblock
   * anything. The blocker was never the adapter — it was that no field in the
   * main import flow accepted a Fleaflicker league id, so the only path in was
   * an orphaned page nothing linked to.
   *
   * ⚠ IT NEEDS NO CREDENTIAL AT ALL, which is what makes it the cheapest of the
   * six. `fetchFleaflickerLeagueForImport(sourceId)` takes one argument and
   * calls a public JSON API — no OAuth, no cookie, no key. Verified end to end
   * against a real league before this flag moved: league 206154 fetched and
   * normalised to "Jackpot Dynasty League", 16 teams, NFL, 2026.
   *
   * No discovery: listing someone's leagues would need an account identifier
   * Fleaflicker does not expose publicly, so the flow takes a league id the
   * same way ESPN does.
   */
  { provider: 'fleaflicker', label: 'Fleaflicker', available: true, supportedSports: ['NFL'] },
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
