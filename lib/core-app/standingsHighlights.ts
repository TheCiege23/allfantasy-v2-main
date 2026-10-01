import { formatRecord, type BoardTeam, type Record3, type ResultCode, type StandingsBoard } from '@/lib/core-app/standingsModel'

/**
 * `/core/standings?league=` — the parts of one league's board worth a headline: streaks, the league's
 * awards, and your record against each opponent.
 *
 * Pure reads over `StandingsBoard`; nothing here computes a new number the model does not already hold.
 * `form`, `luck`, `expectedWins`, `powerRank` and `h2h` are all the model's own, so an award is a
 * selection from the table, never a second opinion beside it.
 *
 * ⚠ EVERY AWARD HAS A FLOOR, AND NO FLOOR MEANS NO AWARD. "Luckiest team" in a league where nobody is
 * more than a third of a win off their scoring is a superlative about noise. A missing card is the honest
 * answer to "nobody stands out".
 */

export type Streak = { kind: ResultCode; n: number }

/** The current run, read from the newest end of `form` (oldest first). Null with no results. */
export function currentStreak(form: readonly ResultCode[]): Streak | null {
  if (form.length === 0) return null
  const kind = form[form.length - 1]
  let n = 0
  for (let i = form.length - 1; i >= 0 && form[i] === kind; i -= 1) n += 1
  return { kind, n }
}

/**
 * `form` holds the last five results, so a run of five may be longer. Printed as "W5+" rather than
 * "W5", because the model does not keep the sixth result back and claiming exactly five would be a guess.
 */
export function streakLabel(s: Streak, formLength: number): string {
  return `${s.kind}${s.n}${s.n >= 5 && formLength >= 5 ? '+' : ''}`
}

/** Below a full win either way, the gap between record and scoring is not worth a label. */
export const LUCK_FLOOR = 1
/** A team the power table puts this many places above its seed is "better than its record". */
export const UNDERRATED_FLOOR = 2
export const STREAK_FLOOR = 2

export type Award = {
  key: 'points' | 'hot' | 'cold' | 'lucky' | 'robbed' | 'underrated' | 'schedule'
  label: string
  team: string
  rosterId: string
  isYou: boolean
  stat: string
  detail: string
  tone: 'good' | 'warn' | 'bad' | 'accent' | 'info'
}

function pts(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Best by `score`; ties go to the better seed, so the order is stable across renders. */
function best(teams: BoardTeam[], score: (t: BoardTeam) => number | null): { team: BoardTeam; v: number } | null {
  let out: { team: BoardTeam; v: number } | null = null
  for (const t of teams) {
    const v = score(t)
    if (v == null || !Number.isFinite(v)) continue
    if (!out || v > out.v || (v === out.v && t.seed < out.team.seed)) out = { team: t, v }
  }
  return out
}

export function leagueAwards(board: StandingsBoard): Award[] {
  const teams = board.teams.filter((t) => t.weeksPlayed > 0)
  if (teams.length < 2) return []
  const out: Award[] = []
  const award = (a: Omit<Award, 'team' | 'rosterId' | 'isYou'>, t: BoardTeam) =>
    out.push({ ...a, team: t.name, rosterId: t.rosterId, isYou: t.isYou })

  const points = teams.find((t) => t.pfRank === 1)
  if (points) {
    award(
      {
        key: 'points',
        label: 'Points machine',
        stat: pts(points.pointsFor),
        detail: points.average != null ? `${pts(points.average)} a week — the most in the league.` : 'The most points in the league.',
        tone: 'accent',
      },
      points,
    )
  }

  if (board.hasHeadToHead) {
    const hot = best(teams, (t) => {
      const s = currentStreak(t.form)
      return s && s.kind === 'W' ? s.n : null
    })
    if (hot && hot.v >= STREAK_FLOOR) {
      award(
        {
          key: 'hot',
          label: 'Hottest team',
          stat: streakLabel({ kind: 'W', n: hot.v }, hot.team.form.length),
          detail: `${hot.v >= 5 ? 'At least five' : hot.v} straight wins.`,
          tone: 'good',
        },
        hot.team,
      )
    }
    const cold = best(teams, (t) => {
      const s = currentStreak(t.form)
      return s && s.kind === 'L' ? s.n : null
    })
    if (cold && cold.v >= STREAK_FLOOR) {
      award(
        {
          key: 'cold',
          label: 'Ice cold',
          stat: streakLabel({ kind: 'L', n: cold.v }, cold.team.form.length),
          detail: `${cold.v >= 5 ? 'At least five' : cold.v} straight losses.`,
          tone: 'bad',
        },
        cold.team,
      )
    }

    const lucky = best(teams, (t) => t.luck)
    if (lucky && lucky.v >= LUCK_FLOOR) {
      award(
        {
          key: 'lucky',
          label: 'Luckiest',
          stat: `${signed(lucky.v)} W`,
          detail: `${fmtWins(lucky.team.headToHeadWins)} wins on scoring worth ${lucky.team.expectedWins.toFixed(1)}.`,
          tone: 'warn',
        },
        lucky.team,
      )
    }
    const robbed = best(teams, (t) => -t.luck)
    if (robbed && robbed.v >= LUCK_FLOOR) {
      award(
        {
          key: 'robbed',
          label: 'Snakebitten',
          stat: `${signed(-robbed.v)} W`,
          detail: `${fmtWins(robbed.team.headToHeadWins)} wins on scoring worth ${robbed.team.expectedWins.toFixed(1)}.`,
          tone: 'bad',
        },
        robbed.team,
      )
    }

    const tough = best(teams, (t) => t.pointsAgainst)
    if (tough && tough.team.pointsAgainst != null) {
      award(
        {
          key: 'schedule',
          label: 'Toughest draw',
          stat: pts(tough.v),
          detail: 'The most points scored against any team.',
          tone: 'info',
        },
        tough.team,
      )
    }
  }

  const under = best(teams, (t) => t.seed - t.powerRank)
  if (under && under.v >= UNDERRATED_FLOOR) {
    award(
      {
        key: 'underrated',
        label: 'Better than the record',
        stat: `AF ${ordinal(under.team.powerRank)}`,
        detail: `${ordinal(under.team.seed)} in the table, ${ordinal(under.team.powerRank)} on AF Power.`,
        tone: 'accent',
      },
      under.team,
    )
  }

  return out
}

function fmtWins(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(1)
}

export type HeadToHeadCell = {
  rosterId: string
  name: string
  seed: number
  record: Record3
  /** 'W' when you lead the series, 'L' when you trail it, 'T' when it is level. */
  verdict: ResultCode
  text: string
}

/**
 * Your record against every opponent you have met, in table order.
 *
 * ⚠ ONLY OPPONENTS YOU HAVE PLAYED. A 0-0 cell is not a level series, it is no series, and drawing
 * eleven grey squares in week three says "nobody has an edge" when it should say nothing.
 */
export function yourHeadToHead(board: StandingsBoard): { cells: HeadToHeadCell[]; vsField: Record3 | null } | null {
  if (!board.hasHeadToHead) return null
  const you = board.teams.find((t) => t.isYou)
  if (!you) return null
  const mine = board.h2h[you.rosterId] ?? {}
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const cells: HeadToHeadCell[] = []
  const vs: Record3 = { wins: 0, losses: 0, ties: 0 }
  let anyVsField = false
  for (const t of board.teams) {
    if (t.rosterId === you.rosterId) continue
    const r = mine[t.rosterId]
    if (!r || r.wins + r.losses + r.ties === 0) continue
    cells.push({
      rosterId: t.rosterId,
      name: t.name,
      seed: t.seed,
      record: r,
      verdict: r.wins > r.losses ? 'W' : r.wins < r.losses ? 'L' : 'T',
      text: formatRecord(r),
    })
    if (t.seed <= field) {
      anyVsField = true
      vs.wins += r.wins
      vs.losses += r.losses
      vs.ties += r.ties
    }
  }
  if (cells.length === 0) return null
  return { cells, vsField: anyVsField ? vs : null }
}
