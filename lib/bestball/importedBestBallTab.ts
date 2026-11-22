/**
 * The Best Ball tab for a league imported from another platform, built from the weekly team scores we
 * already store.
 *
 * 🛑 THE TAB WAS EMPTY FOR EVERY IMPORTED BEST BALL LEAGUE. It listed weeks from `team_week_results`
 * and lineups from `weekly_scores`, which only a legacy processor filled. Measured on production
 * 2026-11-20: 141 best ball leagues, all imported from Sleeper; `team_week_results` holds 0 rows and
 * `weekly_scores` holds none for any of them, so every one read "No scored weeks yet" in week 11.
 *
 * ⚠ TWO STORES HOLD AN IMPORT'S WEEKLY SCORES, AND ONLY ONE IS KEPT CURRENT. `WeeklyMatchup` (keyed
 * by the provider's league id) is written by the regular sync: on production 2026-11-20 it reached
 * week 11 for 137 of 141 best ball leagues. `dw_matchup_facts` is refreshed by a slower rotation and
 * stood at week 6 or 7 for most. The tab reads `WeeklyMatchup` (as the imported Guilly tab does) and
 * falls back to the facts only for a league the first holds nothing for.
 *
 * What we store for an import is each TEAM's score for the week, not which players the provider
 * counted. So a card carries the team's total and its result, and says where the counted players are;
 * it never invents a lineup.
 *
 * Pure: the handler loads rows, this shapes them.
 */

/** One team's score in one of its games in a week (`WeeklyMatchup`, keyed by the provider's roster id). */
export type ImportedTeamWeekRow = { week: number; rosterId: string; pointsFor: number; matchupId: number | null; game?: number | null }
/** A stored head-to-head game (`dw_matchup_facts`): the older store, used only where the newer has nothing. */
export type ImportedMatchupRow = { weekOrPeriod: number; teamA: string; teamB: string; scoreA: number; scoreB: number }
export type ImportedTeam = { externalId: string | null; teamName: string | null; ownerName: string | null }

type Card = { rosterId: string; teamName: string; totalPoints: number; winLoss: 'W' | 'L' | 'T' | null; starters: never[]; bench: never[] }
type Standing = { rosterId: string; rank: number; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }

export type ImportedBestBallTab = {
  selectedWeek: number
  weeksAvailable: number[]
  lineups: Card[]
  standings: Standing[]
  history: Array<{ rosterId: string; week: number; totalPoints: number }>
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The older store's games as team-week rows, so one builder reads both. */
export function teamWeeksFromMatchupFacts(rows: readonly ImportedMatchupRow[]): ImportedTeamWeekRow[] {
  const out: ImportedTeamWeekRow[] = []
  rows.forEach((r, i) => {
    if (!r.teamA) return
    const hasB = Boolean(r.teamB) && r.teamB !== r.teamA
    out.push({ week: r.weekOrPeriod, rosterId: String(r.teamA), pointsFor: Number(r.scoreA) || 0, matchupId: hasB ? i + 1 : null })
    if (hasB) out.push({ week: r.weekOrPeriod, rosterId: String(r.teamB), pointsFor: Number(r.scoreB) || 0, matchupId: i + 1 })
  })
  return out
}

/**
 * A week counts once any team in it has a score: the provider lists the whole season's schedule up
 * front at 0, and those weeks are not "played with nothing scored".
 *
 * A result is read off the opponent's own score in the same game (same week, matchup and game
 * number), not off a stored win flag. A team with no opponent that week has a score and no result.
 */
export function buildImportedBestBallTab(rows: readonly ImportedTeamWeekRow[], teams: readonly ImportedTeam[], requestedWeek: number | null): ImportedBestBallTab {
  const nameOf = new Map<string, string>()
  for (const t of teams) if (t.externalId) nameOf.set(String(t.externalId), t.teamName?.trim() || t.ownerName?.trim() || 'Team')
  const name = (id: string) => nameOf.get(id) ?? 'Team'

  const valid = rows.filter((r) => Number.isInteger(r.week) && r.week >= 1 && r.rosterId)
  const weeksAvailable = [...new Set(valid.filter((r) => (Number(r.pointsFor) || 0) > 0).map((r) => r.week))].sort((a, b) => a - b)
  const playedWeeks = new Set(weeksAvailable)
  const selectedWeek = requestedWeek != null && playedWeeks.has(requestedWeek) ? requestedWeek : weeksAvailable[weeksAvailable.length - 1] ?? 1

  const gameKey = (r: ImportedTeamWeekRow) => `${r.week}|${r.matchupId}|${r.game ?? 1}`
  const byGame = new Map<string, ImportedTeamWeekRow[]>()
  for (const r of valid) if (r.matchupId != null) byGame.set(gameKey(r), [...(byGame.get(gameKey(r)) ?? []), r])

  // One line per team per game in a played week.
  const lines = valid
    .filter((r) => playedWeeks.has(r.week))
    .map((r) => {
      const opponent = r.matchupId == null ? undefined : (byGame.get(gameKey(r)) ?? []).find((o) => String(o.rosterId) !== String(r.rosterId))
      return { rosterId: String(r.rosterId), week: r.week, points: Number(r.pointsFor) || 0, against: opponent ? Number(opponent.pointsFor) || 0 : null }
    })
  const result = (l: { points: number; against: number | null }): Card['winLoss'] => (l.against == null ? null : l.points > l.against ? 'W' : l.points < l.against ? 'L' : 'T')

  // A team that plays several games a week (some Fantrax leagues) gets one card: its points summed, its result left out.
  const weekCards = new Map<string, { points: number; results: Array<Card['winLoss']> }>()
  for (const l of lines.filter((x) => x.week === selectedWeek)) {
    const c = weekCards.get(l.rosterId) ?? { points: 0, results: [] }
    c.points += l.points
    c.results.push(result(l))
    weekCards.set(l.rosterId, c)
  }
  const lineups: Card[] = [...weekCards.entries()]
    .map(([rosterId, c]) => ({ rosterId, teamName: name(rosterId), totalPoints: round2(c.points), winLoss: c.results.length === 1 ? c.results[0] : null, starters: [] as never[], bench: [] as never[] }))
    .sort((x, y) => y.totalPoints - x.totalPoints || x.teamName.localeCompare(y.teamName))

  const table = new Map<string, Omit<Standing, 'rank'>>()
  const weekTotals = new Map<string, { rosterId: string; week: number; totalPoints: number }>()
  for (const l of lines) {
    const row = table.get(l.rosterId) ?? { rosterId: l.rosterId, teamName: name(l.rosterId), wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
    const res = result(l)
    if (res === 'W') row.wins += 1
    else if (res === 'L') row.losses += 1
    else if (res === 'T') row.ties += 1
    row.pointsFor += l.points
    row.pointsAgainst += l.against ?? 0
    table.set(l.rosterId, row)
    const key = `${l.rosterId}|${l.week}`
    const wt = weekTotals.get(key) ?? { rosterId: l.rosterId, week: l.week, totalPoints: 0 }
    wt.totalPoints += l.points
    weekTotals.set(key, wt)
  }
  const standings: Standing[] = [...table.values()]
    .map((r) => ({ ...r, pointsFor: round2(r.pointsFor), pointsAgainst: round2(r.pointsAgainst) }))
    .sort((x, y) => y.wins - x.wins || y.pointsFor - x.pointsFor || x.teamName.localeCompare(y.teamName))
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const history = [...weekTotals.values()].map((h) => ({ ...h, totalPoints: round2(h.totalPoints) })).sort((x, y) => x.week - y.week)
  return { selectedWeek, weeksAvailable, lineups, standings, history }
}

/** Where the counted players are, for a league another platform scores. */
export function importedBestBallNote(platform: string | null | undefined): string {
  const p = String(platform ?? '').trim().toLowerCase()
  const label = ({ sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', fleaflicker: 'Fleaflicker', fantrax: 'Fantrax' } as Record<string, string>)[p] ?? 'your league’s platform'
  return `${label} picks this league’s best ball lineups. AllFantasy shows each team’s score for the week; the players that counted are on ${label}.`
}
