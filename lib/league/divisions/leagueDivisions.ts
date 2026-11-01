/**
 * Commissioner-set divisions for an AllFantasy league — `League.settings.division_config`.
 *
 * The commissioner screen (components/league-settings/DivisionSettingsCommissionerPanel.tsx →
 * PUT /api/commissioner/leagues/[leagueId]/division-settings) has stored this key since before it
 * did anything: nothing read it back, so a league could name its divisions and assign every team and
 * the standings, the schedule and the playoff seeds all ignored it. This module is the one reader.
 *
 * ⚠ NOT `LeagueTeam.divisionId`. That column points at `LeagueDivision`, the promotion/relegation TIER
 * model, and is written only by the promotion engine (see lib/league-import/standingsDivisions.ts for
 * the same reasoning on imported divisions). These divisions are a settings key keyed by `LeagueTeam.id`.
 *
 * ⚠ HOW A SEASON ROSTER FINDS ITS TEAM. Native leagues link three ids: `LeagueTeam.externalId` is the
 * generic `Roster.id`, and that roster's `platformUserId` is the season roster's `ownerId`
 * (lib/redraft/standingsEngine.ts `mirrorNativeLeagueTeamRecords`). `matchLeagueTeam` takes every id a
 * caller holds for a roster and accepts any of those links.
 *
 * Pure: no prisma. The loaders live beside it (loadLeagueDivisions.ts).
 */

export const DIVISION_CONFIG_KEY = 'division_config'

/**
 * What a division title is worth in the playoffs.
 * - `top_seeds`: every division winner qualifies and takes the top seeds (best winner is #1), the
 *   default once divisions are on.
 * - `guaranteed`: every division winner qualifies, but the whole field is seeded by record.
 * - `none`: divisions are for the standings only.
 */
export type DivisionPlayoffRule = 'top_seeds' | 'guaranteed' | 'none'
export const DIVISION_PLAYOFF_RULES: readonly DivisionPlayoffRule[] = ['top_seeds', 'guaranteed', 'none']
export const DEFAULT_DIVISION_PLAYOFF_RULE: DivisionPlayoffRule = 'top_seeds'

/** Division counts a standard league may pick. Survivor tribes keep their own 2/4/8 on the same route. */
export const STANDARD_DIVISION_COUNTS: readonly number[] = [0, 2, 3, 4]
export const SURVIVOR_TRIBE_COUNTS: readonly number[] = [0, 2, 4, 8]
export const DIVISION_NAME_MAX = 80

export type LeagueDivisionConfig = {
  count: number
  names: string[]
  /** `LeagueTeam.id` → division index (0-based). */
  teamAssignments: Record<string, number>
  aiNamingEnabled: boolean
  playoffRule: DivisionPlayoffRule
  /**
   * Play every division rival a second time (home and away swapped) after the full round robin.
   * Off by default; with it off the schedule is exactly what it was before this setting existed.
   */
  rivalsTwice: boolean
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

export type LeagueDivision = { key: string; index: number; name: string }

export type ActiveLeagueDivisions = {
  divisions: LeagueDivision[]
  /** `LeagueTeam.id` → division key. */
  teamDivision: Map<string, string>
  playoffRule: DivisionPlayoffRule
  rivalsTwice: boolean
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function divisionKey(index: number): string {
  return `div-${index + 1}`
}

export function readDivisionPlayoffRule(v: unknown): DivisionPlayoffRule {
  return typeof v === 'string' && (DIVISION_PLAYOFF_RULES as readonly string[]).includes(v)
    ? (v as DivisionPlayoffRule)
    : DEFAULT_DIVISION_PLAYOFF_RULE
}

export function defaultDivisionConfig(): LeagueDivisionConfig {
  return {
    count: 0,
    names: [],
    teamAssignments: {},
    aiNamingEnabled: false,
    playoffRule: DEFAULT_DIVISION_PLAYOFF_RULE,
    rivalsTwice: false,
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
}

/** The stored config, normalised. Anything malformed reads as its default. */
export function readDivisionConfig(settings: unknown): LeagueDivisionConfig {
  const raw = record(record(settings)?.[DIVISION_CONFIG_KEY])
  if (!raw) return defaultDivisionConfig()
  const count = Number.isInteger(raw.count) && (raw.count as number) > 0 ? (raw.count as number) : 0
  const names = Array.isArray(raw.names) ? raw.names.map((n) => String(n ?? '')) : []
  const teamAssignments: Record<string, number> = {}
  for (const [teamId, idx] of Object.entries(record(raw.teamAssignments) ?? {})) {
    if (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < count) teamAssignments[teamId] = idx
  }
  return {
    count,
    names,
    teamAssignments,
    aiNamingEnabled: raw.aiNamingEnabled === true,
    playoffRule: readDivisionPlayoffRule(raw.playoffRule),
    rivalsTwice: raw.rivalsTwice === true,
    lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : null,
    lastUpdatedBy: typeof raw.lastUpdatedBy === 'string' ? raw.lastUpdatedBy : null,
  }
}

/**
 * The divisions a league is actually playing with: two or more, with at least one team assigned.
 * `null` means "no divisions", and every consumer then behaves exactly as before this existed.
 */
export function parseActiveLeagueDivisions(settings: unknown): ActiveLeagueDivisions | null {
  const config = readDivisionConfig(settings)
  if (config.count < 2) return null
  const divisions: LeagueDivision[] = Array.from({ length: config.count }, (_, index) => ({
    key: divisionKey(index),
    index,
    name: config.names[index]?.trim() || `Division ${index + 1}`,
  }))
  const teamDivision = new Map<string, string>()
  for (const [teamId, idx] of Object.entries(config.teamAssignments)) teamDivision.set(teamId, divisionKey(idx))
  if (teamDivision.size === 0) return null
  return { divisions, teamDivision, playoffRule: config.playoffRule, rivalsTwice: config.rivalsTwice }
}

/** The ids that identify one league team, for `matchLeagueTeam`. */
export type LeagueTeamIdentity = {
  id: string
  externalId?: string | null
  claimedByUserId?: string | null
  platformUserId?: string | null
}

/**
 * The league team a roster belongs to, from any ids the caller has for it (a generic `Roster.id`, its
 * `platformUserId`, a season roster's `ownerId`). Exact id matches only — never names, which repeat.
 */
export function matchLeagueTeam(
  rosterIds: ReadonlyArray<string | null | undefined>,
  teams: ReadonlyArray<LeagueTeamIdentity>,
): LeagueTeamIdentity | null {
  const wanted = new Set(rosterIds.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))
  if (wanted.size === 0) return null
  return (
    teams.find((t) => wanted.has(t.id)) ??
    teams.find((t) => t.externalId != null && wanted.has(t.externalId)) ??
    teams.find((t) => t.claimedByUserId != null && wanted.has(t.claimedByUserId)) ??
    teams.find((t) => t.platformUserId != null && wanted.has(t.platformUserId)) ??
    null
  )
}

/** Each roster's division (or none), keyed by the roster id the caller passed. */
export function resolveRosterDivisions(
  active: ActiveLeagueDivisions,
  teams: ReadonlyArray<LeagueTeamIdentity>,
  rosters: ReadonlyArray<{ rosterId: string; ids: ReadonlyArray<string | null | undefined> }>,
): Map<string, LeagueDivision> {
  const byKey = new Map(active.divisions.map((d) => [d.key, d]))
  const out = new Map<string, LeagueDivision>()
  for (const roster of rosters) {
    const team = matchLeagueTeam([roster.rosterId, ...roster.ids], teams)
    const key = team ? active.teamDivision.get(team.id) : undefined
    const division = key ? byKey.get(key) : undefined
    if (division) out.set(roster.rosterId, division)
  }
  return out
}

/**
 * What a season's schedule needs from the commissioner's divisions: each season roster's division and
 * whether rivals meet twice. `null` when the league has no divisions — the schedule is then built
 * exactly as before divisions existed.
 */
export function scheduleDivisionsForRosters(
  settings: unknown,
  teams: ReadonlyArray<LeagueTeamIdentity>,
  rosters: ReadonlyArray<{ rosterId: string; ids: ReadonlyArray<string | null | undefined> }>,
): { byRoster: Map<string, LeagueDivision>; rivalsTwice: boolean } | null {
  const active = parseActiveLeagueDivisions(settings)
  if (!active) return null
  return { byRoster: resolveRosterDivisions(active, teams, rosters), rivalsTwice: active.rivalsTwice }
}

/* ── Validation ─────────────────────────────────────────────────────── */

export type DivisionSetupInput = {
  count: number
  names: string[]
  teamAssignments: Record<string, number>
  playoffRule?: unknown
  rivalsTwice?: unknown
}

export type DivisionSetupCheck =
  | { ok: true }
  | { ok: false; code: 'COUNT_NOT_ALLOWED' | 'TOO_FEW_TEAMS' | 'NAME_REQUIRED' | 'NAME_DUPLICATE' | 'NAME_TOO_LONG' | 'UNKNOWN_TEAM' | 'BAD_DIVISION' | 'UNEVEN' | 'BAD_PLAYOFF_RULE' | 'BAD_RIVALS_TWICE'; error: string }

/** Division sizes for `teamCount` teams split as evenly as possible: `[5, 5]`, `[4, 3, 3]`. */
export function evenDivisionSizes(teamCount: number, count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(teamCount / count)
  const extra = teamCount % count
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Whether a standard league of `teamCount` teams may use `count` divisions (every division gets 2+). */
export function divisionCountAllowed(teamCount: number, count: number): boolean {
  if (count === 0) return true
  if (!STANDARD_DIVISION_COUNTS.includes(count)) return false
  return teamCount >= count * 2
}

/**
 * The rules for a standard (non-Survivor) division setup:
 * - 0 (off) or 2–4 divisions, and at least two teams in every division;
 * - every division named, names unique and at most 80 characters;
 * - assignments only to known teams and real divisions;
 * - even or near-even: no division may hold more than `ceil(teams / divisions)`, and once every team
 *   is assigned the largest and smallest division differ by at most one. Unassigned teams are allowed
 *   while a league is still being set up; they simply belong to no division.
 */
export function validateDivisionSetup(input: DivisionSetupInput, teamIds: ReadonlyArray<string>): DivisionSetupCheck {
  const { count } = input
  const teamCount = teamIds.length
  if (!STANDARD_DIVISION_COUNTS.includes(count)) {
    return { ok: false, code: 'COUNT_NOT_ALLOWED', error: 'Pick no divisions, or 2, 3 or 4 divisions.' }
  }
  if (input.playoffRule !== undefined && !(DIVISION_PLAYOFF_RULES as readonly unknown[]).includes(input.playoffRule)) {
    return { ok: false, code: 'BAD_PLAYOFF_RULE', error: 'Unknown division playoff rule.' }
  }
  if (input.rivalsTwice !== undefined && typeof input.rivalsTwice !== 'boolean') {
    return { ok: false, code: 'BAD_RIVALS_TWICE', error: '"Play division rivals twice" must be on or off.' }
  }
  if (count === 0) return { ok: true }
  if (!divisionCountAllowed(teamCount, count)) {
    return {
      ok: false,
      code: 'TOO_FEW_TEAMS',
      error: `${count} divisions need at least ${count * 2} teams (two per division); this league has ${teamCount}.`,
    }
  }
  const seen = new Set<string>()
  for (let i = 0; i < count; i += 1) {
    const name = String(input.names[i] ?? '').trim()
    if (!name) return { ok: false, code: 'NAME_REQUIRED', error: `Division ${i + 1} needs a name.` }
    if (name.length > DIVISION_NAME_MAX) return { ok: false, code: 'NAME_TOO_LONG', error: `Division names can be at most ${DIVISION_NAME_MAX} characters.` }
    const folded = name.toLowerCase()
    if (seen.has(folded)) return { ok: false, code: 'NAME_DUPLICATE', error: `Two divisions are both named "${name}".` }
    seen.add(folded)
  }
  const known = new Set(teamIds)
  const sizes = new Array<number>(count).fill(0)
  for (const [teamId, idx] of Object.entries(input.teamAssignments)) {
    if (!known.has(teamId)) return { ok: false, code: 'UNKNOWN_TEAM', error: 'A team in the assignments is not in this league.' }
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) return { ok: false, code: 'BAD_DIVISION', error: 'A team is assigned to a division that does not exist.' }
    sizes[idx] += 1
  }
  const cap = Math.ceil(teamCount / count)
  const assigned = sizes.reduce((a, b) => a + b, 0)
  const tooBig = sizes.findIndex((n) => n > cap)
  const complete = assigned === teamCount
  if (tooBig >= 0 || (complete && Math.max(...sizes) - Math.min(...sizes) > 1)) {
    return {
      ok: false,
      code: 'UNEVEN',
      error: `Divisions must be even or within one team of each other: ${teamCount} teams in ${count} divisions is ${evenDivisionSizes(teamCount, count).join(' + ')}.`,
    }
  }
  return { ok: true }
}

/* ── Records and standings ──────────────────────────────────────────── */

export type DivisionRecord = { wins: number; losses: number; ties: number }

/**
 * Each roster's record in games against its own division. Pass the same final, regular-season,
 * non-median rows the head-to-head tiebreaker uses; anything else is the caller's to filter.
 */
export function divisionRecords(
  games: ReadonlyArray<{ homeRosterId: string | null; awayRosterId: string | null; homeScore?: number | null; awayScore?: number | null }>,
  divisionOf: (rosterId: string) => string | null,
): Map<string, DivisionRecord> {
  const out = new Map<string, DivisionRecord>()
  const row = (id: string) => {
    let r = out.get(id)
    if (!r) {
      r = { wins: 0, losses: 0, ties: 0 }
      out.set(id, r)
    }
    return r
  }
  for (const g of games) {
    const home = g.homeRosterId
    const away = g.awayRosterId
    if (!home || !away || home === away) continue
    const d = divisionOf(home)
    if (!d || d !== divisionOf(away)) continue
    const hs = Number(g.homeScore ?? 0)
    const as = Number(g.awayScore ?? 0)
    if (hs > as) {
      row(home).wins += 1
      row(away).losses += 1
    } else if (as > hs) {
      row(away).wins += 1
      row(home).losses += 1
    } else {
      row(home).ties += 1
      row(away).ties += 1
    }
  }
  return out
}

export type DivisionStandingsGroup<T> = {
  key: string
  name: string
  rows: Array<T & { divisionRank: number }>
}

/**
 * The overall table split into one table per division. `rows` must already be in overall order — the
 * league's own tiebreakers decided it — so a division's order is that order, and the division leader
 * is the best-placed team in it. Divisions with no team on the board are left out.
 */
export function groupStandingsByDivision<T extends { rosterId: string }>(
  rows: ReadonlyArray<T>,
  divisions: ReadonlyArray<LeagueDivision>,
  divisionOf: (rosterId: string) => string | null,
): DivisionStandingsGroup<T>[] {
  return divisions
    .map((d) => ({
      key: d.key,
      name: d.name,
      rows: rows.filter((r) => divisionOf(r.rosterId) === d.key).map((r, i) => ({ ...r, divisionRank: i + 1 })),
    }))
    .filter((g) => g.rows.length > 0)
}
