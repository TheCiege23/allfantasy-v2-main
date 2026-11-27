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
