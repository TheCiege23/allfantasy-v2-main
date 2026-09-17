/**
 * League divisions, as the provider reports them — stored at `League.settings.standings_divisions`.
 *
 * ⚠ WHY A SETTINGS KEY AND NOT `LeagueTeam.divisionId`. That column is a foreign key to
 * `LeagueDivision`, which is the promotion/relegation TIER model (`tierLevel`, unique per league) and is
 * written only by the promotion engine. A Sleeper "East / West" split is not a tier, and writing one
 * there would put two meanings in one column — the exact failure `LeagueTeam.isOrphan` documents.
 *
 * ⚠ AND WHY IT EXISTS AT ALL. Until 2026-09-17 no importer kept a team's division: Sleeper's roster
 * `settings.division` and league `metadata.division_N`, and ESPN's team `divisionId`, were all dropped
 * on the floor, so the standings screen had nothing to group by. The key rides
 * `buildImportedLeagueSettings`, which both the initial import and the scheduled `league_state` sync
 * write through, so a league picks it up on its next sync with no backfill.
 *
 * `null` — not absent — means "the provider says this league has no divisions", so a league that
 * drops its divisions loses the stale key on the next sync instead of keeping it forever.
 */

export const STANDINGS_DIVISIONS_KEY = 'standings_divisions'

export type StandingsDivisions = {
  source: 'sleeper' | 'espn'
  /** Division key → display name. */
  names: Record<string, string>
  /** Provider team id (`LeagueTeam.externalId`) → division key. */
  teams: Record<string, string>
}

function toKey(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return null
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Two or more divisions with at least one team in each, or nothing. */
function finish(
  source: StandingsDivisions['source'],
  names: Record<string, string>,
  teams: Record<string, string>,
): StandingsDivisions | null {
  const used = new Set(Object.values(teams))
  if (used.size < 2) return null
  const kept: Record<string, string> = {}
  for (const key of used) kept[key] = names[key] ?? `Division ${key}`
  return { source, names: kept, teams }
}

/**
 * Sleeper: `league.settings.divisions` is the count, `league.metadata.division_<n>` the names, and each
 * roster's `settings.division` its 1-based division.
 */
export function readSleeperDivisions(
  league: { settings?: unknown; metadata?: unknown } | null | undefined,
  rosters: ReadonlyArray<{ roster_id: number | string; settings?: unknown }> | null | undefined,
): StandingsDivisions | null {
  const count = Number(record(league?.settings)?.divisions ?? 0)
  if (!Number.isFinite(count) || count < 2) return null
  const meta = record(league?.metadata) ?? {}
  const names: Record<string, string> = {}
  for (let i = 1; i <= count; i += 1) {
    const name = meta[`division_${i}`]
    if (typeof name === 'string' && name.trim()) names[String(i)] = name.trim()
  }
  const teams: Record<string, string> = {}
  for (const roster of rosters ?? []) {
    const key = toKey(record(roster.settings)?.division)
    const id = toKey(roster.roster_id)
    if (key && id && key !== '0') teams[id] = key
  }
  return finish('sleeper', names, teams)
}

/**
 * ESPN: `settings.scheduleSettings.divisions` carries `{ id, name, size }`, and each team a `divisionId`.
 * A league with no real divisions reports one division named "League Standings" — which `finish`
 * discards, because one group is not a split.
 */
export function readEspnDivisions(
  rawSettings: unknown,
  teams: ReadonlyArray<{ teamId: string; divisionId?: string | null }>,
): StandingsDivisions | null {
  const schedule = record(record(rawSettings)?.scheduleSettings)
  const list = Array.isArray(schedule?.divisions) ? schedule.divisions : []
  const names: Record<string, string> = {}
  for (const d of list) {
    const row = record(d)
    const key = toKey(row?.id)
    if (key != null && typeof row?.name === 'string' && row.name.trim()) names[key] = row.name.trim()
  }
  const byTeam: Record<string, string> = {}
  for (const t of teams) {
    const key = toKey(t.divisionId)
    if (key != null && t.teamId) byTeam[t.teamId] = key
  }
  return finish('espn', names, byTeam)
}

/** Read the stored key back. Anything malformed reads as "no divisions". */
export function parseStandingsDivisions(settings: unknown): StandingsDivisions | null {
  const raw = record(record(settings)?.[STANDINGS_DIVISIONS_KEY])
  if (!raw) return null
  const names = record(raw.names)
  const teams = record(raw.teams)
  if (!names || !teams) return null
  const cleanNames: Record<string, string> = {}
  for (const [k, v] of Object.entries(names)) if (typeof v === 'string') cleanNames[k] = v
  const cleanTeams: Record<string, string> = {}
  for (const [k, v] of Object.entries(teams)) if (typeof v === 'string') cleanTeams[k] = v
  const source = raw.source === 'espn' ? 'espn' : 'sleeper'
  return finish(source, cleanNames, cleanTeams)
}
