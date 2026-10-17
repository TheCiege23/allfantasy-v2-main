import { z } from 'zod'
const id = z.string().min(1).max(200)
export const seasonMatchupScheduleSchema = z.object({ period: z.number().int().min(1).max(30), source: id, pairs: z.array(z.object({ homeRosterId: id, awayRosterId: id }).strict()).min(1).max(96) }).strict()
export type SeasonMatchupSchedule = z.infer<typeof seasonMatchupScheduleSchema>
export function validateSeasonMatchupSchedule(raw: SeasonMatchupSchedule, rosterIds: string[]) {
  const schedule = seasonMatchupScheduleSchema.parse(raw)
  const players = schedule.pairs.flatMap(p => [p.homeRosterId, p.awayRosterId])
  if (new Set(rosterIds).size !== rosterIds.length || rosterIds.length % 2 || players.length !== rosterIds.length || new Set(players).size !== rosterIds.length || players.some(id => !rosterIds.includes(id))) throw new Error('Pair every frozen roster exactly once, with no byes or foreign teams.')
  return schedule
}
function units(points: number) {
  const result = Math.round(points * 10000)
  if (!Number.isFinite(points) || !Number.isSafeInteger(result) || Math.abs(points * 10000 - result) > 0.00001) throw new Error('Matchup totals require finite four-decimal fantasy points.')
  return result
}
/** Pairings come from a verified fantasy schedule, never real-sport schedules or invented opponents. */
export function deriveSeasonMatchupOutcomes(schedule: SeasonMatchupSchedule, teams: Array<{ rosterId: string; points: number | null }>) {
  validateSeasonMatchupSchedule(schedule, teams.map(t => t.rosterId))
  const scores = new Map(teams.map(t => { if (t.points === null) throw new Error('Every matchup score must be finalized.'); return [t.rosterId, units(t.points)] }))
  return schedule.pairs.flatMap(pair => [
    { rosterId: pair.homeRosterId, opponentRosterId: pair.awayRosterId },
    { rosterId: pair.awayRosterId, opponentRosterId: pair.homeRosterId },
  ].map(team => {
    const own = scores.get(team.rosterId)!, other = scores.get(team.opponentRosterId)!
    return { ...team, pointsFor: own / 10000, pointsAgainst: other / 10000, wins: (own === other ? 0.5 : own > other ? 1 : 0) as 0 | 0.5 | 1, losses: own < other ? 1 : 0, ties: own === other ? 1 : 0 }
  }))
}

/** Suggested native schedule; becomes authoritative only after explicit commissioner publication. */
export function suggestSeasonRoundRobin(rosterIds: string[], period: number, startPeriod: number): SeasonMatchupSchedule {
  if (!Number.isInteger(period) || !Number.isInteger(startPeriod) || startPeriod < 1 || period < startPeriod || period > 30 || rosterIds.length < 2 || rosterIds.length > 192 || rosterIds.length % 2 || new Set(rosterIds).size !== rosterIds.length) throw new Error('A valid even frozen field and opening week are required.')
  const offset = period - startPeriod, round = offset % (rosterIds.length - 1), cycle = Math.floor(offset / (rosterIds.length - 1))
  const ring = [...rosterIds]
  for (let n = 0; n < round; n++) ring.splice(1, 0, ring.pop()!)
  const pairs = Array.from({ length: ring.length / 2 }, (_, i) => {
    const a = ring[i]!, b = ring[ring.length - 1 - i]!
    return (round + i + cycle) % 2 ? { homeRosterId: b, awayRosterId: a } : { homeRosterId: a, awayRosterId: b }
  })
  return validateSeasonMatchupSchedule({ period, source: 'commissioner_round_robin_v1', pairs }, rosterIds)
}
