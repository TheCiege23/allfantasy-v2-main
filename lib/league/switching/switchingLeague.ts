/**
 * A switching league: an imported league moving onto AllFantasy one team at a time.
 * Design: the "Switching league — design" doc (decided 2026-11-26).
 *
 * TWO SEPARATE FACTS, both in `League.settings.switching` (AF-owned, so a re-import keeps them):
 *
 *   official   The commissioner made the league official on AllFantasy. From then on AllFantasy is the
 *              league of record: settings, scoring and automation run here, as in a native league.
 *              Before that the old platform is official, exactly as for any imported league today.
 *   teams      Teams whose managers switched (`LeagueTeam.id` -> when, by whom). A manager may switch
 *              before the league is official; their AllFantasy moves are then practice only, like any
 *              shadow write, until the commissioner makes it official.
 *
 * WHO IS IN CHARGE, as this module answers it:
 *
 *   league     native platform -> NATIVE; imported and official -> NATIVE; otherwise the platform's own
 *              answer (SHADOW today).
 *   team       league not official -> the league's answer (SHADOW). Official and switched -> NATIVE.
 *              Official and not switched -> MIRRORED: the team is copied in from the old platform and
 *              its manager's moves happen there, so AllFantasy refuses them rather than write moves the
 *              next copy would silently undo.
 *
 * Pure and client-safe: no prisma import.
 */

export const SWITCHING_SETTINGS_KEY = 'switching'

export type SwitchStamp = { at: string; byUserId: string }

export type SwitchingState = {
  official: SwitchStamp | null
  teams: Record<string, SwitchStamp>
}

function readStamp(raw: unknown): SwitchStamp | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r || typeof r.at !== 'string' || typeof r.byUserId !== 'string' || !r.byUserId) return null
  return { at: r.at, byUserId: r.byUserId }
}

/** The league's switching state; null for a league that never started switching. */
export function readSwitchingState(settings: unknown): SwitchingState | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[SWITCHING_SETTINGS_KEY] : null
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r) return null
  const teams: Record<string, SwitchStamp> = {}
  const rawTeams = r.teams && typeof r.teams === 'object' ? (r.teams as Record<string, unknown>) : {}
  for (const [teamId, stamp] of Object.entries(rawTeams)) {
    const s = readStamp(stamp)
    if (teamId && s) teams[teamId] = s
  }
  return { official: readStamp(r.official), teams }
}

/** True once the commissioner has made this imported league official on AllFantasy. */
export function isOfficialOnAllFantasy(settings: unknown): boolean {
  return readSwitchingState(settings)?.official != null
}

/** True when this team's manager has switched to AllFantasy. */
export function hasTeamSwitched(settings: unknown, leagueTeamId: string | null | undefined): boolean {
  if (!leagueTeamId) return false
  return readSwitchingState(settings)?.teams[leagueTeamId] != null
}

/** The settings value to write when the commissioner makes the league official. */
export function withOfficial(settings: unknown, stamp: SwitchStamp): SwitchingState {
  const current = readSwitchingState(settings) ?? { official: null, teams: {} }
  return { ...current, official: current.official ?? stamp }
}

/** The settings value to write when a manager switches their team. Idempotent: the first stamp stands. */
export function withTeamSwitched(settings: unknown, leagueTeamId: string, stamp: SwitchStamp): SwitchingState {
  const current = readSwitchingState(settings) ?? { official: null, teams: {} }
  if (current.teams[leagueTeamId]) return current
  return { ...current, teams: { ...current.teams, [leagueTeamId]: stamp } }
}

/**
 * The teams AllFantasy runs, so a re-sync from the old platform must leave them alone: switched teams in
 * an official league. Empty for every league that is not official, which is every league today, so a
 * re-sync behaves exactly as before until a commissioner makes the league official.
 *
 * Before the league is official a switched team is practice only, and the re-sync still overwrites it:
 * the old platform is the league of record until then.
 *
 * Returns the teams' platform ids (`LeagueTeam.externalId`, the import's `source_team_id`), because that
 * is the id every re-sync writer has in hand.
 */
export function teamsRunOnAllFantasy(
  settings: unknown,
  teams: ReadonlyArray<{ id: string; externalId: string | null }>,
): Set<string> {
  const state = readSwitchingState(settings)
  const out = new Set<string>()
  if (!state?.official) return out
  for (const t of teams) {
    if (t.externalId && state.teams[t.id]) out.add(t.externalId)
  }
  return out
}

/** Refusal code when a trade names a team that has not switched. */
export const TRADE_TEAM_NOT_SWITCHED_CODE = 'TRADE_TEAM_NOT_SWITCHED'

/**
 * The refusal shown when a trade in an official league names a team that still plays on the old platform.
 * Both sides of a trade must be run here, or the move happens on AllFantasy only and the old platform's
 * next copy puts the players back.
 */
export function tradeTeamNotSwitchedMessage(teamNames: readonly string[], platformLabel: string | null): string {
  const where = platformLabel ?? 'the other platform'
  const who = teamNames.length === 1 ? `${teamNames[0]} hasn't` : `${teamNames.slice(0, -1).join(', ')} and ${teamNames[teamNames.length - 1]} haven't`
  return `${who} switched to AllFantasy yet, so this trade has to happen on ${where}. Trades here need every team to have switched.`
}
