import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { bridgeColumnFor, bridgeVerdict, declaredBridgeMap, isDeclaredBridge } from './bridgedRosterIds'
import { collectRosterIds } from './rosterIdSpace'

/**
 * Can a pasted Yahoo league say who is AVAILABLE — and if so, who must still be kept off the list?
 *
 * 🛑 "NOT ON ANY ROSTER" IS NOT "AVAILABLE" HERE. A pasted league stores each player it resolved
 * DECLARED (`sleeper:<id>`, declaredSleeperId.ts) and every player it could not as `yahoo-paste:<name>|
 * <pos>|<team>`. `sleeperReadableRosters` keeps the declared ids and drops the rest, so a reader that
 * subtracts rosters from a pool would offer every unmatched player as a free agent: he is on somebody's
 * team, under an id no Sleeper-id read can see.
 *
 * So, for such a league:
 *
 *   - BELOW THE COVERAGE BAR (`BRIDGE_MIN_COVERAGE`, bridgedRosterIds.ts — the one rule, read through
 *     `bridgeVerdict`, not restated here) nobody may be called available. The reader returns its
 *     "can't verify" state with `unmatched`.
 *   - ABOVE IT the list stands, minus every wire player `hides` matches, and the screen says how many
 *     rostered players could not be matched.
 *
 * ⚠ `hides` IS BY NAME, AND A NAME HERE ONLY EVER HIDES (the rule `excludeUntranslatedEspn` in
 * lib/decision-os/waiver/pool.ts already applies to ESPN). A pasted id carries the name the page showed,
 * normalised by the same `normalizePlayerName` that built it, so the unmatched player's own wire row is
 * hidden; a namesake who really is free is hidden too, which is the safe direction for a list of who is
 * available. A pasted defence hides its club's defence. A bare Yahoo number carries no name and hides
 * nothing — it is still counted in `unmatched`.
 *
 * Null for every league that is not a declared-bridge league, AND for one with no declared id at all (a
 * Yahoo league imported any other way): those keep the refusal they already had.
 */

export type DeclaredAvailability = {
  /** True when the league clears the coverage bar: a miss can be trusted. */
  verified: boolean
  /** Distinct roster ids across the league. */
  total: number
  /** How many of them are declared Sleeper ids. */
  matched: number
  /** Rostered players no Sleeper-id read can see. */
  unmatched: number
  /** True for a wire player who could be one of the unmatched rostered players. Only ever hides. */
  hides: (row: { name?: string | null; position?: string | null; team?: string | null }) => boolean
}

const PASTE_PREFIX = 'yahoo-paste:'
const DEFENSE_POSITIONS = new Set(['DEF', 'DST', 'D/ST'])

/** Pure: the verdict for one league, from its rosters' raw `playerData`. */
export function declaredAvailability(
  platform: string | null | undefined,
  playerDatas: readonly unknown[],
): DeclaredAvailability | null {
  if (!isDeclaredBridge(bridgeColumnFor(platform))) return null
  const ids = collectRosterIds(playerDatas)
  const map = declaredBridgeMap(ids)
  if (map.size === 0) return null
  const { total, translated, readable } = bridgeVerdict(ids, map)

  const names = new Set<string>()
  const defenseClubs = new Set<string>()
  for (const id of ids) {
    if (map.has(id) || !id.startsWith(PASTE_PREFIX)) continue
    const [name = '', position = '', team = ''] = id.slice(PASTE_PREFIX.length).split('|')
    if (DEFENSE_POSITIONS.has(position.trim().toUpperCase())) {
      const club = normalizeTeamAbbrev(team)
      if (club) defenseClubs.add(club)
      continue
    }
    const key = normalizePlayerName(name)
    if (key) names.add(key)
  }

  return {
    verified: readable,
    total,
    matched: translated,
    unmatched: total - translated,
    hides: (row) => {
      if (DEFENSE_POSITIONS.has(String(row.position ?? '').trim().toUpperCase())) {
        return defenseClubs.has(normalizeTeamAbbrev(row.team ?? '') ?? '')
      }
      const key = normalizePlayerName(row.name ?? '')
      return Boolean(key) && names.has(key)
    },
  }
}

/** `declaredAvailability` for one league, reading its rosters. No read for a league on another platform. */
export async function loadDeclaredAvailability(
  league: { id: string; platform: string | null | undefined },
  db: Pick<typeof prisma, 'roster'> = prisma,
): Promise<DeclaredAvailability | null> {
  if (!isDeclaredBridge(bridgeColumnFor(league.platform))) return null
  const rosters = await db.roster
    .findMany({ where: { leagueId: league.id }, select: { playerData: true } })
    .catch(() => [] as Array<{ playerData: unknown }>)
  return declaredAvailability(league.platform, rosters.map((r) => r.playerData))
}
