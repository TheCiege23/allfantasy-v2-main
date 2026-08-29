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
   * yahoo: NOT AVAILABLE, flipped 2026-08-29. Discovery lists leagues from the user's
   * CONNECTED Yahoo account (OAuth use_login=1) — no account identifier input.
   *
   * ⚠ IT HAS NEVER IMPORTED A LEAGUE, AND THE FLOW CANNOT SUCCEED AS WIRED. Measured in
   * production the day this flipped:
   *
   *     leagues where platform='yahoo'  0     import_runs provider='yahoo'  0 (ever)
   *     YahooLeague / YahooConnection   0/0   league_auths yahoo row  1, oauthToken NULL
   *
   * The cause is two rival credential stores that cannot see each other. /api/auth/yahoo
   * — the ONLY connect entry point this screen offers — writes `YahooConnection`, which
   * has zero rows; the league-import callback writes `league_auths`; and /api/yahoo/leagues
   * reads only `YahooConnection`. So "Connect Yahoo" returns the user to a screen that
   * still asks them to connect Yahoo. A loop with no exit is worse than a closed door,
   * because the person keeps paying for the attempt.
   *
   * Left `true` while the landing page stopped advertising Yahoo would have been the worst
   * of both: no longer promised, still offered.
   *
   * ⚠ FLIPPING BACK NEEDS A ROW, NOT A REPAIRED CODE PATH — reconcile the two stores, then
   * require `select count(*) from import_runs where provider='yahoo'` to be non-zero. The
   * Yahoo app itself must NOT be deleted or recreated while doing so; its fantasy-read
   * permission is captured at consent time and cannot be re-granted to a new app.
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
