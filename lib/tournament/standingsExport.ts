/**
 * The commissioner's standings sheet, built rather than typed.
 *
 * 🛑 THIS IS THE HOURS. A 240-manager tournament is recomputed by hand every
 * week into a spreadsheet whose layout is already fixed — RANK, Team Name, W/L,
 * Total Pts, Conference, Conference Pts, in per-league blocks with the rank
 * restarting at 1 inside each. The engine can produce those numbers; what was
 * missing was a way to get them into the sheet without retyping them.
 *
 * ⚠ THE OUTPUT IS TAB-SEPARATED, NOT CSV, BECAUSE IT IS FOR A CLIPBOARD.
 * Pasting TSV into Excel or Sheets fills cells directly. CSV pasted into a
 * spreadsheet lands as one column of text per row and has to be run through
 * Text-to-Columns — which is a step back towards the manual work this removes.
 *
 * ⚠ AND IT DOES NOT WRITE A FILE. The commissioner keeps their own workbook,
 * with their own formatting, banners and hand-added notes; generating a fresh
 * workbook would either discard that or force them to merge two. Pasting a block
 * into the sheet they already have preserves everything around it.
 *
 * Pure functions on purpose — no prisma, no `server-only`. The same builder runs
 * in a route and in a test, and a layout this exacting is worth asserting
 * character by character.
 */

export type ExportTeamRow = {
  /** Rank WITHIN its league block, 1-based. */
  rank: number
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /**
   * True when this row's record could not be sourced from an import.
   *
   * ⚠ MISSING IS NOT ZERO, and this is the column where that distinction gets
   * someone eliminated. A manager whose team row did not match is not a manager
   * who scored nothing.
   */
  unmatched?: boolean
}

export type ExportLeagueBlock = {
  /** The league's own name — BEAST, GOAT, GRIZZ. Fills the "Conference" column. */
  leagueName: string
  rows: ExportTeamRow[]
}

export type ConferenceStandingsExport = {
  /** Header row plus one block per league, blank-separated, as the sheet is laid out. */
  tsv: string
  /** Rows whose record could not be matched — surfaced, never silently zeroed. */
  unmatchedCount: number
}

const HEADER = ['RANK', 'Team Name', 'W/L', 'Total Pts', 'Conference', 'Conference Pts']

/** `6-3`, or `6-3-1` when there are ties. A 0-tie league should not carry a `-0`. */
export function formatRecord(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
}

/**
 * Two decimals, always.
 *
 * ⚠ FIXED PRECISION IS NOT COSMETIC HERE — points-for is the FIRST tiebreaker
 * after W/L, so the hundredths decide who advances. Rounding to whole points
 * would manufacture ties that the real numbers do not have, and a manufactured
 * tie in this format is resolved by something arbitrary.
 */
export function formatPoints(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

/**
 * Build the paste-ready block for one conference.
 *
 * ⚠ "Conference Pts" IS PRINTED ONCE PER LEAGUE, ON THAT LEAGUE'S FIRST ROW,
 * matching the sheet. Repeating it down every row would make a column of
 * identical numbers that sums wrongly if anyone ever totals it.
 *
 * ⚠ AN UNMATCHED ROW CONTRIBUTES NOTHING TO THE LEAGUE TOTAL. Counting a
 * placeholder zero would understate a league's combined points against the
 * others, and that total is what the conference is compared on.
 */
export function buildConferenceStandingsExport(
  blocks: ExportLeagueBlock[],
): ConferenceStandingsExport {
  const lines: string[] = [HEADER.join('\t')]
  let unmatchedCount = 0

  blocks.forEach((block, blockIndex) => {
    if (blockIndex > 0) lines.push('')

    const leagueTotal = block.rows.reduce(
      (sum, r) => (r.unmatched ? sum : sum + (Number.isFinite(r.pointsFor) ? r.pointsFor : 0)),
      0,
    )

    block.rows.forEach((row, rowIndex) => {
      if (row.unmatched) unmatchedCount += 1
      lines.push(
        [
          String(row.rank),
          row.teamName,
          /* An unmatched row prints nothing rather than 0-0 / 0.00 — a blank cell
             reads as "not known", which is what it is. */
          row.unmatched ? '' : formatRecord(row.wins, row.losses, row.ties),
          row.unmatched ? '' : formatPoints(row.pointsFor),
          block.leagueName,
          rowIndex === 0 ? formatPoints(leagueTotal) : '',
        ].join('\t'),
      )
    })
  })

  return { tsv: lines.join('\n'), unmatchedCount }
}

export type TopScorer = {
  rank: number
  teamName: string
  leagueName: string
  pointsFor: number
}

/**
 * Season points leaders across every league in the conference.
 *
 * ⚠ SEASON TOTALS, NOT "PLAYER OF THE WEEK". Those are different questions from
 * different data: this one is a sort of the same team rows the sheet already
 * carries, whereas a weekly player award needs per-player weekly scoring, which
 * an imported league only has if the matchup history was captured. Producing a
 * plausible-looking weekly award from season totals would be a fabrication in a
 * table people trust, so this function does not attempt it.
 */
export function buildTopScorers(blocks: ExportLeagueBlock[], limit = 10): TopScorer[] {
  const all = blocks.flatMap((b) =>
    b.rows
      .filter((r) => !r.unmatched)
      .map((r) => ({ teamName: r.teamName, leagueName: b.leagueName, pointsFor: r.pointsFor })),
  )
  all.sort((a, b) => b.pointsFor - a.pointsFor)
  return all.slice(0, Math.max(0, limit)).map((r, i) => ({ ...r, rank: i + 1 }))
}

export function buildTopScorersExport(scorers: TopScorer[]): string {
  const lines = [['RANK', 'Team Name', 'League', 'Total Pts'].join('\t')]
  for (const s of scorers) {
    lines.push([String(s.rank), s.teamName, s.leagueName, formatPoints(s.pointsFor)].join('\t'))
  }
  return lines.join('\n')
}

export type RedraftExportLeague = {
  name: string
  managers: Array<{
    seed: number
    displayName: string
    fromLeague: string
    wins: number
    losses: number
    pointsFor: number
  }>
}

/**
 * The redraft assignment, as something a commissioner can act on.
 *
 * 🛑 THIS IS THE DELIVERABLE FOR AN IMPORTED TOURNAMENT. AllFantasy cannot
 * create a league on the host platform, so the redraft "happening" means the
 * commissioner building eight new leagues by hand and inviting the right sixteen
 * people to each. The useful output is therefore not a button — it is an
 * accurate, ordered list they can work down without cross-referencing anything.
 *
 * ⚠ ONE BLOCK PER NEW LEAGUE, because that is the unit of work. A single flat
 * table of 128 names sorted by seed cannot be worked through one league at a
 * time, which is the only way anybody would actually do this.
 */
export function buildRedraftExport(
  conferenceName: string,
  leagues: RedraftExportLeague[],
): string {
  const lines: string[] = []
  leagues.forEach((league, index) => {
    if (index > 0) lines.push('')
    lines.push(`${league.name}  (${league.managers.length} teams)`)
    lines.push(['SEED', 'Manager', 'From', 'W/L', 'Total Pts'].join('\t'))
    for (const m of league.managers) {
      lines.push(
        [
          String(m.seed),
          m.displayName,
          m.fromLeague,
          formatRecord(m.wins, m.losses, 0),
          formatPoints(m.pointsFor),
        ].join('\t'),
      )
    }
  })
  return `${conferenceName} — REDRAFT\n\n${lines.join('\n')}`
}

/**
 * Every advancing manager, one flat list.
 *
 * ⚠ A SECOND SHAPE ON PURPOSE, not a duplicate of the blocks above. Inviting
 * people is per-league; ANNOUNCING who advanced is one list, and pasting the
 * per-league blocks into a chat to answer "did I make it?" makes 128 people read
 * eight tables to find themselves.
 */
export function buildAdvancerList(
  leagues: RedraftExportLeague[],
): string {
  const all = leagues.flatMap((l) => l.managers.map((m) => ({ ...m, league: l.name })))
  all.sort((a, b) => a.seed - b.seed)
  const lines = [['SEED', 'Manager', 'Goes to', 'W/L', 'Total Pts'].join('\t')]
  for (const m of all) {
    lines.push(
      [
        String(m.seed),
        m.displayName,
        m.league,
        formatRecord(m.wins, m.losses, 0),
        formatPoints(m.pointsFor),
      ].join('\t'),
    )
  }
  return lines.join('\n')
}
