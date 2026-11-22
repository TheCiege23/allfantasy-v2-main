const regularSeasonGameRanges: Readonly<Record<number, readonly [number, number]>> = {
  2022: [661032, 663463],
  2023: [716352, 718782],
  2024: [744795, 747224],
  2025: [776135, 778564],
}
// The official schedules omit two 2022 IDs and one 2023 ID. MLB canceled 746577 in 2024.
const excludedGameIds = new Set([662073, 662680, 717421, 746577])
export const OFFICIAL_MLB_CERTIFIED_SEASONS = Object.keys(regularSeasonGameRanges).map(Number)

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

export function isCertifiedMlbRegularGameId(id: unknown, season: number): id is number {
  const range = regularSeasonGameRanges[season]
  return !!range && typeof id === 'number' && Number.isSafeInteger(id) && id >= range[0] && id <= range[1] &&
    !excludedGameIds.has(id)
}

export function isCertifiedMlbHistoryRow(row: {
  providerGameId: string | null; providerPlayerId: string | null; gameId: string; season: number
  gameDate: Date | null; team?: string | null; opponent?: string | null; normalizedStatMap?: unknown
}): boolean {
  const normalized = record(row.normalizedStatMap)
  const proof = record(normalized?.officialMlbHistory)
  const group = normalized?.group
  const day = row.gameDate?.toISOString().slice(0, 10)
  return !!proof && normalized?.seasonType === 'regular' && (group === 'batting' || group === 'pitching') &&
    proof.season === row.season && proof.competition === 'R' && isCertifiedMlbRegularGameId(proof.gamePk, row.season) &&
    String(proof.gamePk) === row.providerGameId && typeof proof.playerId === 'number' &&
    Number.isSafeInteger(proof.playerId) && proof.playerId > 0 && String(proof.playerId) === row.providerPlayerId &&
    typeof proof.riGameId === 'string' && /^\d{8}-\d+-\d+(?:-\d+)?$/.test(proof.riGameId) &&
    row.gameId === `${proof.riGameId}:${group}` && !!day && day.startsWith(`${row.season}-`) && proof.day === day &&
    !!row.team && !!row.opponent && row.team !== row.opponent && proof.team === row.team && proof.opponent === row.opponent
}

/** An exact, committed final-box or original postponement decision for the warehouse key. */
export function isCertifiedMlbSchedule(row: {
  raw: unknown; season: number | null; seasonType: string | null; status: string | null
  startTime: Date | null; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null
}, gameId: string, season: number): boolean {
  const proof = record(record(row.raw)?.officialMlbHistory)
  if (!proof || proof.version !== 1 || proof.competition !== 'R' || row.seasonType !== 'regular' ||
      row.season !== season || proof.season !== season || proof.riGameId !== gameId ||
      !isCertifiedMlbRegularGameId(proof.gamePk, season) || proof.homeTeam !== row.homeTeam ||
      proof.awayTeam !== row.awayTeam || !row.startTime || proof.startTime !== row.startTime.toISOString() ||
      proof.status !== row.status || proof.homeScore !== row.homeScore || proof.awayScore !== row.awayScore ||
      typeof proof.boxSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.boxSha256)) return false
  return (row.status === 'completed' && row.homeScore != null && row.awayScore != null && row.homeScore !== row.awayScore) ||
    (row.status === 'postponed' && row.homeScore == null && row.awayScore == null)
}
