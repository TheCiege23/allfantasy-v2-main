import { createHash } from 'node:crypto'
import { assignFantraxTeamIds, normalizeFantraxTeamName } from './fantraxTeamIds'
import type { FantraxScheduleRow } from './fantraxApi'
import { object, type Cutover } from './cutoverPolicy'

/** Validate the archived facts against the provider's published table before replacing a fresh schedule. */
export function planCutoverSchedule(input: {
  leagueId: string; seasonId: string; cutover: Cutover; standings: unknown; fixtures: unknown
  nativeRosterBySeat: Map<string, string>; playoffStart: number; snapshotTime: Date
}) {
  const { cutover, nativeRosterBySeat, playoffStart, snapshotTime } = input
  if (!Array.isArray(input.standings) || !Array.isArray(input.fixtures) || !input.fixtures.length) throw Error('Refresh the source standings and schedule before continuing.')
  if (cutover.period >= playoffStart) throw Error('An active playoff bracket requires a verified bracket transfer.')
  const teams = input.standings.map(v => object(v))
  const numeric = assignFantraxTeamIds(teams.map(t => ({ teamName: t.team, sourceTeamId: t.fantraxTeamId })))
  const ids = new Map<string, string>()
  const records = new Map<string, number[]>()
  const ranks: Record<string, number> = {}
  for (const team of teams) {
    const seat = cutover.teams[String(numeric.get(normalizeFantraxTeamName(team.team)))]
    const id = nativeRosterBySeat.get(seat)
    if (!team.fantraxTeamId || !id || ids.has(team.fantraxTeamId) || records.has(id) || !Number.isInteger(team.rank)) throw Error('A source franchise or its published rank could not be verified.')
    ids.set(team.fantraxTeamId, id)
    records.set(id, [0,0,0])
    ranks[id] = team.rank
  }
  if (ids.size !== nativeRosterBySeat.size || new Set(Object.values(ranks)).size !== ids.size) throw Error('Refresh the complete Fantrax franchise table.')
  const seen = new Set<string>()
  const weeks = new Set<number>()
  const rows = []
  for (const raw of input.fixtures) {
    const f = raw as FantraxScheduleRow
    if (f.isPlayoff || f.week >= playoffStart) continue
    const home = ids.get(f.homeTeamId), away = ids.get(f.awayTeamId)
    const period = cutover.periods.find(p => p.number === f.week)
    if (!home || !away || home === away || !period) throw Error('A source fixture has an unmapped franchise or period.')
    const key = JSON.stringify([input.seasonId, f.week, ...[home,away].sort()])
    if (seen.has(key)) throw Error('Duplicate Fantrax pairing requires review.')
    seen.add(key)
    weeks.add(f.week)
    const historical = f.week < cutover.period
    const scored = f.played && Number.isFinite(f.homeScore) && Number.isFinite(f.awayScore)
    if (historical && (!scored || snapshotTime.getTime() <= Date.parse(period.endDate))) throw Error('Refresh Fantrax after the last completed period to verify every official result.')
    const owned = f.week <= cutover.period
    const tied = scored && f.homeScore === f.awayScore
    const tieWinner = tied && f.tiebreakWinnerId ? ids.get(f.tiebreakWinnerId) : undefined
    if (tied && f.tiebreakWinnerId && tieWinner !== home && tieWinner !== away) throw Error('The official tiebreak winner is unmapped.')
    if (historical) {
      const win = tied ? tieWinner : f.homeScore! > f.awayScore! ? home : away
      records.get(home)![win ? win === home ? 0 : 1 : 2]++
      records.get(away)![win ? win === away ? 0 : 1 : 2]++
    }
    rows.push({
      id: 'fx-' + createHash('sha256').update(key).digest('hex').slice(0,40), leagueId: input.leagueId, seasonId: input.seasonId,
      week: f.week, type: 'regular', homeRosterId: home, awayRosterId: away,
      homeScore: owned && scored ? f.homeScore! : 0, awayScore: owned && scored ? f.awayScore! : 0,
      status: historical ? 'final' : owned && scored ? 'active' : 'scheduled',
      lineupSnapshots: { fantraxCutover: { sourceOwned: owned, homeTeam: f.homeTeamId, awayTeam: f.awayTeamId,
        ...(tieWinner && historical ? { winner: tieWinner } : {}) } },
    })
  }
  for (let week=1; week<playoffStart; week++) if (!weeks.has(week)) throw Error('The source regular-season schedule is incomplete.')
  for (const t of teams) {
    const derived = records.get(ids.get(t.fantraxTeamId)!)!
    if (![t.wins,t.losses,t.ties].every((n,i) => Number.isInteger(n) && n === derived[i])) throw Error('Completed source games do not yet reconcile with the published standings. Refresh the source before continuing.')
  }
  return { rows, ranks }
}
