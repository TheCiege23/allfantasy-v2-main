/**
 * Where the retired `/matchup-simulator` page sends people: /core Matchup.
 *
 * Owner decision 2026-09-29 — /core Matchup is the one matchup surface. `/matchup-simulator` is a
 * permanent (308) redirect to it (`app/matchup-simulator/page.tsx`).
 *
 * `?leagueId=` was the old page's league selector (a `League.id`). /core reads the same id as
 * `?league=`, so it is carried across and a deep link from Chimmy or the tool hub still lands on the
 * right league. Anything else in the query (`sport`) means nothing on /core and is dropped.
 *
 * Pure, no imports — a page file may only export Next's page fields, so the testable part lives here.
 */
export const MATCHUP_SIMULATOR_DESTINATION = '/core/matchup'

export function matchupSimulatorRedirectTarget(
  sp: Record<string, string | string[] | undefined>,
): string {
  const raw = Array.isArray(sp.leagueId) ? sp.leagueId[0] : sp.leagueId
  const leagueId = typeof raw === 'string' ? raw.trim() : ''
  return leagueId
    ? `${MATCHUP_SIMULATOR_DESTINATION}?league=${encodeURIComponent(leagueId)}`
    : MATCHUP_SIMULATOR_DESTINATION
}
