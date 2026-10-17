import 'server-only'

/**
 * Current injury designations for a set of rostered/pooled players, read from the injury FEED —
 * never from `SportsPlayer.status`.
 *
 * 🛑 `SportsPlayer.status` IS SLEEPER'S *ROSTER* STATUS, NOT AN INJURY DESIGNATION (2026-10-11).
 * `lib/sleeper/refreshSleeperPlayerRows.ts` writes Sleeper's `status` field — "Active", "Inactive",
 * "Injured Reserve", "Practice Squad" — not its `injury_status`. So a player who is Out, Doubtful or
 * Questionable reads "Active" there, and every reader that mapped it to an injury badge (the activity
 * feed, the lineup scans, the waiver pool) never surfaced one. Other providers' rows in the same
 * column carry Rolling Insights' "ACT"/"INACT" or an 'out' that `PlayerStatusAggregator` wrote and
 * nothing ever clears.
 *
 * Rules, all inherited rather than re-derived:
 *  - the designation is `resolveInjuryFacts` — live rows only, the newest CLAIM wins ("Active"
 *    counts, so a cleared player stays cleared), namesakes refused;
 *  - `currentDesignationFromFact` — a stale game-day word is suppressed, a season-scale ruling holds;
 *  - a ROSTER status counts only when the caller vouches it is one (Sleeper's own row), only when it
 *    is a season-scale absence ("Injured Reserve", PUP, NFI, a suspension — never a game-day "Out"),
 *    and only when no fresh fact
 *    contradicts it. A player on IR is not starting, whatever the injury feed has to say.
 *
 * ⚠ `resolveInjuryFacts` KEYS ITS RESULT BY NAME, SO TWO NAMESAKES IN ONE CALL OVERWRITE EACH OTHER.
 * QB Josh Allen and LB Josh Allen each resolve correctly against the feed and then share one map slot.
 * Lookups are therefore split into rounds in which every name is unique — one extra query only when a
 * name genuinely repeats with a different team or position.
 */

import { resolveInjuryFacts, type InjuryFact } from '@/lib/injuries/injuryReadPort'
import { foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { currentDesignationFromFact, isRosterAbsence, isRuledOut } from '@/lib/core-app/injuryStatus'

export interface DesignationLookup<K> {
  /** The caller's own key for this player — results come back under it. */
  key: K
  name: string | null | undefined
  team?: string | null
  position?: string | null
  /**
   * A genuine ROSTER status for this player, when the caller has one (Sleeper's own row). Pass it
   * ONLY from a row the caller knows is Sleeper's — another provider's `status` is not a roster status.
   */
  rosterStatus?: string | null
}

export interface CurrentInjuryDesignation {
  /** The designation as the source spelled it ("Out", "Questionable", "IR", "Injured Reserve"). */
  status: string
  source: 'injury_feed' | 'roster_status'
  /** The feed fact behind it, or the (stale/absent) fact a roster status was used over. */
  fact: InjuryFact | null
}

type Round<K> = Map<string, { identity: string; name: string; team: string | null; position: string | null; members: DesignationLookup<K>[] }>

export async function resolveCurrentInjuryDesignations<K>(args: {
  sport: string
  players: readonly DesignationLookup<K>[]
  now?: Date
}): Promise<Map<K, CurrentInjuryDesignation>> {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  const out = new Map<K, CurrentInjuryDesignation>()
  if (!sport || args.players.length === 0) return out

  const rounds: Round<K>[] = []
  for (const p of args.players) {
    const name = String(p.name ?? '').trim()
    const nameKey = name ? normalizeMatchName(name) : ''
    if (!nameKey) continue
    const team = p.team?.trim() || null
    const position = p.position?.trim().toUpperCase() || null
    const identity = `${foldInjuryTeam(team, sport) ?? ''}|${position ?? ''}`
    let placed = false
    for (const round of rounds) {
      const held = round.get(nameKey)
      if (!held) {
        round.set(nameKey, { identity, name, team, position, members: [p] })
        placed = true
        break
      }
      if (held.identity === identity) {
        held.members.push(p)
        placed = true
        break
      }
    }
    if (!placed) rounds.push(new Map([[nameKey, { identity, name, team, position, members: [p] }]]))
  }

  const factByKey = new Map<K, InjuryFact | null>()
  for (const round of rounds) {
    const res = await resolveInjuryFacts({
      sport,
      players: [...round.values()].map(({ name, team, position }) => ({ name, team, position })),
      now: args.now,
    }).catch(() => null)
    for (const [nameKey, group] of round) {
      const fact = res?.byPlayer.get(nameKey) ?? null
      for (const m of group.members) factByKey.set(m.key, fact)
    }
  }

  for (const p of args.players) {
    const fact = factByKey.get(p.key) ?? null
    const designation = currentDesignationFromFact(fact)
    if (designation) {
      out.set(p.key, { status: designation, source: 'injury_feed', fact })
      continue
    }
    const roster = p.rosterStatus?.trim() || null
    if (roster && (!fact || fact.stale) && isRosterAbsence(roster)) {
      out.set(p.key, { status: roster, source: 'roster_status', fact })
    }
  }
  return out
}

/** Bucket a designation the way lineup and feed surfaces act on it. */
export function designationSeverity(status: string | null | undefined): 'unavailable' | 'doubtful' | 'questionable' | 'other' | null {
  const s = String(status ?? '').trim()
  if (!s) return null
  if (isRuledOut(s)) return 'unavailable'
  const lower = s.toLowerCase()
  if (/\bdoubtful\b/.test(lower) || lower === 'd') return 'doubtful'
  if (/\bquestionable\b/.test(lower) || lower === 'q') return 'questionable'
  return 'other'
}
