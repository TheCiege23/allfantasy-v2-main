/**
 * Pasted Yahoo players → our own player ids, decided at import time. Pure: the registry read lives in
 * `yahooSnapshotPlayerIdResolver.ts`.
 *
 * 🛑 WHY. A pasted league has no Yahoo ids — the page text names a player, his position and his NFL
 * club, nothing else — so `buildYahooSnapshotPayload` keys each one `yahoo-paste:<name>|<pos>|<team>`.
 * Nothing in the app reads that: My Team, the matchup board, values, projections and Chimmy all join
 * on Sleeper ids, and a Yahoo league is a foreign id space they strip. Measured on production
 * 2026-11-25: one pasted league, 10 rosters, 15–16 players each, every one a `yahoo-paste:` string.
 *
 * THE RULE IS THE FANTRAX NFL LINKER'S, NOT A NEW ONE (`lib/player-identity/nflFantraxIdentityPlan.ts`):
 * the same name (punctuation aside, `looseNflNameKey`), a recognised CURRENT NFL club that matches the
 * registry row's, and a compatible position group. Same normalizer as the paste id itself
 * (`normalizePlayerName` from `@/lib/team-abbrev`) — no second one.
 *
 *  - A defence is a club, not a person: `teamDefenseSleeperId('yahoo', …)` gives Sleeper's id for it,
 *    the team code (`PHI`).
 *  - Fitting rows that carry DIFFERENT Sleeper ids are two people: refused, counted `ambiguous`.
 *    Several rows carrying the SAME Sleeper id are one person filed twice, and resolve.
 *  - Two pasted players landing on one Sleeper id means one of them is wrong: both refused.
 *  - Anything else stays `yahoo-paste:` and is counted — never guessed. An unresolved player keeps his
 *    name, position and club in `player_metadata`, exactly as before.
 *
 * Resolved ids are stored DECLARED (`sleeper:<id>`, see `lib/core-app/declaredSleeperId.ts`) so the
 * readers can honour them in a league whose platform is Yahoo.
 */
import { normalizePlayerName } from '@/lib/team-abbrev'
import { toDeclaredSleeperId } from '@/lib/core-app/declaredSleeperId'
import { teamDefenseSleeperId } from '@/lib/core-app/teamDefenseCrosswalk'
import {
  compatibleRoles,
  looseNflNameKey,
  nflPositionGroups,
  nflTeamCode,
} from '@/lib/player-identity/nflFantraxIdentityPlan'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'

const PASTE_ID_PREFIX = 'yahoo-paste:'
const DEFENSE_POSITIONS = new Set(['DEF', 'DST', 'D/ST'])

export type YahooPastePlayerRef = { id: string; name: string; position: string; team: string }

/** A `PlayerIdentityMap` row as the planner needs it. */
export type YahooPasteIdentityRow = {
  canonicalName: string
  currentTeam: string | null
  position: string | null
  sleeperId: string | null
}

export type YahooSnapshotPlayerIdCoverage = {
  /** Distinct pasted players looked at. */
  provided: number
  /** Linked to a player (not a defence). */
  resolved: number
  /** Team defences mapped to their club code. */
  defenses: number
  /** No fitting registry row, or no club/position to check one against. */
  unmatched: number
  /** Fitting rows disagree, or two pasted players claimed one id. */
  ambiguous: number
}

export function isYahooPastePlayerId(id: string): boolean {
  return id.startsWith(PASTE_ID_PREFIX)
}

/** Every distinct pasted player in a payload: rosters first (they carry the playerMap), then draft picks. */
export function collectYahooPastePlayerRefs(payload: YahooImportPayload): YahooPastePlayerRef[] {
  const byId = new Map<string, YahooPastePlayerRef>()
  for (const team of payload.teams) {
    for (const [id, p] of Object.entries(team.playerMap ?? {})) {
      if (isYahooPastePlayerId(id) && !byId.has(id)) byId.set(id, { id, name: p.name, position: p.position, team: p.team })
    }
  }
  for (const pick of payload.draftPicks ?? []) {
    const id = String(pick.playerId ?? '')
    if (!isYahooPastePlayerId(id) || byId.has(id)) continue
    byId.set(id, {
      id,
      name: String(pick.playerName ?? ''),
      position: String(pick.position ?? '').toUpperCase(),
      team: String(pick.team ?? '').toUpperCase(),
    })
  }
  return [...byId.values()]
}

/** The registry name keys to read for these players: exact (as `normalizedName` stores them) and loose. */
export function yahooPasteNameKeys(refs: readonly YahooPastePlayerRef[]): { exact: string[]; loose: string[] } {
  const exact = new Set<string>()
  const loose = new Set<string>()
  for (const ref of refs) {
    if (DEFENSE_POSITIONS.has(ref.position.trim().toUpperCase())) continue
    const key = normalizePlayerName(ref.name)
    if (!key) continue
    exact.add(key)
    const l = looseNflNameKey(key)
    if (l) loose.add(l)
  }
  return { exact: [...exact], loose: [...loose] }
}

export function planYahooSnapshotPlayerIds(
  refs: readonly YahooPastePlayerRef[],
  rows: readonly YahooPasteIdentityRow[],
): { ids: Map<string, string>; coverage: YahooSnapshotPlayerIdCoverage } {
  const byName = new Map<string, YahooPasteIdentityRow[]>()
  for (const row of rows) {
    const key = looseNflNameKey(normalizePlayerName(row.canonicalName ?? ''))
    if (key) byName.set(key, [...(byName.get(key) ?? []), row])
  }

  const coverage: YahooSnapshotPlayerIdCoverage = { provided: refs.length, resolved: 0, defenses: 0, unmatched: 0, ambiguous: 0 }
  const proposed = new Map<string, string>()
  const defenseIds = new Set<string>()
  for (const ref of refs) {
    const position = ref.position.trim().toUpperCase()
    if (DEFENSE_POSITIONS.has(position)) {
      const code = teamDefenseSleeperId('yahoo', { playerId: ref.id, position, team: ref.team, playerName: ref.name })
      if (code) {
        proposed.set(ref.id, code)
        defenseIds.add(ref.id)
      } else coverage.unmatched++
      continue
    }
    const team = nflTeamCode(ref.team)
    const roles = nflPositionGroups(ref.position)
    if (!team || roles.size === 0) {
      coverage.unmatched++
      continue
    }
    const fitting = (byName.get(looseNflNameKey(normalizePlayerName(ref.name))) ?? []).filter(
      (row) => nflTeamCode(row.currentTeam) === team && compatibleRoles(nflPositionGroups(row.position), roles),
    )
    const sleeperIds = new Set(fitting.map((row) => row.sleeperId?.trim()).filter((id): id is string => Boolean(id)))
    if (sleeperIds.size === 0) coverage.unmatched++
    else if (sleeperIds.size > 1) coverage.ambiguous++
    else proposed.set(ref.id, [...sleeperIds][0]!)
  }

  /* Two pasted players proposing one id means one of them is wrong; neither is linked. */
  const claims = new Map<string, number>()
  for (const sid of proposed.values()) claims.set(sid, (claims.get(sid) ?? 0) + 1)
  const ids = new Map<string, string>()
  for (const [pasteId, sid] of proposed) {
    if (claims.get(sid) !== 1) {
      coverage.ambiguous++
      continue
    }
    ids.set(pasteId, toDeclaredSleeperId(sid))
    if (defenseIds.has(pasteId)) coverage.defenses++
    else coverage.resolved++
  }
  return { ids, coverage }
}

/** The payload with every resolved pasted id replaced; anything unresolved is left exactly as it was. */
export function applyYahooSnapshotPlayerIds(
  payload: YahooImportPayload,
  ids: ReadonlyMap<string, string>,
): YahooImportPayload {
  if (ids.size === 0) return payload
  const swap = (id: string) => ids.get(id) ?? id
  return {
    ...payload,
    teams: payload.teams.map((team) => ({
      ...team,
      rosterPlayerIds: team.rosterPlayerIds.map(swap),
      starterPlayerIds: team.starterPlayerIds.map(swap),
      reservePlayerIds: team.reservePlayerIds.map(swap),
      minorsPlayerIds: (team.minorsPlayerIds ?? []).map(swap),
      playerMap: Object.fromEntries(Object.entries(team.playerMap ?? {}).map(([id, p]) => [swap(id), p])),
    })),
    draftPicks: (payload.draftPicks ?? []).map((pick) => ({ ...pick, playerId: swap(String(pick.playerId ?? '')) })),
  }
}
