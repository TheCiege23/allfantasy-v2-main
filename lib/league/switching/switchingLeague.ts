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

import { isNativePlatform } from '@/lib/dashboard/platform-label'

export const SWITCHING_SETTINGS_KEY = 'switching'

export type SwitchStamp = { at: string; byUserId: string }

/** A team that had not switched when the switching period ended (step 5), so its commissioner can follow up. */
export type LeftBehindTeam = { teamId: string; name: string; manager: string | null }

export type SwitchingState = {
  official: SwitchStamp | null
  teams: Record<string, SwitchStamp>
  /**
   * The switching period is over (step 5): everyone switched, or the commissioner said "Everyone's here". From then
   * on every team counts as switched, so the old platform's copy leaves them all alone. Only ever set once official.
   */
  ended?: SwitchStamp | null
  /** The teams that had not switched when it ended. Empty when everyone switched. */
  leftBehind?: LeftBehindTeam[]
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
  const leftBehind = Array.isArray(r.leftBehind)
    ? r.leftBehind.flatMap((raw) => {
        const t = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
        return typeof t.teamId === 'string' && t.teamId
          ? [{ teamId: t.teamId, name: typeof t.name === 'string' ? t.name : 'A team', manager: typeof t.manager === 'string' ? t.manager : null }]
          : []
      })
    : []
  const official = readStamp(r.official)
  // An end without an official stamp is not a state any writer produces; read it as not ended.
  return { official, teams, ended: official ? readStamp(r.ended) : null, leftBehind }
}

/** True once a switching league's switching period has ended: every team is run on AllFantasy. */
export function isSwitchingEnded(settings: unknown): boolean {
  return readSwitchingState(settings)?.ended != null
}

/** True once the commissioner has made this imported league official on AllFantasy. */
export function isOfficialOnAllFantasy(settings: unknown): boolean {
  return readSwitchingState(settings)?.official != null
}

/**
 * True when this team is run on AllFantasy as a switched team: its manager switched, or the switching period has
 * ended, after which every team counts as switched.
 */
export function hasTeamSwitched(settings: unknown, leagueTeamId: string | null | undefined): boolean {
  if (!leagueTeamId) return false
  const state = readSwitchingState(settings)
  return state?.ended != null || state?.teams[leagueTeamId] != null
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

/** The value to write when the switching period ends. Idempotent: the first end stands. */
export function withEnded(settings: unknown, stamp: SwitchStamp, leftBehind: LeftBehindTeam[]): SwitchingState {
  const current = readSwitchingState(settings) ?? { official: null, teams: {} }
  if (current.ended) return current
  return { ...current, ended: stamp, leftBehind }
}

/** True when every one of these teams has switched (the moment the switching period ends by itself). */
export function everyTeamSwitched(settings: unknown, teamIds: readonly string[]): boolean {
  const state = readSwitchingState(settings)
  return teamIds.length > 0 && teamIds.every((id) => state?.teams[id] != null)
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
    // Once the switching period has ended, every team counts as switched.
    if (t.externalId && (state.ended || state.teams[t.id])) out.add(t.externalId)
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

/** Refusal code when a lineup change names a team that has not switched, in an official league. */
export const TEAM_NOT_SWITCHED_CODE = 'TEAM_NOT_SWITCHED'

/**
 * The refusal shown when a lineup change in an official league names a team that still plays on the old
 * platform. That team's lineup is copied from there, so a change made here would be replaced by the next
 * copy, and AllFantasy's score would briefly count a lineup its manager never set.
 */
export function lineupTeamNotSwitchedMessage(teamName: string, platformLabel: string | null): string {
  const where = platformLabel ?? 'the other platform'
  return `${teamName} hasn't switched to AllFantasy yet, so its lineup is set on ${where}. AllFantasy copies it from there.`
}

/**
 * True when AllFantasy runs this league's season: scoring, standings and waivers (rule 3: AllFantasy
 * scoring is official once the league is). A native league, or an imported one made official here.
 * This is the gate AllFantasy's own engines use in place of a bare platform check.
 */
export function runsOnAllFantasy(league: { platform?: string | null; settings?: unknown } | null | undefined): boolean {
  if (!league) return false
  return isNativePlatform(league.platform) || isOfficialOnAllFantasy(league.settings)
}

/**
 * The pending waiver claims AllFantasy may settle. In an official league, only claims from teams that
 * switched: a claim from a team still on the old platform stays pending, since the next copy of that team's
 * roster would undo it. Every claim in a league that is not official.
 */
export function claimsRunOnAllFantasy<C extends { roster?: { playerData?: unknown } | null }>(
  settings: unknown,
  teams: ReadonlyArray<{ id: string; externalId: string | null }>,
  claims: readonly C[],
): C[] {
  if (!isOfficialOnAllFantasy(settings)) return [...claims]
  const switched = teamsRunOnAllFantasy(settings, teams)
  return claims.filter((c) => {
    const pd = c.roster?.playerData && typeof c.roster.playerData === 'object' ? (c.roster.playerData as Record<string, unknown>) : {}
    return switched.has(String(pd.source_team_id ?? ''))
  })
}
