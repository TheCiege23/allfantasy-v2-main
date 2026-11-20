/**
 * A commissioner's own contract sheet, for a salary cap league imported from another platform.
 *
 * Sleeper and the other providers carry no salaries or contract years, so an imported cap league keeps
 * them in a spreadsheet. Until this existed AllFantasy could only create a contract through its own
 * startup auction, rookie deals, bids and extensions, and all 12 imported cap leagues in production
 * showed an empty cap (lib/salary-cap/importedContractsNote.ts).
 *
 * Pure: text in, matched contracts and a list of what could not be read out. Nothing is guessed. A row
 * whose team or player does not match exactly one thing is reported, never attached to the nearest name.
 */

export type ContractSheetRow = { line: number; text: string; team: string; player: string; salary: number; yearsTotal: number; contractYear: number }
export type ContractSheetProblem = { line: number; text: string; reason: string }

export type CapTeam = { rosterId: string; names: ReadonlyArray<string | null | undefined> }
export type CapRosterPlayer = { rosterId: string; playerId: string; name: string; position: string | null }

export type MatchedContract = { line: number; rosterId: string; teamName: string; playerId: string; playerName: string; position: string | null; salary: number; yearsTotal: number; contractYear: number }

export const MAX_CONTRACT_YEARS = 10
export const MAX_CONTRACT_ROWS = 2000

const HEADER_WORDS = /^(team|franchise|owner|manager)$/i

/** Names compared without case, punctuation, accents or a generational suffix. */
export function nameKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cells(line: string): string[] {
  // A sheet pasted from a spreadsheet is tab-separated; a typed or exported one is comma-separated,
  // where a quoted cell may hold commas of its own ("$45,000,000").
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim())
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) { out.push(cell.trim()); cell = '' }
    else cell += ch
  }
  out.push(cell.trim())
  return out
}

function money(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n) : null
}

function wholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null
}

/**
 * Columns, in order: team, player, salary, years on the contract, and optionally which year of it this
 * season is (1 when left out). A first line naming the columns is skipped.
 */
export function parseContractSheet(text: string): { rows: ContractSheetRow[]; problems: ContractSheetProblem[] } {
  const rows: ContractSheetRow[] = []
  const problems: ContractSheetProblem[] = []
  const lines = String(text ?? '').split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = i + 1
    const textLine = raw.trim()
    if (!textLine) return
    const c = cells(textLine)
    if (rows.length === 0 && problems.length === 0 && HEADER_WORDS.test(c[0] ?? '')) return
    const bad = (reason: string) => problems.push({ line, text: textLine.slice(0, 160), reason })
    if (rows.length >= MAX_CONTRACT_ROWS) return bad(`Only the first ${MAX_CONTRACT_ROWS} rows are read`)
    if (c.length < 4) return bad('Needs four columns: team, player, salary, years')
    const [team, player, salaryText, yearsText, yearText] = c
    if (!team || !player) return bad('Team and player cannot be empty')
    const salary = money(salaryText ?? '')
    if (salary == null) return bad(`Salary "${salaryText}" is not a number`)
    const yearsTotal = wholeNumber(yearsText ?? '')
    if (yearsTotal == null || yearsTotal < 1 || yearsTotal > MAX_CONTRACT_YEARS) return bad(`Years "${yearsText}" must be a whole number from 1 to ${MAX_CONTRACT_YEARS}`)
    const contractYear = yearText == null || yearText === '' ? 1 : wholeNumber(yearText)
    if (contractYear == null || contractYear < 1 || contractYear > yearsTotal) return bad(`Contract year "${yearText}" must be between 1 and the ${yearsTotal} year${yearsTotal === 1 ? '' : 's'} on the contract`)
    rows.push({ line, text: textLine.slice(0, 160), team, player, salary, yearsTotal, contractYear })
  })
  return { rows, problems }
}

/**
 * Attach each row to one roster and one player ON that roster. A team name matching no roster or more
 * than one, a player not on that roster (or matching two of its players), and a player listed twice are
 * each reported with the line they came from.
 */
export function matchContractSheet(
  rows: readonly ContractSheetRow[],
  teams: readonly CapTeam[],
  players: readonly CapRosterPlayer[],
): { matched: MatchedContract[]; problems: ContractSheetProblem[] } {
  const rostersByName = new Map<string, Set<string>>()
  for (const t of teams) {
    for (const n of t.names) {
      const key = nameKey(n)
      if (!key) continue
      rostersByName.set(key, (rostersByName.get(key) ?? new Set()).add(t.rosterId))
    }
  }
  const playersByRoster = new Map<string, Map<string, CapRosterPlayer[]>>()
  for (const p of players) {
    const key = nameKey(p.name)
    if (!key) continue
    const byName = playersByRoster.get(p.rosterId) ?? new Map<string, CapRosterPlayer[]>()
    byName.set(key, [...(byName.get(key) ?? []), p])
    playersByRoster.set(p.rosterId, byName)
  }

  const matched: MatchedContract[] = []
  const problems: ContractSheetProblem[] = []
  const seen = new Map<string, number>()
  for (const row of rows) {
    const bad = (reason: string) => problems.push({ line: row.line, text: row.text, reason })
    const rosterIds = [...(rostersByName.get(nameKey(row.team)) ?? [])]
    if (rosterIds.length === 0) { bad(`No team in this league is called "${row.team}"`); continue }
    if (rosterIds.length > 1) { bad(`More than one team matches "${row.team}"; use the team name instead of the manager name`); continue }
    const rosterId = rosterIds[0]
    const onRoster = playersByRoster.get(rosterId)
    // Sheets often write "Last, First". Only tried when the name as written matched nobody.
    const flipped = row.player.includes(',') ? row.player.split(',').map((s) => s.trim()).reverse().join(' ') : null
    const direct = onRoster?.get(nameKey(row.player)) ?? []
    const hits = direct.length > 0 || !flipped ? direct : onRoster?.get(nameKey(flipped)) ?? []
    if (hits.length === 0) { bad(`${row.player} is not on ${row.team}'s roster`); continue }
    if (hits.length > 1) { bad(`Two players on ${row.team} are called ${row.player}`); continue }
    const player = hits[0]
    const dupKey = `${rosterId}|${player.playerId}`
    const first = seen.get(dupKey)
    if (first != null) { bad(`${row.player} is already listed on line ${first}`); continue }
    seen.set(dupKey, row.line)
    matched.push({ line: row.line, rosterId, teamName: row.team, playerId: player.playerId, playerName: player.name, position: player.position, salary: row.salary, yearsTotal: row.yearsTotal, contractYear: row.contractYear })
  }
  return { matched, problems }
}

/** The season a contract was signed in, from which year of it the current season is. */
export function yearSignedFor(capYear: number, contractYear: number): number {
  return capYear - (contractYear - 1)
}

/** What the preview shows for each team: how many contracts and what they cost this season. */
export function contractTotalsByTeam(matched: readonly MatchedContract[]): Array<{ rosterId: string; teamName: string; contracts: number; capHit: number }> {
  const out = new Map<string, { rosterId: string; teamName: string; contracts: number; capHit: number }>()
  for (const m of matched) {
    const row = out.get(m.rosterId) ?? { rosterId: m.rosterId, teamName: m.teamName, contracts: 0, capHit: 0 }
    row.contracts += 1
    row.capHit += m.salary
    out.set(m.rosterId, row)
  }
  return [...out.values()].sort((a, b) => b.capHit - a.capHit || a.teamName.localeCompare(b.teamName))
}

/** `PlayerContract.source` for a contract the commissioner uploaded from their own sheet. */
export const COMMISSIONER_IMPORT_SOURCE = 'commissioner_import'
