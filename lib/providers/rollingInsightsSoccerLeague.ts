/**
 * Rolling Insights Euro soccer — `league` query param (EPL / LALIGA / SERIEA).
 */

export type RollingInsightsSoccerLeagueCode = 'EPL' | 'LALIGA' | 'SERIEA'

const WS = /\s+/g

function compactKey(s: string): string {
  return s.trim().replace(WS, '_').toUpperCase()
}

/** True when the string resolves to a documented RI soccer league code. */
export function isRollingInsightsSoccerLeague(input: unknown): boolean {
  return normalizeSoccerLeague(input) != null
}

/** @alias normalizeSoccerLeague */
export function getRollingInsightsSoccerLeague(input: unknown): RollingInsightsSoccerLeagueCode | null {
  return normalizeSoccerLeague(input)
}

/**
 * Normalize UI / doc labels to RI `league` values: EPL | LALIGA | SERIEA.
 */
export function normalizeSoccerLeague(input: unknown): RollingInsightsSoccerLeagueCode | null {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw) return null
  const u = compactKey(raw)
  const lower = raw.toLowerCase()

  if (
    u === 'EPL' ||
    u === 'PREMIER_LEAGUE' ||
    u === 'ENGLISH_PREMIER_LEAGUE' ||
    lower.includes('premier league')
  ) {
    return 'EPL'
  }
  if (
    u === 'LALIGA' ||
    u === 'LA_LIGA' ||
    u === 'LA_LIGA_SPAIN' ||
    lower === 'laliga' ||
    lower.includes('la liga')
  ) {
    return 'LALIGA'
  }
  if (
    u === 'SERIEA' ||
    u === 'SERIE_A' ||
    u === 'ITALIAN_SERIE_A' ||
    lower.includes('serie a') ||
    (lower.includes('serie') && lower.includes('ital'))
  ) {
    return 'SERIEA'
  }

  return null
}
