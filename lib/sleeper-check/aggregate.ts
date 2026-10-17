import { isRuledOut, isAtRisk } from '@/lib/core-app/injuryStatus'
import { normalizePosition } from '@/lib/core-app/positionNormalization'

/**
 * The public Sleeper check, as data: every player a Sleeper user rosters, where he sits in each
 * league, and which of them walk into a lineup hurt.
 *
 * Pure, so it is tested without a network or a database. `sleeperCheck.ts` does the reads.
 *
 * ⚠ BEST BALL NEVER RAISES A LINEUP ALERT. A best-ball league starts its best lineup by itself, so
 * "starting an OUT player" is not something its manager can fix — telling them to is the exact
 * false alarm the Player Finder had to remove (#1373). Best-ball leagues still count toward a
 * player's shares; they just never make him urgent.
 */

export type CheckSlot = 'starter' | 'bench' | 'ir' | 'taxi'
export type CheckSeverity = 'out' | 'risk'

export type CheckLeague = {
  leagueId: string
  name: string
  bestBall: boolean
}

export type CheckPlayerLeague = { leagueId: string; slot: CheckSlot }

export type CheckPlayer = {
  sleeperId: string
  name: string | null
  position: string | null
  team: string | null
  imageUrl: string | null
  injuryStatus: string | null
  severity: CheckSeverity | null
  leagues: CheckPlayerLeague[]
  /** Leagues where he is in the starting lineup, best ball included. */
  starting: number
  /** Leagues where he starts AND the manager sets the lineup — the ones an alert can be about. */
  startingSetLineup: number
}

export type SleeperRosterLike = {
  owner_id?: unknown
  co_owners?: unknown
  players?: unknown
  starters?: unknown
  reserve?: unknown
  taxi?: unknown
}

function ids(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  // Sleeper fills an empty starting slot with "0".
  return list.map((x) => String(x ?? '')).filter((x) => x && x !== '0')
}

/** Every roster in the league this Sleeper user owns or co-owns. */
export function rostersOwnedBy(rosters: readonly SleeperRosterLike[], userId: string): SleeperRosterLike[] {
  return rosters.filter(
    (r) => String(r.owner_id ?? '') === userId || (Array.isArray(r.co_owners) && r.co_owners.map(String).includes(userId)),
  )
}

/** Where each player on one roster sits. A starter is a starter even if also listed elsewhere. */
export function slotsOnRoster(roster: SleeperRosterLike): Map<string, CheckSlot> {
  const out = new Map<string, CheckSlot>()
  for (const id of ids(roster.players)) out.set(id, 'bench')
  for (const id of ids(roster.taxi)) out.set(id, 'taxi')
  for (const id of ids(roster.reserve)) out.set(id, 'ir')
  for (const id of ids(roster.starters)) out.set(id, 'starter')
  return out
}

export function severityOf(status: string | null | undefined): CheckSeverity | null {
  if (!status) return null
  if (isRuledOut(status)) return 'out'
  if (isAtRisk(status)) return 'risk'
  return null
}

export type PlayerIdentity = { name: string | null; position: string | null; team: string | null; imageUrl: string | null }

/** Sleeper keys a team defense by its club code ("BUF"), which no player table holds. */
function defenseIdentity(sleeperId: string): PlayerIdentity | null {
  return /^[A-Z]{2,3}$/.test(sleeperId) ? { name: `${sleeperId} D/ST`, position: 'DEF', team: sleeperId, imageUrl: null } : null
}

export function buildCheckPlayers(args: {
  leagues: readonly CheckLeague[]
  /** leagueId → this user's slot for each player, merged across the rosters he owns there. */
  slotsByLeague: ReadonlyMap<string, ReadonlyMap<string, CheckSlot>>
  identities: ReadonlyMap<string, PlayerIdentity>
  injuries: ReadonlyMap<string, string>
}): CheckPlayer[] {
  const bestBall = new Map(args.leagues.map((l) => [l.leagueId, l.bestBall]))
  const byPlayer = new Map<string, CheckPlayer>()

  for (const league of args.leagues) {
    const slots = args.slotsByLeague.get(league.leagueId)
    if (!slots) continue
    for (const [sleeperId, slot] of slots) {
      let p = byPlayer.get(sleeperId)
      if (!p) {
        const identity = args.identities.get(sleeperId) ?? defenseIdentity(sleeperId)
        const injuryStatus = args.injuries.get(sleeperId) ?? null
        p = {
          sleeperId,
          name: identity?.name ?? null,
          // One spelling per position: vendor rows say "Quarterback" where Sleeper says "QB".
          position: normalizePosition(identity?.position ?? null) || null,
          team: identity?.team ?? null,
          imageUrl: identity?.imageUrl ?? null,
          injuryStatus,
          severity: severityOf(injuryStatus),
          leagues: [],
          starting: 0,
          startingSetLineup: 0,
        }
        byPlayer.set(sleeperId, p)
      }
      p.leagues.push({ leagueId: league.leagueId, slot })
      if (slot === 'starter') {
        p.starting += 1
        if (!bestBall.get(league.leagueId)) p.startingSetLineup += 1
      }
    }
  }

  return [...byPlayer.values()].sort(
    (a, b) =>
      b.leagues.length - a.leagues.length ||
      b.starting - a.starting ||
      (a.name ?? '~').localeCompare(b.name ?? '~'),
  )
}

/**
 * The game-day list: a hurt player in a lineup the manager sets. Ruled out before at risk, then
 * the most lineups affected first.
 */
export function lineupAlerts(players: readonly CheckPlayer[]): CheckPlayer[] {
  const rank = (s: CheckSeverity | null) => (s === 'out' ? 0 : 1)
  return players
    .filter((p) => p.severity != null && p.startingSetLineup > 0)
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.startingSetLineup - a.startingSetLineup)
}
