/**
 * Copy leagues, part 1 — who is which real team (docs/league-page/COPY_LEAGUES_DESIGN.md; owner decisions
 * 2026-11-18). Pure: no Prisma. The database half is ./copyLeagueService.ts.
 *
 * A commissioner turns a league into a copy league; each manager then takes a real team, first come first
 * served, one manager per team; the commissioner can assign or swap. Picks lock when the draft starts
 * (the commissioner can still assign). Taking a team replaces the team's name and avatar with the real
 * team's; the manager's own name and avatar are kept and come back if the team is let go.
 *
 * NFL, NBA, NHL and MLB. NFL's team table is lib/team-abbrev (32 clubs with full names) with crests from
 * lib/core-app/teamLogo; the other three are ./copyLeagueTeamTables.ts, generated from ESPN team-list
 * captures. Any other sport has no verified table, and `copyLeagueTeams` returns [] for it.
 *
 * Only NFL also gets the real schedule (part 2, ./copyLeagueScheduleService.ts): an NBA, NHL or MLB team
 * plays 3–4 games in a fantasy week, so "its real opponent this week" has no single answer.
 *
 * Stored in `League.settings.copy_league` (AllFantasy-owned, no migration):
 *   { enabled, sport, teams: { [leagueTeamId]: code }, previous: { [leagueTeamId]: { teamName, avatarUrl } } }
 */
import { getAllCanonicalTeams } from '@/lib/team-abbrev'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import { COPY_LEAGUE_MLB_TEAMS, COPY_LEAGUE_NBA_TEAMS, COPY_LEAGUE_NHL_TEAMS } from './copyLeagueTeamTables'

export const COPY_LEAGUE_SETTINGS_KEY = 'copy_league'

export type CopyLeagueTeam = { code: string; name: string; logo: string | null }

export type CopyLeagueState = {
  enabled: boolean
  sport: string
  /** leagueTeamId → real team code. */
  teams: Record<string, string>
  /** leagueTeamId → the team's own name and avatar before it took a real team. */
  previous: Record<string, { teamName: string; avatarUrl: string | null }>
}

const OTHER_SPORTS: Record<string, readonly CopyLeagueTeam[]> = {
  NBA: COPY_LEAGUE_NBA_TEAMS,
  NHL: COPY_LEAGUE_NHL_TEAMS,
  MLB: COPY_LEAGUE_MLB_TEAMS,
}

/** The real teams a copy league in this sport can take, by name. Empty for a sport without a verified table. */
export function copyLeagueTeams(sport: string | null | undefined): CopyLeagueTeam[] {
  const s = String(sport ?? '').toUpperCase()
  const teams =
    s === 'NFL'
      ? getAllCanonicalTeams().map((t) => ({ code: t.abbrev, name: t.fullName, logo: teamLogoUrl('NFL', t.abbrev) }))
      : (OTHER_SPORTS[s] ?? []).map((t) => ({ ...t }))
  return teams.sort((a, b) => a.name.localeCompare(b.name))
}

export function copyLeagueAvailable(sport: string | null | undefined): boolean {
  return copyLeagueTeams(sport).length > 0
}

/** Only an NFL copy league can take the real schedule; NBA, NHL and MLB get name and logo only. */
export function copyLeagueHasRealSchedule(sport: string | null | undefined): boolean {
  return String(sport ?? '').toUpperCase() === 'NFL'
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function readCopyLeague(leagueSettings: unknown, sport: string | null | undefined): CopyLeagueState {
  const raw = obj(obj(leagueSettings)?.[COPY_LEAGUE_SETTINGS_KEY])
  const known = new Set(copyLeagueTeams(sport).map((t) => t.code))
  const teams: Record<string, string> = {}
  for (const [id, code] of Object.entries(obj(raw?.teams) ?? {})) {
    if (typeof code === 'string' && known.has(code)) teams[id] = code
  }
  const previous: CopyLeagueState['previous'] = {}
  for (const [id, p] of Object.entries(obj(raw?.previous) ?? {})) {
    const o = obj(p)
    if (o && typeof o.teamName === 'string') previous[id] = { teamName: o.teamName, avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : null }
  }
  return { enabled: raw?.enabled === true && known.size > 0, sport: String(sport ?? '').toUpperCase(), teams, previous }
}

export function withCopyLeague(leagueSettings: unknown, state: CopyLeagueState): Record<string, unknown> {
  const settings = obj(leagueSettings) ?? {}
  // Other fields under the key (part 2's `realGames`) are kept: this writes only who is which team.
  const existing = obj(settings[COPY_LEAGUE_SETTINGS_KEY]) ?? {}
  return {
    ...settings,
    [COPY_LEAGUE_SETTINGS_KEY]: { ...existing, enabled: state.enabled, sport: state.sport, teams: state.teams, previous: state.previous },
  }
}

type TeamNow = { id: string; teamName: string; avatarUrl: string | null }
/** A write to one LeagueTeam (and its current-season roster): its name and avatar. */
export type IdentityWrite = { leagueTeamId: string; teamName: string; avatarUrl: string | null }

export type CopyLeagueChange =
  | { ok: true; state: CopyLeagueState; writes: IdentityWrite[] }
  | { ok: false; code: 'NOT_ENABLED' | 'UNKNOWN_TEAM' | 'TAKEN' | 'NO_SUCH_LEAGUE_TEAM'; message: string }

/**
 * Give `leagueTeamId` the real team `code`, or let its team go (`code: null`).
 *
 * - A manager (`swap: false`) cannot take a team someone else has.
 * - The commissioner (`swap: true`) can: the other league team gets this one's previous real team, or goes
 *   back to its own name if this one had none.
 */
export function changeCopyTeam(input: {
  state: CopyLeagueState
  teams: readonly TeamNow[]
  leagueTeamId: string
  code: string | null
  swap: boolean
}): CopyLeagueChange {
  const { state } = input
  if (!state.enabled) return { ok: false, code: 'NOT_ENABLED', message: 'This league is not a copy league.' }
  const catalog = new Map(copyLeagueTeams(state.sport).map((t) => [t.code, t]))
  const team = input.teams.find((t) => t.id === input.leagueTeamId)
  if (!team) return { ok: false, code: 'NO_SUCH_LEAGUE_TEAM', message: 'That team is not in this league.' }
  if (input.code !== null && !catalog.has(input.code)) return { ok: false, code: 'UNKNOWN_TEAM', message: 'That is not a real team in this sport.' }

  const next: CopyLeagueState = { ...state, teams: { ...state.teams }, previous: { ...state.previous } }
  const writes: IdentityWrite[] = []
  const mine = state.teams[team.id] ?? null
  if (input.code === mine) return { ok: true, state: next, writes }

  const holder = input.code ? Object.keys(state.teams).find((id) => id !== team.id && state.teams[id] === input.code) : undefined
  if (holder && !input.swap) return { ok: false, code: 'TAKEN', message: 'Another manager already has that team.' }

  /** Set one league team to a real team (saving its own identity first) or back to its own. */
  const set = (t: TeamNow, code: string | null) => {
    if (code) {
      if (!next.teams[t.id]) next.previous[t.id] = { teamName: t.teamName, avatarUrl: t.avatarUrl }
      next.teams[t.id] = code
      const real = catalog.get(code)!
      writes.push({ leagueTeamId: t.id, teamName: real.name, avatarUrl: real.logo })
    } else {
      const own = next.previous[t.id]
      delete next.teams[t.id]
      delete next.previous[t.id]
      if (own) writes.push({ leagueTeamId: t.id, teamName: own.teamName, avatarUrl: own.avatarUrl })
    }
  }

  if (holder) {
    const other = input.teams.find((t) => t.id === holder)
    if (other) set(other, mine)
  }
  set(team, input.code)
  return { ok: true, state: next, writes }
}

/** Turning a copy league off gives every team its own name back. */
export function disableCopyLeague(state: CopyLeagueState): { state: CopyLeagueState; writes: IdentityWrite[] } {
  const writes: IdentityWrite[] = Object.entries(state.previous).map(([id, own]) => ({ leagueTeamId: id, teamName: own.teamName, avatarUrl: own.avatarUrl }))
  return { state: { enabled: false, sport: state.sport, teams: {}, previous: {} }, writes }
}
