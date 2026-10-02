import { bestLineup, type Scored } from '@/lib/waivers/bestLineup'
import { canFillSlot } from './slotEligibility'

/**
 * The cross-league Waivers board's one decision per league: which free agent to add, what he does
 * to your starting lineup, and who goes to make room. Pure — the NFL rows (`waiversBoard.ts`) and
 * every other sport's section (`waiversBoardSports.ts`) call it with their own pricing.
 *
 * 🛑 RANKED BY LINEUP GAIN, NOT BY "BEST FREE AGENT MINUS WEAKEST BENCH PLAYER". That older rule
 * never asked whether the add would START. In a one-quarterback league the highest projection on
 * the wire is nearly always a streaming QB, so the board named a backup quarterback as the best
 * add in league after league — "+12.3" — while the league's own Waivers screen, which solves the
 * lineup, said nobody on that wire improved it. Two screens, one league, opposite answers. This is
 * now the league screen's rule (`lib/waivers/waiverBoard.ts`): solve your best lineup, solve it
 * again with the candidate, and the difference is the gain. A candidate who would sit is no gain.
 *
 * ⚠ THE DROP IS A SEPARATE QUESTION FROM THE ADD, AND IN DYNASTY IT IS A VALUE QUESTION. Cutting
 * the bench player with the lowest projection THIS WEEK is right in redraft and can be a disaster
 * in dynasty, where the lowest weekly number on a bench is very often a rookie stash. So where the
 * league prices on the dynasty chart, the drop is the bench player with the lowest MARKET value.
 * A bench player we cannot price — no projection in redraft, no market value in dynasty — is never
 * named: missing data is not a low number.
 */

export type SwapCandidate = {
  id: string
  position: string | null
  points: number
}

export type SwapRosterPlayer = {
  id: string
  position: string | null
  /** This period's points under the league's scoring; null when the feed cannot price him. */
  points: number | null
  /** Market value on the league's own chart; null when unpriced or not looked up. */
  marketValue?: number | null
}

export type LineupSwap = {
  addId: string
  /** What the add does to your best starting lineup. Always > 0 — a non-starter is not a swap. */
  gain: number
  /** The starter he would take the place of, when he takes one rather than filling a hole. */
  displacesId: string | null
  dropId: string | null
  /** Which rule chose the drop, so the row can say why. */
  dropBasis: 'market_value' | 'projection' | null
  /** The roster has an empty spot, so the add needs no drop at all. */
  openRosterSpot: boolean
}

export type PickLineupSwapArgs = {
  /** Every player on your roster who can be seated or cut this week — never IR or taxi. */
  roster: readonly SwapRosterPlayer[]
  /** The league's declared starters — never offered as the drop. */
  starterIds: ReadonlySet<string>
  /** Free agents, already filtered to the provably available, startable and healthy. */
  candidates: readonly SwapCandidate[]
  slots: readonly string[]
  fits?: (slot: string, position: string | null) => boolean
  /** The league prices on the dynasty chart (`pricesOnDynastyChart`). */
  dynasty: boolean
  /**
   * Players you hold outside IR and taxi, and the spots the league gives them (`rosterCapacity`).
   * Passed explicitly rather than read off `roster`, which a caller may have narrowed to the
   * players it can identify. Fewer held than spots means nobody has to go.
   */
  held?: number
  capacity?: number | null
}

/**
 * How many players a roster carries outside IR and taxi: every `roster_positions` entry that is not
 * IR or TAXI (Sleeper keeps those as separate settings, so they are rarely listed at all).
 *
 * ⚠ NULL FOR ANY `NAME:count` ENTRY. ESPN, Yahoo, MFL and Fantrax write `"BN:7"` (see valueBook's
 * superflex note); reading that as one slot would invent open spots on every such roster. Unknown
 * capacity means the drop is chosen as if the roster were full, which is today's behaviour.
 */
export function rosterCapacity(settings: unknown): number | null {
  const s = (settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}) as Record<string, unknown>
  const raw = s.roster_positions ?? s.rosterPositions
  if (!Array.isArray(raw) || raw.length === 0) return null
  let n = 0
  for (const x of raw) {
    const slot = String(x ?? '').trim().toUpperCase()
    if (!slot || slot.includes(':')) return null
    if (slot === 'IR' || slot === 'TAXI') continue
    n++
  }
  return n > 0 ? n : null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function pickLineupSwap(args: PickLineupSwapArgs): LineupSwap | null {
  const fits = args.fits ?? canFillSlot
  const lineup: Scored[] = args.roster
    .filter((p) => p.points != null && Number.isFinite(p.points))
    .map((p) => ({ sleeperId: p.id, name: p.id, position: p.position, team: null, points: p.points as number }))
  const base = bestLineup(lineup, args.slots, fits)

  let best: { cand: SwapCandidate; gain: number; used: Set<string> } | null = null
  for (const cand of args.candidates) {
    const withCand = bestLineup(
      [...lineup, { sleeperId: cand.id, name: cand.id, position: cand.position, team: null, points: cand.points }],
      args.slots,
      fits,
    )
    if (!withCand.used.has(cand.id)) continue
    const gain = round2(withCand.total - base.total)
    if (gain <= 0) continue
    /* Ties go to the higher projection, then the lower id, so a cached board cannot flip between loads. */
    if (
      !best ||
      gain > best.gain ||
      (gain === best.gain && (cand.points > best.cand.points || (cand.points === best.cand.points && cand.id < best.cand.id)))
    ) {
      best = { cand, gain, used: withCand.used }
    }
  }
  if (!best) return null

  const openRosterSpot = args.held != null && args.capacity != null && args.held < args.capacity

  const displacesId = lineup.find((p) => base.used.has(p.sleeperId) && !best!.used.has(p.sleeperId))?.sleeperId ?? null

  /*
   * Drop candidates: your bench — not a declared starter, and not anyone the new best lineup
   * would start (a bench player good enough to move up is not dead weight).
   */
  const bench = args.roster.filter((p) => !args.starterIds.has(p.id) && !best!.used.has(p.id))
  let dropId: string | null = null
  let dropBasis: LineupSwap['dropBasis'] = null
  if (openRosterSpot) {
    /* Nobody has to go: naming a drop anyway would cut a player for no reason. */
  } else if (args.dynasty) {
    let low = Infinity
    for (const p of bench) {
      const v = p.marketValue
      /* The row prints the drop's projection beside his name, so an unprojected player is not named either. */
      if (v == null || !Number.isFinite(v) || p.points == null || !Number.isFinite(p.points)) continue
      if (v < low || (v === low && dropId != null && p.id < dropId)) {
        low = v
        dropId = p.id
      }
    }
    if (dropId) dropBasis = 'market_value'
  } else {
    let low = Infinity
    for (const p of bench) {
      if (p.points == null || !Number.isFinite(p.points)) continue
      if (p.points < low || (p.points === low && dropId != null && p.id < dropId)) {
        low = p.points
        dropId = p.id
      }
    }
    if (dropId) dropBasis = 'projection'
  }

  return { addId: best.cand.id, gain: best.gain, displacesId, dropId, dropBasis, openRosterSpot }
}

type NamedPoints = { name: string; position?: string | null; projected: number }

/**
 * The row's "Why" line — assembled from the numbers on the row, never generated, so it cannot say
 * anything the row does not show. Shared by the NFL rows and the per-game sport sections.
 */
export function swapReasoning(args: {
  /** "Bijan Robinson (RB) projects 18.4 under this league's own scoring" — the pricing lead-in. */
  addLead: string
  over: NamedPoints | null
  drop: NamedPoints | null
  dropBasis: LineupSwap['dropBasis']
  openRosterSpot?: boolean
  gain: number
  /** '' for a week's points, ' per game' for a season rate. */
  unit: string
}): string {
  const gain = `+${args.gain.toFixed(1)}`
  const start = args.over
    ? `${args.addLead}, and would start over ${args.over.name} (${args.over.projected.toFixed(1)}) — ${gain} to your starting lineup${args.unit}.`
    : `${args.addLead}, and would fill an empty starting slot — ${gain} to your starting lineup${args.unit}.`
  const drop = args.openRosterSpot
    ? ' You have an open roster spot, so nothing needs to go.'
    : !args.drop
    ? ' No bench player here could be priced, so no drop is named.'
    : args.over && args.over.name === args.drop.name
      ? /* A bench player who was filling a hole in your best lineup, and is now the one to cut. */
        args.dropBasis === 'market_value'
        ? ` ${args.drop.name} is also the bench player with the lowest dynasty market value, so is the drop.`
        : ` ${args.drop.name} is also your lowest-projected bench player, so is the drop.`
    : args.dropBasis === 'market_value'
      ? ` Drop ${args.drop.name}, the bench player with the lowest dynasty market value — a weekly projection would cut a stash.`
      : ` Drop ${args.drop.name} (${args.drop.projected.toFixed(1)}), your lowest-projected bench player.`
  return `${start}${drop}`
}
