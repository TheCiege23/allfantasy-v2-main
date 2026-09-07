/**
 * Cookie the header's league selector writes to override the default
 * "most recent roster" league. Follows the same pattern as
 * `lib/commissioner-ui/demo-mode/constants.ts` — a cookie readable both
 * server-side (`resolveActiveLeagueId`) and client-side (the selector).
 */
export const ACTIVE_LEAGUE_COOKIE_KEY = 'commissioner_os_active_league_id'
