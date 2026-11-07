/**
 * DAILY BEST BALL — the week's score is the SUM over its US Eastern days of that day's optimal legal
 * lineup, chosen from the players on the roster that day, on that day's stats.
 *
 * Weekly best ball (the default) picks ONE lineup on weekly totals, so a guard who scores 30 on Monday
 * and a guard who scores 25 on Tuesday share one G seat: the week counts 30. Daily counts both days'
 * best — 55. Which a league uses is decided in lib/bestball/scoringPeriod.ts.
 *
 * Pure: the scorer (`scoreRosterBestBall`, lib/redraft/scoringEngine.ts) loads the rows and scores each
 * day's stat line; this picks the lineups with the exact optimizer (`computeOptimalLineup`).
 */
import { computeOptimalLineup, type LineupSlotSpec, type OptimalSlotAssignment } from '@/lib/lineup-optimizer/optimalLineup'

export type DailyBestBallCandidate = {
  playerId: string
  positions: string[]
  playerName: string | null
  /** Day keys (`YYYY-MM-DD`, Eastern) he was on the roster. */
  onRosterDays: ReadonlySet<string>
  /** Day key → that day's points, ONLY for days he has a stat line (played). */
  pointsByDay: ReadonlyMap<string, number>
}

export type DailyBestBallDay = {
  day: string
  total: number
  /** The day's counted lineup — players who played that day. A seat left to a non-player scores 0. */
  assignments: OptimalSlotAssignment[]
}

export type DailyBestBallCounted = {
  playerId: string
  playerName: string | null
  /** His points summed across the days he was in the counted lineup. */
  points: number
  /** How many days he counted. */
  days: number
}

export type DailyBestBallResult = {
  total: number
  days: DailyBestBallDay[]
  counted: DailyBestBallCounted[]
  /** Per player: counted points if he ever counted, else everything he scored on his roster days. */
  pointsByPlayer: Map<string, number>
  /** Points scored on days a player did not count. */
  benchPoints: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function computeDailyBestBall(input: {
  candidates: readonly DailyBestBallCandidate[]
  slots: readonly LineupSlotSpec[]
  /** The week's day keys, in order. */
  days: readonly string[]
}): DailyBestBallResult {
  let total = 0
  let benchPoints = 0
  const days: DailyBestBallDay[] = []
  const countedPts = new Map<string, number>()
  const countedDays = new Map<string, number>()
  const allPts = new Map<string, number>()
  const names = new Map(input.candidates.map((c) => [c.playerId, c.playerName]))
  const byId = new Map(input.candidates.map((c) => [c.playerId, c]))

  for (const day of input.days) {
    const onRoster = input.candidates.filter((c) => c.onRosterDays.has(day))
    const played = onRoster.filter((c) => c.pointsByDay.has(day))
    if (played.length === 0) continue
    for (const c of played) allPts.set(c.playerId, (allPts.get(c.playerId) ?? 0) + c.pointsByDay.get(day)!)
    /*
     * Everyone on the roster that day is offered, a player with no game at 0 — so a required seat is
     * filled by a non-player (0) before the optimizer would have to seat a negative line in it.
     */
    const lineup = computeOptimalLineup({
      players: onRoster.map((c) => ({
        playerId: c.playerId,
        positions: c.positions,
        playerName: c.playerName,
        points: c.pointsByDay.get(day) ?? 0,
      })),
      slots: input.slots,
    })
    const counted = lineup.assignments.filter((a) => byId.get(a.playerId)?.pointsByDay.has(day))
    const dayTotal = counted.reduce((sum, a) => sum + a.points, 0)
    const seated = new Set(counted.map((a) => a.playerId))
    for (const c of played) if (!seated.has(c.playerId)) benchPoints += c.pointsByDay.get(day)!
    for (const a of counted) {
      countedPts.set(a.playerId, (countedPts.get(a.playerId) ?? 0) + a.points)
      countedDays.set(a.playerId, (countedDays.get(a.playerId) ?? 0) + 1)
    }
    total += dayTotal
    days.push({ day, total: round2(dayTotal), assignments: counted })
  }

  const pointsByPlayer = new Map<string, number>()
  for (const c of input.candidates) {
    if (countedPts.has(c.playerId)) pointsByPlayer.set(c.playerId, round2(countedPts.get(c.playerId)!))
    else if (allPts.has(c.playerId)) pointsByPlayer.set(c.playerId, round2(allPts.get(c.playerId)!))
  }
  const counted = [...countedPts.keys()]
    .map((playerId) => ({
      playerId,
      playerName: names.get(playerId) ?? null,
      points: round2(countedPts.get(playerId)!),
      days: countedDays.get(playerId) ?? 0,
    }))
    .sort((a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))

  return { total: round2(total), days, counted, pointsByPlayer, benchPoints: round2(benchPoints) }
}
