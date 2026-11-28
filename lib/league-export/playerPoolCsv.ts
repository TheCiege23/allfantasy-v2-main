/**
 * "Download player CSV" — every player in a league's pool, who holds them, and where they sit.
 *
 * Pure: the loader (`playerPoolCsvLoad.ts`) reads the pool, the rosters and the ADP board and hands
 * them here. Kept pure so the matching and the CSV escaping are tested without a database.
 *
 * ⚠ EVERY ROSTERED PLAYER IS A ROW, EVEN ONE THE POOL DOES NOT CARRY. A devy prospect on a pro roster,
 * or an id the player tables have never seen, is still on somebody's team. Dropping it would make the
 * export say the team has fewer players than it does, so it comes out with its id, its team and
 * "Not in the AllFantasy player list" in place of a name.
 *
 * ⚠ ROSTER IDS ARE MATCHED ON THE AF ID FIRST, THEN THE SLEEPER ID, THEN THE PROVIDER ID. An imported
 * Sleeper league stores Sleeper ids, a native league stores AF ids, and a numeric provider id can
 * collide with a Sleeper id (lib/sport-teams/types.ts), so the provider id is the last resort.
 */

export type CsvPoolPlayer = {
  afId: string
  sleeperId: string | null
  providerId: string | null
  name: string
  position: string
  team: string | null
  injury: string | null
}

export type CsvRoster = {
  rosterId: string
  teamName: string
  managerName: string
  playerData: unknown
}

export type RosterSpot = 'Starter' | 'Bench' | 'IR' | 'Taxi' | 'Devy'

export type PlayerPoolCsvRow = {
  afId: string
  sleeperId: string
  providerId: string
  name: string
  position: string
  team: string
  status: string
  fantasyTeam: string
  manager: string
  adp: string
  injury: string
}

export const PLAYER_POOL_CSV_COLUMNS: ReadonlyArray<[keyof PlayerPoolCsvRow, string]> = [
  ['name', 'Player'],
  ['position', 'Position'],
  ['team', 'Team'],
  ['status', 'Roster status'],
  ['fantasyTeam', 'Fantasy team'],
  ['manager', 'Manager'],
  ['adp', 'ADP'],
  ['injury', 'Injury'],
  ['afId', 'AllFantasy ID'],
  ['sleeperId', 'Sleeper ID'],
  ['providerId', 'Provider ID'],
]

export const NOT_IN_POOL = 'Not in the AllFantasy player list'

function idOf(row: unknown): string {
  if (typeof row === 'string' || typeof row === 'number') return String(row).trim()
  if (row && typeof row === 'object') {
    const o = row as Record<string, unknown>
    return String(o.id ?? o.playerId ?? o.player_id ?? '').trim()
  }
  return ''
}

function idsIn(v: unknown): string[] {
  return Array.isArray(v) ? v.map(idOf).filter((id) => id && id !== '0' && id !== 'null') : []
}

/**
 * Where each player sits on one roster. `lineup_sections` when the roster has them (native leagues),
 * else the top-level `starters` / `reserve` / `ir` / `taxi` arrays imported leagues carry. Anything
 * else on the roster is on the bench.
 */
export function rosterSpots(playerData: unknown): Map<string, RosterSpot> {
  const spots = new Map<string, RosterSpot>()
  if (Array.isArray(playerData)) {
    for (const id of idsIn(playerData)) spots.set(id, 'Bench')
    return spots
  }
  if (!playerData || typeof playerData !== 'object') return spots
  const o = playerData as Record<string, unknown>
  const sections =
    o.lineup_sections && typeof o.lineup_sections === 'object' && !Array.isArray(o.lineup_sections)
      ? (o.lineup_sections as Record<string, unknown>)
      : null
  const put = (ids: string[], spot: RosterSpot) => {
    for (const id of ids) if (!spots.has(id)) spots.set(id, spot)
  }
  // Most specific first: a player listed in IR and in `players` is on IR.
  if (sections) {
    put(idsIn(sections.ir), 'IR')
    put(idsIn(sections.taxi), 'Taxi')
    put(idsIn(sections.devy), 'Devy')
    put(idsIn(sections.starters), 'Starter')
    put(idsIn(sections.bench), 'Bench')
  }
  put(idsIn(o.reserve), 'IR')
  put(idsIn(o.ir), 'IR')
  put(idsIn(o.taxi), 'Taxi')
  put(idsIn(o.devy), 'Devy')
  put(idsIn(o.starters), 'Starter')
  put(idsIn(o.players), 'Bench')
  return spots
}

export function buildPlayerPoolCsvRows(input: {
  pool: CsvPoolPlayer[]
  rosters: CsvRoster[]
  /** ADP by `buildPlayerKey(name, position)`. */
  adpByKey: ReadonlyMap<string, number>
  playerKey: (name: string, position: string) => string
}): PlayerPoolCsvRow[] {
  const byAf = new Map<string, CsvPoolPlayer>()
  const bySleeper = new Map<string, CsvPoolPlayer>()
  const byProvider = new Map<string, CsvPoolPlayer>()
  for (const p of input.pool) {
    if (!byAf.has(p.afId)) byAf.set(p.afId, p)
    if (p.sleeperId && !bySleeper.has(p.sleeperId)) bySleeper.set(p.sleeperId, p)
    if (p.providerId && !byProvider.has(p.providerId)) byProvider.set(p.providerId, p)
  }
  const resolve = (id: string) => byAf.get(id) ?? bySleeper.get(id) ?? byProvider.get(id) ?? null

  const held = new Map<string, { roster: CsvRoster; spot: RosterSpot; rosterPlayerId: string }>()
  const unmatched: Array<{ id: string; roster: CsvRoster; spot: RosterSpot }> = []
  for (const roster of input.rosters) {
    for (const [id, spot] of rosterSpots(roster.playerData)) {
      const p = resolve(id)
      if (!p) unmatched.push({ id, roster, spot })
      else if (!held.has(p.afId)) held.set(p.afId, { roster, spot, rosterPlayerId: id })
    }
  }

  const adpOf = (p: CsvPoolPlayer) => {
    const v = input.adpByKey.get(input.playerKey(p.name, p.position))
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  const rows: Array<PlayerPoolCsvRow & { _adp: number | null; _held: boolean }> = input.pool.map((p) => {
    const h = held.get(p.afId)
    const adp = adpOf(p)
    return {
      afId: p.afId,
      sleeperId: p.sleeperId ?? '',
      providerId: p.providerId ?? '',
      name: p.name,
      position: p.position,
      team: p.team ?? '',
      status: h ? h.spot : 'Free agent',
      fantasyTeam: h ? h.roster.teamName : '',
      manager: h ? h.roster.managerName : '',
      adp: adp == null ? '' : adp.toFixed(1),
      injury: p.injury ?? '',
      _adp: adp,
      _held: Boolean(h),
    }
  })
  for (const u of unmatched) {
    rows.push({
      afId: '',
      sleeperId: '',
      providerId: u.id,
      name: NOT_IN_POOL,
      position: '',
      team: '',
      status: u.spot,
      fantasyTeam: u.roster.teamName,
      manager: u.roster.managerName,
      adp: '',
      injury: '',
      _adp: null,
      _held: true,
    })
  }

  // Rostered players first (by fantasy team), then free agents by ADP, then the rest by name.
  rows.sort((a, b) => {
    if (a._held !== b._held) return a._held ? -1 : 1
    if (a._held) return a.fantasyTeam.localeCompare(b.fantasyTeam) || a.status.localeCompare(b.status) || a.name.localeCompare(b.name)
    if ((a._adp == null) !== (b._adp == null)) return a._adp == null ? 1 : -1
    if (a._adp != null && b._adp != null && a._adp !== b._adp) return a._adp - b._adp
    return a.name.localeCompare(b.name)
  })
  return rows.map(({ _adp, _held, ...row }) => row)
}

/**
 * One CSV cell. Quotes anything with a comma, quote or newline, and defuses a cell that a spreadsheet
 * would run as a formula (a player or team name starting with `=`, `+`, `-` or `@`) by prefixing `'`.
 */
export function csvCell(value: string): string {
  let v = value
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toPlayerPoolCsv(rows: PlayerPoolCsvRow[]): string {
  const lines = [PLAYER_POOL_CSV_COLUMNS.map(([, header]) => csvCell(header)).join(',')]
  for (const row of rows) lines.push(PLAYER_POOL_CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','))
  // CRLF and a UTF-8 BOM: without the BOM, Excel garbles accented names like Muñoz.
  return `﻿${lines.join('\r\n')}\r\n`
}

/** `peach-bowl-c2c-players-2026.csv` */
export function playerPoolCsvFilename(leagueName: string | null, season: number | null): string {
  const slug =
    String(leagueName ?? 'league')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'league'
  return `${slug}-players${season ? `-${season}` : ''}.csv`
}
