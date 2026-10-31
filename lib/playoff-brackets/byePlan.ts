/**
 * Playoff bye plans: how many rounds each seed sits out before it plays.
 *
 * A plan is `roundsOff[seed - 1]`. The natural plan for N teams gives one bye to the top
 * (nextPowerOfTwo(N) - N) seeds — what every app does. A commissioner can grant more: the #1 seed
 * waits two rounds, or a stepladder where each top seed waits one round longer than the next.
 *
 * A plan is valid when every round has an even number of teams playing: the winners of the round
 * before, plus the seeds whose wait ends that round. The last round has exactly two. Better seeds
 * never wait fewer rounds than worse ones.
 *
 * Pairing within a round is best remaining seed vs worst remaining seed, so a custom plan always
 * re-seeds after each round (a fixed tree cannot hold multi-round byes).
 *
 * Pure.
 */

export const MAX_PLAYOFF_TEAMS = 16
const MAX_ROUNDS_OFF = 4

export function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

export function naturalByePlan(teamCount: number): number[] {
  const byes = nextPowerOfTwo(teamCount) - teamCount
  return Array.from({ length: teamCount }, (_, i) => (i < byes ? 1 : 0))
}

export type ByePlanRound = {
  round: number
  /** Seeds whose first game is this round. */
  entering: number[]
  /** Teams playing this round (winners of the last round + entering seeds). */
  teams: number
  games: number
}

export type ByePlanCheck =
  | { ok: true; rounds: ByePlanRound[]; roundCount: number; byeSeeds: number[] }
  | { ok: false; error: string }

export function checkByePlan(teamCount: number, roundsOff: readonly number[]): ByePlanCheck {
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > MAX_PLAYOFF_TEAMS) {
    return { ok: false, error: `Playoffs need 2 to ${MAX_PLAYOFF_TEAMS} teams.` }
  }
  if (roundsOff.length !== teamCount) return { ok: false, error: 'The bye plan must list every playoff seed.' }
  for (let i = 0; i < roundsOff.length; i++) {
    const r = roundsOff[i]
    if (!Number.isInteger(r) || r < 0 || r > MAX_ROUNDS_OFF) return { ok: false, error: `Seed ${i + 1} has an invalid number of byes.` }
    if (i > 0 && r > roundsOff[i - 1]) return { ok: false, error: `Seed ${i + 1} cannot wait longer than seed ${i}.` }
  }

  const rounds: ByePlanRound[] = []
  let survivors = 0
  let entered = 0
  for (let round = 1; entered < teamCount || survivors > 1; round++) {
    const entering = roundsOff.flatMap((off, i) => (off === round - 1 ? [i + 1] : []))
    entered += entering.length
    const teams = survivors + entering.length
    if (teams % 2 !== 0) {
      return { ok: false, error: `Round ${round} would have ${teams} teams; every round needs an even number.` }
    }
    if (teams === 0) return { ok: false, error: `Round ${round} would have no games.` }
    rounds.push({ round, entering, teams, games: teams / 2 })
    survivors = teams / 2
  }
  return {
    ok: true,
    rounds,
    roundCount: rounds.length,
    byeSeeds: roundsOff.flatMap((off, i) => (off > 0 ? [i + 1] : [])),
  }
}

export function isNaturalByePlan(teamCount: number, roundsOff: readonly number[]): boolean {
  const natural = naturalByePlan(teamCount)
  return roundsOff.length === natural.length && roundsOff.every((v, i) => v === natural[i])
}

/**
 * Every valid plan for a team count, natural first, then fewest rounds. Small by construction:
 * non-increasing sequences of 0..4 over at most 16 seeds.
 */
export function validByePlans(teamCount: number, limit = 8): number[][] {
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > MAX_PLAYOFF_TEAMS) return []
  const out: number[][] = []
  const walk = (prefix: number[], max: number) => {
    if (prefix.length === teamCount) {
      if (checkByePlan(teamCount, prefix).ok) out.push([...prefix])
      return
    }
    for (let v = max; v >= 0; v--) walk([...prefix, v], v)
  }
  walk([], MAX_ROUNDS_OFF)
  const rounds = (p: number[]) => (checkByePlan(teamCount, p) as { roundCount: number }).roundCount
  const byes = (p: number[]) => p.reduce((sum, v) => sum + v, 0)
  return out
    .sort(
      (a, b) =>
        Number(isNaturalByePlan(teamCount, b)) - Number(isNaturalByePlan(teamCount, a)) ||
        rounds(a) - rounds(b) ||
        byes(a) - byes(b),
    )
    .slice(0, limit)
}

/** One-line description of a plan, e.g. "#1 waits 2 rounds · #2 waits 1 round". */
export function describeByePlan(roundsOff: readonly number[]): string {
  const parts = roundsOff.flatMap((off, i) => (off > 0 ? [`#${i + 1} waits ${off} round${off === 1 ? '' : 's'}`] : []))
  return parts.length ? parts.join(' · ') : 'No byes'
}

/** Read a stored plan; null when absent, malformed, or not valid for this team count. */
export function parseStoredByePlan(raw: unknown, teamCount: number): number[] | null {
  if (!Array.isArray(raw)) return null
  const plan = raw.map((v) => Number(v))
  return checkByePlan(teamCount, plan).ok ? plan : null
}
