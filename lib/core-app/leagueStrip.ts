import type { LeagueSlot } from './playerFinder'
import type { MoveTone } from './playerMoves'

/**
 * The league strip: one chip per league you play, under the player's name — where he is in each,
 * at a glance, before the table below says it in rows.
 *
 * Every league in scope gets exactly one state, and the three that are easy to confuse stay apart:
 *   - FREE     — we read that league's rosters and nobody has him;
 *   - OTHER    — another manager has him;
 *   - UNKNOWN  — we could NOT read that league's rosters (rosterCoverage.unmatched). Never "free":
 *                a league we cannot see is not a league where he is available.
 *
 * A starter who is ruled out carries his readiness tone, so "you start an Out player in KBFL" is
 * red on the strip before anything else on the card is read.
 *
 * Pure, client-safe.
 */

export type StripState = 'start' | 'bench' | 'ir' | 'taxi' | 'other' | 'free' | 'unknown'

export type StripChip = {
  leagueId: string
  leagueName: string
  state: StripState
  /** The short badge: START, BENCH, IR, TAXI, the other team's name, FA, or "?". */
  badge: string
  /** The whole sentence, for the tooltip and screen readers. */
  sentence: string
  tone: MoveTone | 'none'
  bestBall: boolean
  /** What `badge` and `sentence` were built from — finderSearchCopy.ts builds the Spanish from these. */
  last: string
  /** The other manager's team, on an `other` chip that knows it. */
  team: string | null
}

const ORDER: Record<StripState, number> = { start: 0, bench: 1, ir: 2, taxi: 3, free: 4, other: 5, unknown: 6 }

function stateOfSlot(slot: LeagueSlot): StripState {
  if (!slot.isYours) return 'other'
  if (slot.slot === 'STARTER') return 'start'
  if (slot.slot === 'IR SLOT') return 'ir'
  if (slot.slot === 'TAXI') return 'taxi'
  return 'bench'
}

const BADGE: Record<Exclude<StripState, 'other'>, string> = { start: 'START', bench: 'BENCH', ir: 'IR', taxi: 'TAXI', free: 'FA', unknown: '?' }

/**
 * The leagues where he is a FREE AGENT: in scope, read (not in `unmatched`), and on no roster.
 * THE one rule — the strip's FA chip and the free-agent bid list (freeAgentBids.ts) both ask it, so
 * they can never disagree about where he is available.
 */
export function freeLeagueIds(
  leagueIds: readonly string[],
  slots: ReadonlyArray<{ leagueId: string }>,
  unmatched: ReadonlyArray<{ leagueId: string }>,
): string[] {
  const held = new Set(slots.map((s) => s.leagueId))
  const unreadable = new Set(unmatched.map((u) => u.leagueId))
  return leagueIds.filter((id) => !held.has(id) && !unreadable.has(id))
}

export function buildLeagueStrip(args: {
  /** Every league you play, as the finder's scope sees them. */
  leagues: ReadonlyArray<{ id: string; name: string }>
  /** The saved league pick; null = every league. */
  scope: readonly string[] | null
  slots: readonly LeagueSlot[]
  unmatched: ReadonlyArray<{ leagueId: string }>
  playerName: string
  /** His readiness from the injury feed; a ruled-out or at-risk starter carries it. */
  readinessTone: MoveTone | null
}): StripChip[] {
  const inScope = args.scope ? new Set(args.scope) : null
  const slotById = new Map(args.slots.map((s) => [s.leagueId, s]))
  const unreadable = new Set(args.unmatched.map((u) => u.leagueId))
  const free = new Set(freeLeagueIds(args.leagues.map((l) => l.id), args.slots, args.unmatched))
  const last = args.playerName.trim().split(/\s+/).slice(-1)[0] || args.playerName

  const chips: StripChip[] = []
  for (const l of args.leagues) {
    if (inScope && !inScope.has(l.id)) continue
    const slot = slotById.get(l.id)
    if (slot) {
      const state = stateOfSlot(slot)
      const bestBall = slot.bestBall === true
      if (state === 'other') {
        const team = slot.owner?.teamName ?? null
        chips.push({
          leagueId: l.id,
          leagueName: l.name,
          state,
          badge: team ?? 'Taken',
          sentence: `${l.name}: ${team ? `${team} has ${last}` : `another manager has ${last}`}.`,
          tone: 'none',
          bestBall,
          last,
          team,
        })
        continue
      }
      // A starter who cannot play is the one thing on this strip that needs you now.
      const tone: StripChip['tone'] =
        state === 'start' && !bestBall && (args.readinessTone === 'bad' || args.readinessTone === 'warn') ? args.readinessTone : state === 'start' ? 'good' : 'none'
      const where = state === 'start' ? 'starting' : state === 'bench' ? 'on your bench' : state === 'ir' ? 'on your IR' : 'on your taxi squad'
      chips.push({
        leagueId: l.id,
        leagueName: l.name,
        state,
        badge: BADGE[state],
        sentence: `${l.name}: ${last} is ${where}${bestBall ? ' (best ball — the platform sets the lineup)' : ''}.`,
        tone,
        bestBall,
        last,
        team: null,
      })
      continue
    }
    if (unreadable.has(l.id)) {
      chips.push({ leagueId: l.id, leagueName: l.name, state: 'unknown', badge: BADGE.unknown, sentence: `${l.name}: we can't read this league's rosters, so we can't say where ${last} is.`, tone: 'none', bestBall: false, last, team: null })
      continue
    }
    // FA only by the shared rule (freeLeagueIds) — the bid list reads the same answer.
    if (!free.has(l.id)) continue
    chips.push({ leagueId: l.id, leagueName: l.name, state: 'free', badge: BADGE.free, sentence: `${l.name}: nobody has ${last} — he's available.`, tone: 'none', bestBall: false, last, team: null })
  }
  return chips.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.leagueName.localeCompare(b.leagueName))
}
