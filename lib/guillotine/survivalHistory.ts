/**
 * Survival history (2026-10-29): a Guilly season as a story — each week's chop line, who fell, who
 * escaped by the least, and every team's path through it. Pure and client-safe; the rows come from
 * ./../league-specialty/guillotineHome.ts.
 *
 * Built from `GuillotinePeriodScore` (every team scored in a week, written by the chop itself) and the
 * week each team was chopped (`GuillotineRosterState.choppedInPeriod`) — the chop's own inputs and
 * output, so the history cannot disagree with the chop. Not from `GuillotineSurvivalLog`, which needs a
 * guillotine season row and a redraft roster link an imported league may not have.
 *
 * The chop line of a week is the HIGHEST score that was chopped: a survivor's margin is its points
 * above it, so a team that tied on the line and won the tiebreak escaped by 0.
 */

export type SurvivalWeek = {
  week: number
  /** Null for a no-chop week. */
  chopLine: number | null
  chopped: Array<{ rosterId: string; name: string; points: number }>
  /** The survivor nearest the line (smallest margin). */
  closestEscape: { rosterId: string; name: string; margin: number } | null
  topScorer: { rosterId: string; name: string; points: number } | null
  teamsScored: number
}

export type SurvivalPathStep = { week: number; points: number; margin: number | null; chopped: boolean }

export type SurvivalTeam = {
  rosterId: string
  name: string
  status: 'alive' | 'chopped'
  choppedWeek: number | null
  /** Chop weeks the team came through. */
  weeksSurvived: number
  /** Chop weeks survived within the league's danger margin of the line. */
  closeCalls: number
  /** The smallest margin it survived by; null when it has not survived a chop yet. */
  bestEscape: number | null
  seasonPoints: number
  path: SurvivalPathStep[]
}

export type SurvivalHistory = { weeks: SurvivalWeek[]; teams: SurvivalTeam[] }

const round1 = (n: number) => Math.round(n * 10) / 10

export function buildSurvivalHistory(input: {
  scores: ReadonlyArray<{ rosterId: string; week: number; points: number }>
  chopped: ReadonlyArray<{ rosterId: string; week: number | null }>
  names: Readonly<Record<string, string>>
  /** A survival within this many points of the line is a close call (the league's danger margin). */
  closeCallMargin: number
}): SurvivalHistory {
  const nameOf = (id: string) => input.names[id]?.trim() || 'A team'
  const choppedWeek = new Map(input.chopped.filter((c) => c.week != null).map((c) => [c.rosterId, c.week as number]))
  const byWeek = new Map<number, Array<{ rosterId: string; points: number }>>()
  for (const s of input.scores) {
    const list = byWeek.get(s.week) ?? []
    list.push({ rosterId: s.rosterId, points: s.points })
    byWeek.set(s.week, list)
  }
  const weekNumbers = [...byWeek.keys()].sort((a, b) => a - b)

  const weeks: SurvivalWeek[] = []
  const paths = new Map<string, SurvivalPathStep[]>()
  for (const week of weekNumbers) {
    const rows = byWeek.get(week)!
    const fell = rows.filter((r) => choppedWeek.get(r.rosterId) === week)
    const chopLine = fell.length ? Math.max(...fell.map((r) => r.points)) : null
    const survivors = rows.filter((r) => choppedWeek.get(r.rosterId) !== week)
    const closest = chopLine == null ? null : [...survivors].sort((a, b) => a.points - b.points)[0] ?? null
    const top = [...rows].sort((a, b) => b.points - a.points)[0] ?? null
    weeks.push({
      week,
      chopLine: chopLine == null ? null : round1(chopLine),
      chopped: fell.map((r) => ({ rosterId: r.rosterId, name: nameOf(r.rosterId), points: round1(r.points) })),
      closestEscape: closest && chopLine != null ? { rosterId: closest.rosterId, name: nameOf(closest.rosterId), margin: round1(closest.points - chopLine) } : null,
      topScorer: top ? { rosterId: top.rosterId, name: nameOf(top.rosterId), points: round1(top.points) } : null,
      teamsScored: rows.length,
    })
    for (const r of rows) {
      const step: SurvivalPathStep = {
        week,
        points: round1(r.points),
        margin: chopLine == null ? null : round1(r.points - chopLine),
        chopped: choppedWeek.get(r.rosterId) === week,
      }
      paths.set(r.rosterId, [...(paths.get(r.rosterId) ?? []), step])
    }
  }

  const rosterIds = new Set([...paths.keys(), ...choppedWeek.keys()])
  const teams: SurvivalTeam[] = [...rosterIds].map((rosterId) => {
    const path = paths.get(rosterId) ?? []
    const survived = path.filter((p) => !p.chopped && p.margin != null)
    return {
      rosterId,
      name: nameOf(rosterId),
      status: choppedWeek.has(rosterId) ? 'chopped' : 'alive',
      choppedWeek: choppedWeek.get(rosterId) ?? null,
      weeksSurvived: survived.length,
      closeCalls: survived.filter((p) => (p.margin as number) <= input.closeCallMargin).length,
      bestEscape: survived.length ? Math.min(...survived.map((p) => p.margin as number)) : null,
      seasonPoints: round1(path.reduce((sum, p) => sum + p.points, 0)),
      path,
    }
  })
  // Alive first, the longest survivors and then the highest scorers on top; the chopped after, the
  // latest to fall first.
  teams.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'alive' ? -1 : 1
    if (a.status === 'chopped') return (b.choppedWeek ?? 0) - (a.choppedWeek ?? 0)
    return b.weeksSurvived - a.weeksSurvived || b.seasonPoints - a.seasonPoints
  })

  return { weeks: weeks.reverse(), teams }
}
