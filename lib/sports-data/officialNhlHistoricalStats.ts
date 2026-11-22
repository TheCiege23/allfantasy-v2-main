export const OFFICIAL_NHL_HISTORY_SOURCE = 'nhl_official_box'
export const OFFICIAL_NHL_HISTORY_SEASONS: readonly number[] = [2021, 2022, 2023, 2024, 2025]
export const REVIEWED_NHL_REVERSED_GAMES: Readonly<Record<string, number>> = {
  '20221007-11-28': 2022020001,
  '20221105-27-1': 2022020185,
  '20231029-18-26': 2023020129,
  '20231116-30-29': 2023020242,
  '20231118-30-3': 2023020254,
}
// The vendor keys are retained for historical references. The final NHL dates
// and schedule corrections for these keys come from the official game boxes.
export const REVIEWED_NHL_SCHEDULE_GAMES: Readonly<Record<string, { id: number; day: string }>> = {
  '20220419-26-14': { id: 2021020436, day: '2022-04-18' },
  '20211214-12-8': { id: 2021020441, day: '2021-12-14' },
  '20220224-24-12': { id: 2021020497, day: '2022-02-24' },
  '20220428-7-20': { id: 2021020513, day: '2022-04-28' },
  '20220321-23-2': { id: 2021020646, day: '2022-03-21' },
  '20220417-10-20': { id: 2021020723, day: '2022-04-17' },
  '20220130-14-5': { id: 2021020788, day: '2022-02-12' },
  '20220201-5-23': { id: 2021020796, day: '2022-02-17' },
  '20220213-24-12': { id: 2021020817, day: '2022-02-13' },
  '20220226-29-10': { id: 2021020829, day: '2022-04-26' },
  '20220228-5-8': { id: 2021020848, day: '2022-02-22' },
  '20220112-2-23': { id: 2021021000, day: '2022-01-12' },
  '20220323-32-19': { id: 2021021017, day: '2022-03-22' },
  '20220325-32-25': { id: 2021021033, day: '2022-02-11' },
  '20220402-7-11': { id: 2021021095, day: '2022-02-15' },
  '20220409-22-3': { id: 2021021150, day: '2022-04-10' },
  '20220410-31-28': { id: 2021021161, day: '2022-02-20' },
  '20220412-27-24': { id: 2021021169, day: '2022-04-29' },
  '20220122-20-10': { id: 2021021211, day: '2022-01-22' },
  '20220420-30-16': { id: 2021021228, day: '2022-02-17' },
  '20220424-2-6': { id: 2021021263, day: '2022-02-15' },
  '20220426-16-23': { id: 2021021273, day: '2022-02-23' },
  '20220426-10-29': { id: 2021021275, day: '2022-02-26' },
  '20220428-27-7': { id: 2021021293, day: '2022-02-08' },
  '20220429-4-24': { id: 2021021304, day: '2022-02-20' },
  '20220429-21-27': { id: 2021021305, day: '2022-04-28' },
}

export const REVIEWED_NHL_EXCLUDED_PLAYERS: Readonly<Record<string, readonly string[]>> = {
  '2021:20220322-28-26': ['1873'],
  '2021:20220426-31-17': ['1661'],
  '2021:20220429-13-23': ['1048', '2546'],
  '2023:20240215-32-2': ['1008'],
}

export const REVIEWED_NHL_DUPLICATE_GAME = '20220310-24-20'

export function isReviewedNhlGameDay(riGameId: string, nhlGameId: number, day: string): boolean {
  const reviewed = REVIEWED_NHL_SCHEDULE_GAMES[riGameId]
  return reviewed ? reviewed.id === nhlGameId && reviewed.day === day
    : riGameId.startsWith(day.replaceAll('-', ''))
}

export function isOfficialNhlRegularGameId(gameId: string, season: number): boolean {
  const gameNumber = Number(gameId.slice(6))
  return OFFICIAL_NHL_HISTORY_SEASONS.includes(season) &&
    /^\d{10}$/.test(gameId) && gameId.startsWith(`${season}02`) && gameNumber >= 1 && gameNumber <= 1312
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Match the final NHL facts to their original warehouse game and player identity. */
export function isOfficialNhlHistoryRow(row: {
  source: string | null; providerGameId: string | null; providerPlayerId: string | null
  gameId: string; season: number; gameDate: Date | null; team: string | null; opponent: string | null
  normalizedStatMap: unknown
}): boolean {
  if (row.source !== OFFICIAL_NHL_HISTORY_SOURCE || !row.providerGameId || !row.providerPlayerId) return false
  const normalized = record(row.normalizedStatMap)
  const proof = record(normalized?.officialNhlHistory)
  const group = normalized?.group
  const day = row.gameDate?.toISOString().slice(0, 10)
  if (!proof || !day || (group !== 'skaters' && group !== 'goalies') ||
      typeof proof.riGameId !== 'string' || !/^\d{8}-\d+-\d+$/.test(proof.riGameId)) return false
  return normalized?.seasonType === 'regular' &&
    isOfficialNhlRegularGameId(row.providerGameId, row.season) && /^\d{7}$/.test(row.providerPlayerId) &&
    proof.gameId === Number(row.providerGameId) && proof.playerId === Number(row.providerPlayerId) &&
    proof.gameDate === day && isReviewedNhlGameDay(proof.riGameId, Number(row.providerGameId), day) &&
    proof.team === row.team && proof.opponent === row.opponent && !!row.team && !!row.opponent &&
    row.team !== row.opponent && row.gameId === `${proof.riGameId}:${group}`
}
