/**
 * Rivalries for a league that plays here, scored from its own games (2026-11-18).
 *
 * 🛑 The rivalry engine's `RivalryRecord` is built only from imported matchup history, so a league that
 * was created here had none and rivalry week always answered "no rivalry history". These scores come
 * straight from the league's own results instead: every head-to-head game, close games, playoff
 * meetings, and whether the two teams share a division. A team is followed across seasons by its owner,
 * so last year's games count for this year's team.
 *
 * A league with divisions but no games yet still has rivals (its division), so rivalry week can be set
 * before week one. A league with neither has none, and is told so.
 *
 * Pure (no I/O).
 */
import type { RivalryPairScore } from './rivalryWeek'

export type NativeRivalryGame = {
  /** Current-season team keys (see `teamKey` in the service): the same manager across seasons. */
  a: string
  b: string
  aScore: number
  bScore: number
  playoff: boolean
}

export type NativeRivalry = RivalryPairScore & { reasons: string[] }

/** A game decided by 5% of the winning score or less; works for points and for category counts. */
export function isCloseGame(aScore: number, bScore: number): boolean {
  const high = Math.max(aScore, bScore)
  if (!(high > 0)) return false
  return Math.abs(aScore - bScore) <= high * 0.05
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function scoreNativeRivalries(input: {
  /** Team keys in this season. */
  teams: readonly string[]
  /** Completed games between two of those teams, any season. */
  games: readonly NativeRivalryGame[]
  /** Team key → division key, when the league has divisions. */
  divisionOf?: ReadonlyMap<string, string> | null
}): NativeRivalry[] {
  const inLeague = new Set(input.teams)
  type Tally = { a: string; b: string; meetings: number; close: number; playoff: number; aWins: number; bWins: number }
  const tallies = new Map<string, Tally>()
  const tallyFor = (x: string, y: string): Tally => {
    const [a, b] = x < y ? [x, y] : [y, x]
    const key = `${a}|${b}`
    let tally = tallies.get(key)
    if (!tally) {
      tally = { a, b, meetings: 0, close: 0, playoff: 0, aWins: 0, bWins: 0 }
      tallies.set(key, tally)
    }
    return tally
  }
  for (const game of input.games) {
    if (game.a === game.b || !inLeague.has(game.a) || !inLeague.has(game.b)) continue
    if (!Number.isFinite(game.aScore) || !Number.isFinite(game.bScore)) continue
    const tally = tallyFor(game.a, game.b)
    tally.meetings += 1
    if (game.playoff) tally.playoff += 1
    if (isCloseGame(game.aScore, game.bScore)) tally.close += 1
    const firstWon = game.aScore > game.bScore ? game.a : game.bScore > game.aScore ? game.b : null
    if (firstWon === tally.a) tally.aWins += 1
    else if (firstWon === tally.b) tally.bWins += 1
  }
  // Division rivals count even before they have met.
  const divisionOf = input.divisionOf
  if (divisionOf && divisionOf.size > 0) {
    const members = new Map<string, string[]>()
    for (const team of input.teams) {
      const division = divisionOf.get(team)
      if (division) members.set(division, [...(members.get(division) ?? []), team])
    }
    for (const list of members.values()) {
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) tallyFor(list[i]!, list[j]!)
    }
  }

  const out: NativeRivalry[] = []
  for (const tally of tallies.values()) {
    const sameDivision = Boolean(divisionOf && divisionOf.get(tally.a) && divisionOf.get(tally.a) === divisionOf.get(tally.b))
    // An even series is more of a rivalry than a lopsided one.
    const even = tally.meetings >= 2 && Math.abs(tally.aWins - tally.bWins) <= 1 ? 1 : 0
    const score = tally.meetings + tally.close * 2 + tally.playoff * 3 + (sameDivision ? 2 : 0) + even
    if (score <= 0) continue
    const reasons: string[] = []
    if (tally.meetings > 0) reasons.push(plural(tally.meetings, 'MEETING', 'MEETINGS'))
    if (tally.meetings > 0) reasons.push(`SERIES ${Math.max(tally.aWins, tally.bWins)}-${Math.min(tally.aWins, tally.bWins)}`)
    if (tally.close > 0) reasons.push(plural(tally.close, 'CLOSE GAME', 'CLOSE GAMES'))
    if (tally.playoff > 0) reasons.push(plural(tally.playoff, 'PLAYOFF MEETING', 'PLAYOFF MEETINGS'))
    if (sameDivision) reasons.push('DIVISION RIVALS')
    out.push({ a: tally.a, b: tally.b, score, reasons })
  }
  return out
}

/**
 * The other rounds of a rivalry week in a league that plays several games a week: round-robin rounds
 * of the same teams, skipping any round that would repeat a pairing already in the week.
 */
export function fillerRounds(
  teams: readonly string[],
  taken: ReadonlyArray<readonly [string, string]>,
  count: number,
): Array<Array<[string, string]>> {
  if (count <= 0 || teams.length < 2) return []
  const used = new Set(taken.map(([a, b]) => [a, b].sort().join('|')))
  const entries: Array<string | null> = [...teams]
  if (entries.length % 2 === 1) entries.push(null)
  const rounds: Array<Array<[string, string]>> = []
  const spare: Array<Array<[string, string]>> = []
  let rotation = [...entries]
  for (let r = 0; r < rotation.length - 1; r += 1) {
    const round: Array<[string, string]> = []
    for (let i = 0; i < rotation.length / 2; i += 1) {
      const left = rotation[i]
      const right = rotation[rotation.length - 1 - i]
      if (left && right) round.push((r + i) % 2 === 1 ? [right, left] : [left, right])
    }
    const keys = round.map(([a, b]) => [a, b].sort().join('|'))
    if (keys.some((key) => used.has(key))) spare.push(round)
    else {
      rounds.push(round)
      for (const key of keys) used.add(key)
      if (rounds.length === count) return rounds
    }
    rotation = [rotation[0]!, rotation[rotation.length - 1]!, ...rotation.slice(1, rotation.length - 1)]
  }
  // A league too small to avoid every repeat still gets its games.
  return [...rounds, ...spare].slice(0, count)
}
