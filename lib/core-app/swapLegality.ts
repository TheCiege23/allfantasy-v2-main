import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { lockState } from './lineupLock'

/**
 * Whether a lineup move can still be made — read from kickoffs, not assumed.
 *
 * A player whose game has kicked off is locked in place on every launch
 * platform: he can be neither benched nor brought in. So a swap is legal only
 * while BOTH sides are unlocked, and a bench candidate whose own game has
 * started is not a candidate at all right now. Sending someone to the platform
 * for a move the app will refuse is worse than saying "locked" here.
 *
 * ⚠ AN UNKNOWN KICKOFF IS NOT A LOCK. A club missing from the week's map (a
 * bye, a schedule gap, a team we could not fold) reads as movable — we cannot
 * claim a lock we did not read. The reason string names the game that closed
 * the door, so the reader can check it against the platform.
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: composed in the screen from the kickoffs the
 * detail loader already carries. No prisma, no 'server-only'.
 */

/** Club abbreviation → ISO kickoff, for the resolved week. */
export type Kickoffs = Record<string, string>

export type LockRead = {
  locked: boolean
  /** The kickoff the read was made against; null when the club is not in the map. */
  kickoff: string | null
  /** "kicked off Sun 1:00p ET" when locked; the countdown label otherwise; null when unknown. */
  label: string | null
}

function last(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name
}

export function playerLock(team: string | null | undefined, kickoffs: Kickoffs, nowIso: string): LockRead {
  const club = normalizeTeamAbbrev(team)
  const kickoff = club ? (kickoffs[club] ?? null) : null
  if (!kickoff) return { locked: false, kickoff: null, label: null }
  const s = lockState(kickoff, nowIso)
  return { locked: s.state === 'locked', kickoff, label: s.state === 'locked' ? `kicked off ${s.clock}` : s.label }
}

export type SwapLegality = {
  legal: boolean
  /** "locked — Ferguson's game kicked off Sun 1:00p ET"; null when legal. */
  reason: string | null
}

/** A lineup swap: `out` leaves the starting lineup, `in` takes the slot. Both must be unlocked. */
export function swapLegality(args: {
  out: { name: string; team: string | null | undefined }
  in: { name: string; team: string | null | undefined }
  kickoffs: Kickoffs
  nowIso: string
}): SwapLegality {
  const o = playerLock(args.out.team, args.kickoffs, args.nowIso)
  const i = playerLock(args.in.team, args.kickoffs, args.nowIso)
  if (o.locked && i.locked) return { legal: false, reason: 'locked — both games have kicked off' }
  if (o.locked) return { legal: false, reason: `locked — ${last(args.out.name)}’s game ${o.label}` }
  if (i.locked) return { legal: false, reason: `locked — ${last(args.in.name)}’s game ${i.label}` }
  return { legal: true, reason: null }
}

/** A single-player roster move (off IR, into the lineup from the bench): his own game must not have started. */
export function moveLegality(args: { name: string; team: string | null | undefined; kickoffs: Kickoffs; nowIso: string }): SwapLegality {
  const l = playerLock(args.team, args.kickoffs, args.nowIso)
  if (l.locked) return { legal: false, reason: `locked — ${last(args.name)}’s game ${l.label}` }
  return { legal: true, reason: null }
}
