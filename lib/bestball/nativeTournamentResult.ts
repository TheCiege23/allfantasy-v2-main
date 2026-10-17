import { rankBestBallEntries, type BestBallAdvancementTieRule } from './advancementRanking'

type Entry = { id: string; currentRound: number; overallRank: number | null; totalPoints: number; weeklyScores: unknown }
type Contest = { id: string; status: string; rounds: number; entries: Entry[] }

/** Finalists use the contest's saved ranks. Earlier exits rank by round reached,
 * then that round's score and the saved tie rule; scores from different rounds
 * are never compared, because advancement can reset scores. */
export function readNativeTournamentResult(contest: Contest | null, rosterIds: string[], tie: BestBallAdvancementTieRule) {
  if (!contest || contest.status !== 'complete' || !Number.isInteger(contest.rounds) || contest.rounds < 1 || !rosterIds.length) return null
  const expected = new Set(rosterIds.map(id => `${contest.id}:${id}`))
  if (expected.size !== rosterIds.length || contest.entries.length !== expected.size || new Set(contest.entries.map(e => e.id)).size !== expected.size) return null
  if (contest.entries.some(e => !expected.has(e.id) || !Number.isFinite(e.totalPoints) || !Number.isInteger(e.currentRound) || e.currentRound < 1 || e.currentRound > contest.rounds)) return null
  const finalists = contest.entries.filter(e => e.currentRound === contest.rounds)
  if (!finalists.length || finalists.some(e => !Number.isInteger(e.overallRank) || e.overallRank! < 1 || e.overallRank! > finalists.length)) return null
  const sorted = [...finalists].sort((a, b) => a.overallRank! - b.overallRank! || a.id.localeCompare(b.id))
  if (sorted[0]!.overallRank !== 1) return null
  const finishByRosterId = new Map<string, number>()
  const entryByRosterId = new Map<string, Entry>()
  const rosterId = (entry: Entry) => entry.id.slice(contest.id.length + 1)
  for (const entry of sorted) finishByRosterId.set(rosterId(entry), entry.overallRank!)
  for (let round = contest.rounds - 1; round >= 1; round--) {
    const exits = rankBestBallEntries(contest.entries.filter(e => e.currentRound === round), tie)
    const offset = sorted.length
    exits.forEach((entry, index) => finishByRosterId.set(rosterId(entry), offset + index + 1))
    sorted.push(...exits)
  }
  for (const entry of sorted) entryByRosterId.set(rosterId(entry), entry)
  return { finishByRosterId, entryByRosterId, championRosterIds: finalists.filter(e => e.overallRank === 1).map(rosterId), runnerUpRosterIds: finalists.filter(e => e.overallRank === 2).map(rosterId) }
}
