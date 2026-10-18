/**
 * The rail's guillotine score line for a NATIVE (AllFantasy-hosted) guillotine league.
 *
 * ⚠ WHY A NATIVE LINE EXISTS AT ALL. `getRailMatchups` reads `WeeklyMatchup`, which only the
 * provider importers write, so a league hosted here — whose week lives in `RedraftRoster` /
 * `PlayerWeeklyScore` / `GuillotineRosterState` — got nothing, and the row read "no head-to-head on
 * file this week". A guillotine league has no head-to-head by design; what its manager wants is
 * their points, where they sit among the survivors, and how far the chop line is.
 *
 * Pure: the loader (`nativeRailMatchups.ts`) does the reads; this decides what the row says.
 * Exported for the test.
 */
import { standingIn, type RailSideProjection, type RailStanding } from './railMatchups'

export type RailGuillotineState =
  /** In the live field and clear of the chop line. */
  | 'alive'
  /** In the live field, at or under the chop line this week. */
  | 'chop_zone'
  /** Already chopped. */
  | 'eliminated'
  /** Season running, but no chop has happened yet and none happens this week. */
  | 'before_first_chop'
  /** No season yet (pre-draft). */
  | 'preseason'
  /** A chop week, but nobody has points on the board and the field cannot be ranked yet. */
  | 'no_scores'

export type RailGuillotineLine = {
  state: RailGuillotineState
  /** The league's current fantasy week; null before the season exists. */
  week: number | null
  /** Your points this week. Null when nothing of yours has a stat row, or the league cannot be scored here. */
  points: number | null
  /** Your starters' provider projection this week. Null when none priced. */
  projected: number | null
  /** 1 = top of the surviving field. Null when the field cannot be ranked yet. */
  rank: number | null
  /** Teams still alive (you included while you are). */
  aliveCount: number
  /**
   * Distance to the chop line. Positive: points ABOVE the chop line (alive). Zero or negative: in the
   * chop zone, and the number is how far BELOW the first safe score you are. Null when unranked.
   */
  chopMargin: number | null
  /** What the rank is measured from — the projection until most of the field has played. */
  basis: 'points' | 'projected' | null
  /** `GuillotineLeagueConfig.eliminationStartWeek`. */
  firstChopWeek: number | null
  /** The week your team was chopped, when it was. */
  choppedWeek: number | null
  /** Scheduled draft time (ISO), for a league whose season has not been created yet. */
  draftAt: string | null
}

export type GuillotineTeamInput = {
  rosterId: string
  /** Null: no stat row for any of this team's starters yet. */
  points: number | null
  projected: number | null
  pricedFrom?: number
  starterCount?: number
}

export type GuillotineLineInput = {
  /** Null when the league has no season yet. */
  week: number | null
  firstChopWeek: number | null
  teamsPerChop?: number | null
  draftAt?: string | null
  me: GuillotineTeamInput & { eliminated: boolean; choppedWeek: number | null }
  /** The surviving field. Includes `me` while you are alive. */
  field: GuillotineTeamInput[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The k-th lowest value, 1-based. Same rule as `computeChopLine` in `lib/guillotine/survivalStandings.ts`
 * (which imports prisma, so it is restated here rather than pulled into a client-reachable graph).
 */
function kthLowest(values: number[], k: number): number | null {
  if (values.length === 0 || k <= 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(k, sorted.length) - 1] ?? null
}

export function guillotineLine(input: GuillotineLineInput): { line: RailGuillotineLine; standing: RailStanding | null } {
  const teamsPerChop = Math.max(1, Math.floor(input.teamsPerChop ?? 1) || 1)
  const base: RailGuillotineLine = {
    state: 'alive',
    week: input.week,
    points: input.me.points,
    projected: input.me.projected,
    rank: null,
    aliveCount: input.field.length,
    chopMargin: null,
    basis: null,
    firstChopWeek: input.firstChopWeek,
    choppedWeek: input.me.choppedWeek,
    draftAt: input.draftAt ?? null,
  }

  if (input.week == null || input.week < 1) return { line: { ...base, state: 'preseason' }, standing: null }
  if (input.me.eliminated) return { line: { ...base, state: 'eliminated' }, standing: null }

  /*
   * The ranking is `standingIn`'s — the rule the imported guillotine rows already follow: on the
   * projection until MORE than half the field has points, then on points, and never on a half-priced
   * field. One rule, so a native row and a Sleeper row in the same rail cannot disagree on "8th".
   */
  const sides = new Map<string, RailSideProjection>()
  for (const t of input.field) {
    if (t.projected == null) continue
    sides.set(t.rosterId, {
      projected: t.projected,
      afProjected: null,
      pricedFrom: t.pricedFrom ?? 0,
      starterCount: t.starterCount ?? 0,
    })
  }
  const field = input.field.map((t) => ({ rosterId: t.rosterId, pointsFor: t.points ?? 0 }))
  const standing = standingIn({ field, yourRosterId: input.me.rosterId, sides, elimination: true })

  const beforeChops = input.firstChopWeek != null && input.week < input.firstChopWeek
  if (!standing) {
    return { line: { ...base, state: beforeChops ? 'before_first_chop' : 'no_scores' }, standing: null }
  }

  const valueOf = (t: GuillotineTeamInput) => (standing.basis === 'points' ? (t.points ?? 0) : (t.projected ?? 0))
  const values = input.field.map(valueOf)
  const mine = valueOf(input.me)
  /* The chop line is the score of the last team that goes (the k-th lowest when k teams go per week). */
  const chopLine = kthLowest(values, teamsPerChop)!
  const inZone = mine <= chopLine
  /* In the zone, the distance is to the first SAFE score — the (k+1)-th lowest. */
  const safeLine = kthLowest(values, teamsPerChop + 1)
  const chopMargin = inZone
    ? safeLine == null ? 0 : round2(Math.min(0, mine - safeLine))
    : round2(mine - chopLine)

  return {
    line: {
      ...base,
      state: beforeChops ? 'before_first_chop' : inZone ? 'chop_zone' : 'alive',
      rank: standing.rank,
      chopMargin,
      basis: standing.basis,
    },
    standing,
  }
}
