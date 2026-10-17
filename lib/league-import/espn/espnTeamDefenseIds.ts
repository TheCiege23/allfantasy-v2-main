/**
 * ESPN's NFL pro-team ids, and the team behind an ESPN D/ST id.
 *
 * ⚠ A PURE MODULE, split out of `EspnLeagueFetchService.ts` (which re-exports the table) so a
 * read path can name an ESPN defence without importing the fetch service, and out of
 * `espnAthleteFetch.ts` (the allowlisted adapter, whose only runtime importer must stay the
 * ingestion module). One table and one piece of arithmetic, used by the importer, the athlete
 * ingest and the roster crosswalk alike.
 *
 * A D/ST carries a negative id (`-16000 - proTeamId`) and appears in no athlete list, so the
 * only way to name one is arithmetic over this table.
 */
export const ESPN_TEAM_ABBREVIATIONS: Record<number, string> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
}

/**
 * The team abbreviation behind an ESPN D/ST id, or null when the id is not one.
 *
 * The convention is `-16000 - proTeamId`: -16012 is team 12 (KC), -16033 is team 33 (BAL).
 * Measured on production 2026-10-13: all 26 distinct negative ids on ESPN redraft rosters fall in
 * -16001..-16034, and every one whose row carries a team agrees with this table.
 */
export function espnDefenseTeamAbbreviation(
  providerPlayerId: string | null | undefined,
  teamAbbreviations: Record<number, string> = ESPN_TEAM_ABBREVIATIONS,
): string | null {
  const n = Number(String(providerPlayerId ?? '').trim())
  if (!Number.isInteger(n) || n > -16001 || n < -16099) return null
  return teamAbbreviations[-16000 - n] ?? null
}
