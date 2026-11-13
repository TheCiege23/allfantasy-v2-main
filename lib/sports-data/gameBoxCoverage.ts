import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import type { RiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'

export type FinalBoxCoverage = {
  sport: string; providerGameId: string; season: number; startTime: Date
  homeTeam: string; awayTeam: string; participantIds: string[]
}
const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const number = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim())) && Number.isFinite(Number(v)) ? Number(v) : null

/** A complete final box proves absence of a stat contribution, not an injury or DNP status.
 * Only measured NBA/NHL/MLB contracts qualify. Missing groups, unresolved identities,
 * malformed lines and player totals that disagree with the team box all fail closed. */
export function certifyFinalRiBox(sport: string, game: unknown, box: RiGameBox,
  identities: ReadonlyMap<string, string>): FinalBoxCoverage | null {
  if (!['NBA', 'NHL', 'MLB'].includes(sport) || normalizeGameStatus(box.status) !== 'final' ||
      box.seasonType !== 'regular' || !box.season || !box.gameDate || !box.lines.length) return null
  const raw = record(game), full = record(raw?.full_box), players = record(raw?.player_box)
  const teams: string[] = []
  for (const side of ['home_team', 'away_team']) {
    const team = record(full?.[side]), sideBox = record(players?.[side]), totals = record(team?.team_stats)
    if (!team || !sideBox || !totals || typeof team.abbrv !== 'string' || !team.abbrv.trim() || number(team.score) == null) return null
    teams.push(team.abbrv.trim())
    const buckets = sport === 'NBA' ? [sideBox] : sport === 'NHL'
      ? [record(sideBox.skaters), record(sideBox.goalies)] : [record(sideBox.batting), record(sideBox.pitching)]
    if (buckets.some(bucket => !bucket || !Object.keys(bucket).length)) return null
    for (const bucket of buckets) for (const [id, entry] of Object.entries(bucket!)) {
      const line = record(entry)
      if (!line || typeof line.player !== 'string' || !line.player.trim() || !identities.has(id) ||
        [line.player_id, line.playerId, line.player_ID].some(value => value != null && String(value) !== id)) return null
    }
    const primary = Object.values(buckets[0]!).map(record)
    if (primary.some(line => !line) || primary.length < (sport === 'NBA' ? 5 : sport === 'MLB' ? 9 : 5)) return null
    const keys = sport === 'NBA'
      ? ['field_goals_made', 'field_goals_attempted', 'free_throws_made', 'free_throws_attempted', 'three_points_made', 'three_points_attempted', 'assists', 'steals', 'blocks', 'total_rebounds', 'turnovers']
      : sport === 'NHL' ? ['shots_on_goal', 'assists', 'hits', 'blocks']
      : ['AB', 'H', 'R', 'HR', 'RBI', 'BB', 'SO', 'SB']
    for (const key of keys) {
      const expected = number(totals[key]), values = primary.map(line => number(line![key]))
      if (expected == null || values.some(v => v == null || v < 0) || values.reduce<number>((a, v) => a + v!, 0) !== expected) return null
    }
    if (sport === 'NHL') {
      const saves = Object.values(buckets[1]!).map(entry => number(record(entry)?.saves))
      if (number(totals.saves) == null || saves.some(n => n == null) || saves.reduce<number>((a, n) => a + n!, 0) !== number(totals.saves)) return null
    }
    if (sport === 'NBA') {
      const seconds = primary.map(line => /^\d+:\d{2}$/.test(String(line!.minutes))
        ? String(line!.minutes).split(':').reduce((minutes, value) => minutes * 60 + Number(value), 0) : null)
      if (seconds.some(n => n == null)) return null
      const total = seconds.reduce<number>((a, n) => a + n!, 0)
      // Five players × 48 minutes, plus five × five minutes per overtime.
      // The provider rounds individual clocks; allow a few seconds in their sum.
      if (total < 14400 - 5 || Math.abs((total - 14400) - Math.round((total - 14400) / 1500) * 1500) > 5) return null
    }
    if (sport === 'MLB') {
      const other = record(full?.[side === 'home_team' ? 'away_team' : 'home_team'])
      const opponentTotals = record(other?.team_stats), innings = record(other?.quarter_scores)
      const pitchers = Object.values(buckets[1]!).map(entry => record(entry)!)
      for (const [pitcherKey, teamKey] of [['H', 'H'], ['BB', 'BB'], ['K', 'SO'], ['R', 'R']]) {
        const values = pitchers.map(line => number(line[pitcherKey])), expected = number(opponentTotals?.[teamKey])
        if (expected == null || values.some(n => n == null) || values.reduce<number>((a,n) => a + n!, 0) !== expected) return null
      }
      // Reconcile perfect innings too: they may have no H/BB/K/R but still
      // affect ERA and WHIP denominators. A home walk-off leaves 0–2 final outs.
      if (!innings || !Object.keys(innings).length) return null
      const inningRows = Object.entries(innings).sort(([a], [b]) => Number(a) - Number(b))
      if (inningRows.some(([key], i) => Number(key) !== i + 1)) return null
      const played = inningRows.filter(([, runs]) => number(runs) != null).length
      if (!played) return null
      const outs = pitchers.map(line => /^\d+(?:\.[012])?$/.test(String(line.IP))
        ? Number(String(line.IP).split('.')[0]) * 3 + Number(String(line.IP).split('.')[1] ?? 0) : null)
      if (outs.some(n => n == null)) return null
      const totalOuts = outs.reduce<number>((a,n) => a + n!, 0)
      const awayInnings = Object.values(record(record(full?.away_team)?.quarter_scores) ?? {}).filter(runs => number(runs) != null).length
      const walkOffPossible = side === 'away_team' && number(other?.score)! > number(team.score)! && played === awayInnings
      if (walkOffPossible ? totalOuts < (played - 1) * 3 || totalOuts >= played * 3 : totalOuts !== played * 3) return null
    }
  }
  if (teams[0] === teams[1] || box.lines.some(line => !identities.has(line.providerPlayerId))) return null
  return { sport, providerGameId: box.providerGameId, season: box.season, startTime: box.gameDate,
    homeTeam: teams[0], awayTeam: teams[1], participantIds: [...new Set(box.lines.map(line => identities.get(line.providerPlayerId)!))].sort() }
}

/** No date-only matching: doubleheaders require their own final box. The caller
 * supplies a verified canonical player id; arbitrary/unmapped roster ids cannot be zeroed. */
export function boxCertifiesNoContribution(proof: FinalBoxCoverage, game: {
  sport: string; externalId: string; season: number | null; startTime: Date | null; homeTeam: string; awayTeam: string
}, canonicalPlayerId: string, normalizeTeam: (team: string) => string | null): boolean {
  return proof.sport === game.sport && proof.season === game.season &&
    proof.startTime instanceof Date && game.startTime instanceof Date && proof.startTime.getTime() === game.startTime.getTime() &&
    !!normalizeTeam(proof.homeTeam) && !!normalizeTeam(proof.awayTeam) &&
    normalizeTeam(proof.homeTeam) === normalizeTeam(game.homeTeam) && normalizeTeam(proof.awayTeam) === normalizeTeam(game.awayTeam) &&
    Array.isArray(proof.participantIds) && proof.participantIds.length > 0 &&
    !proof.participantIds.includes(canonicalPlayerId)
}
