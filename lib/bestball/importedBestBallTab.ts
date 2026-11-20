/**
 * The Best Ball tab for a league imported from another platform, built from the weekly team scores we
 * already store (`dw_matchup_facts`).
 *
 * 🛑 THE TAB WAS EMPTY FOR EVERY IMPORTED BEST BALL LEAGUE. It listed weeks from `team_week_results`
 * and lineups from `weekly_scores`, which only a legacy processor filled. Measured on production
 * 2026-11-20: 141 best ball leagues, all imported from Sleeper; `team_week_results` holds 0 rows and
 * `weekly_scores` holds none for any of them, so every one read "No scored weeks yet" in week 11 —
 * while 139 of them have this season's weekly scores in `dw_matchup_facts`.
 *
 * What we store for an import is each TEAM's score for the week, not which players the provider
 * counted. So a card carries the team's total and its result, and says where the counted players are;
 * it never invents a lineup.
 *
 * Pure: the handler loads rows, this shapes them.
 */

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
const played = (r: ImportedMatchupRow) => (Number(r.scoreA) || 0) > 0 || (Number(r.scoreB) || 0) > 0

/**
 * A week counts once any game in it has a score: the provider lists the whole season's schedule up
 * front at 0-0, and those weeks are not "played with nothing scored".
 */
export function buildImportedBestBallTab(rows: readonly ImportedMatchupRow[], teams: readonly ImportedTeam[], requestedWeek: number | null): ImportedBestBallTab {
  const nameOf = new Map<string, string>()
  for (const t of teams) if (t.externalId) nameOf.set(String(t.externalId), t.teamName?.trim() || t.ownerName?.trim() || 'Team')
  const name = (id: string) => nameOf.get(id) ?? 'Team'

  const scored = rows.filter((r) => Number.isInteger(r.weekOrPeriod) && r.weekOrPeriod >= 1 && r.teamA && played(r))
  const weeksAvailable = [...new Set(scored.map((r) => r.weekOrPeriod))].sort((a, b) => a - b)
  const selectedWeek = requestedWeek != null && weeksAvailable.includes(requestedWeek) ? requestedWeek : weeksAvailable[weeksAvailable.length - 1] ?? 1

  // One line per team per week. A bye (no opponent) is a score with no result.
  const lines: Array<{ rosterId: string; week: number; points: number; against: number | null }> = []
  for (const r of scored) {
    const a = Number(r.scoreA) || 0
    const b = Number(r.scoreB) || 0
    const hasB = Boolean(r.teamB) && r.teamB !== r.teamA
    lines.push({ rosterId: String(r.teamA), week: r.weekOrPeriod, points: a, against: hasB ? b : null })
    if (hasB) lines.push({ rosterId: String(r.teamB), week: r.weekOrPeriod, points: b, against: a })
  }
  const result = (l: { points: number; against: number | null }): Card['winLoss'] => (l.against == null ? null : l.points > l.against ? 'W' : l.points < l.against ? 'L' : 'T')

  const lineups: Card[] = lines
    .filter((l) => l.week === selectedWeek)
    .map((l) => ({ rosterId: l.rosterId, teamName: name(l.rosterId), totalPoints: round2(l.points), winLoss: result(l), starters: [], bench: [] }))
    .sort((x, y) => y.totalPoints - x.totalPoints || x.teamName.localeCompare(y.teamName))

  const table = new Map<string, Omit<Standing, 'rank'>>()
  for (const l of lines) {
    const row = table.get(l.rosterId) ?? { rosterId: l.rosterId, teamName: name(l.rosterId), wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
    const res = result(l)
    if (res === 'W') row.wins += 1
    else if (res === 'L') row.losses += 1
    else if (res === 'T') row.ties += 1
    row.pointsFor += l.points
    row.pointsAgainst += l.against ?? 0
    table.set(l.rosterId, row)
  }
  const standings: Standing[] = [...table.values()]
    .map((r) => ({ ...r, pointsFor: round2(r.pointsFor), pointsAgainst: round2(r.pointsAgainst) }))
    .sort((x, y) => y.wins - x.wins || y.pointsFor - x.pointsFor || x.teamName.localeCompare(y.teamName))
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const history = lines.map((l) => ({ rosterId: l.rosterId, week: l.week, totalPoints: round2(l.points) })).sort((x, y) => x.week - y.week)
  return { selectedWeek, weeksAvailable, lineups, standings, history }
}

/** Where the counted players are, for a league another platform scores. */
export function importedBestBallNote(platform: string | null | undefined): string {
  const p = String(platform ?? '').trim().toLowerCase()
  const label = ({ sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', fleaflicker: 'Fleaflicker', fantrax: 'Fantrax' } as Record<string, string>)[p] ?? 'your league’s platform'
  return `${label} picks this league’s best ball lineups. AllFantasy shows each team’s score for the week; the players that counted are on ${label}.`
}
