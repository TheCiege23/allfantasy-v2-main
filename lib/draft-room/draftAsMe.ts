/**
 * DRAFT AS ME — when a manager misses a pick, the autopick drafts the way THEY draft instead of
 * taking the plain best available player (AF Commissioner, owner decision 2026-10-26,
 * docs/AF_COMMISSIONER_SETTINGS_SPEC.md §5).
 *
 * A manager's style comes from their own completed drafts (managerHistoryReads.ts supplies the same
 * picks it uses for the reach/value read):
 *   - how far from ADP they take players (`reachDelta`, overall − ADP: negative = reaches early)
 *   - which positions they spend picks on (`positionShare`)
 *   - how young they draft (`youthLean`, phase 8, 2026-10-29): the mean age of everyone picked in the
 *     same drafts minus the age of the players THEY picked. Positive = they take younger players than
 *     the room. This is the "youth" half of Manager DNA the plan promised; it is measured from the
 *     manager's own drafts rather than from in-season behaviour, because drafting is what it steers.
 *     A player with no age on file is simply not counted, and too few aged picks means no lean.
 *
 * The pick is made from the top of the board only — the `WINDOW` best available by ADP — so a style
 * can tilt a pick but never produce one no human would make. A position the manager already holds
 * more of than their habit says is passed over. Not enough history means no style: the caller falls
 * back to its ordinary autopick rather than guessing.
 *
 * Pure. No Prisma, no fetch.
 */

export type StylePick = {
  overall: number
  adpAtPick: number | null
  position: string
  /** The player's age, when on file. */
  age?: number | null
  /** Mean age of every player picked in that same draft, when enough ages are on file. */
  draftMeanAge?: number | null
}

export type DraftStyle = {
  /** Mean of overall − ADP across past picks inside the ADP horizon. Negative: takes players early. */
  reachDelta: number
  /** Share of past picks at each position (upper-case), summing to 1. */
  positionShare: Record<string, number>
  /** Past picks behind the read. */
  sample: number
  /** Years younger than the room this manager drafts (negative: older), or null with too few ages on file. */
  youthLean: number | null
}

export type BoardPlayer = {
  playerName: string
  position: string
  adp: number | null
  age?: number | null
}

/** Past picks needed before a style is trusted. */
export const MIN_STYLE_SAMPLE = 10
/** Picks deep in a draft drift from ADP for reasons that are not style (the board runs thin). */
export const STYLE_ADP_HORIZON = 150
/** Only the top of the board is considered. */
export const WINDOW = 15
/** A reach is capped at this many picks, so one wild past draft cannot send a pick off the board. */
export const MAX_REACH = 18
/** A youth lean is capped at this many years, for the same reason. */
export const MAX_YOUTH_LEAN = 3
/** A lean smaller than this is noise, not a habit, and tilts nothing. */
export const MIN_YOUTH_LEAN = 0.5
/** Score per (year of lean × year younger than the window's average). A 2-year lean and a player 3 years
 *  younger than the window add 0.3 — about a position habit's weight, never more than ADP closeness. */
export const YOUTH_WEIGHT = 0.05
/** A player's age gap from the window counts up to this many years, so youth alone can never outweigh a long reach. */
export const MAX_AGE_GAP = 3

const pos = (p: string) => String(p ?? '').trim().toUpperCase()

export function buildDraftStyle(picks: readonly StylePick[]): DraftStyle | null {
  let sum = 0
  let withAdp = 0
  const counts: Record<string, number> = {}
  let total = 0
  for (const p of picks) {
    const position = pos(p.position)
    if (!position) continue
    counts[position] = (counts[position] ?? 0) + 1
    total += 1
    if (p.adpAtPick != null && Number.isFinite(p.adpAtPick) && p.adpAtPick > 0 && p.adpAtPick <= STYLE_ADP_HORIZON && Number.isFinite(p.overall)) {
      sum += p.overall - p.adpAtPick
      withAdp += 1
    }
  }
  if (withAdp < MIN_STYLE_SAMPLE || total === 0) return null
  const positionShare: Record<string, number> = {}
  for (const [k, n] of Object.entries(counts)) positionShare[k] = n / total
  return { reachDelta: sum / withAdp, positionShare, sample: withAdp, youthLean: measureYouthLean(picks) }
}

/** Mean of (draft's average age − picked player's age), over picks with both; null below the sample bar. */
export function measureYouthLean(picks: readonly StylePick[]): number | null {
  let sum = 0
  let n = 0
  for (const p of picks) {
    if (p.age == null || p.draftMeanAge == null || !Number.isFinite(p.age) || !Number.isFinite(p.draftMeanAge)) continue
    sum += p.draftMeanAge - p.age
    n += 1
  }
  return n >= MIN_STYLE_SAMPLE ? sum / n : null
}

/**
 * The player this manager would most likely take at `overall`, or null when the board has too little
 * ADP to judge. `ownPositions` is what they have already drafted in THIS draft; `eligible` limits the
 * board to positions the roster can use.
 */
export function pickLikeManager<T extends BoardPlayer>(args: {
  style: DraftStyle
  overall: number
  board: readonly T[]
  ownPositions: readonly string[]
  eligible?: ReadonlySet<string> | null
}): { player: T; targetAdp: number } | null {
  const { style, overall } = args
  const window = args.board
    .filter((p) => p.adp != null && Number.isFinite(p.adp) && p.adp > 0)
    .filter((p) => !args.eligible || args.eligible.size === 0 || args.eligible.has(pos(p.position)))
    .sort((a, b) => (a.adp as number) - (b.adp as number))
    .slice(0, WINDOW)
  if (window.length < 3) return null

  // overall − adp = reachDelta  ⇒  the ADP this manager usually takes at this pick.
  const shift = Math.max(-MAX_REACH, Math.min(MAX_REACH, -style.reachDelta))
  const targetAdp = Math.max(1, overall + shift)
  const spread = Math.max(4, (window[window.length - 1]!.adp as number) - (window[0]!.adp as number))
  const owned: Record<string, number> = {}
  for (const p of args.ownPositions) owned[pos(p)] = (owned[pos(p)] ?? 0) + 1
  const picksSoFar = args.ownPositions.length
  const positions = Object.keys(style.positionShare).length || 1
  // Youth: only a real habit tilts, and only between players whose ages are on file.
  const lean = style.youthLean != null && Math.abs(style.youthLean) >= MIN_YOUTH_LEAN ? Math.max(-MAX_YOUTH_LEAN, Math.min(MAX_YOUTH_LEAN, style.youthLean)) : 0
  const aged = window.filter((p) => p.age != null && Number.isFinite(p.age))
  const windowAge = aged.length >= 2 ? aged.reduce((t, p) => t + (p.age as number), 0) / aged.length : null

  let best: { player: T; score: number } | null = null
  for (const p of window) {
    const position = pos(p.position)
    const share = style.positionShare[position] ?? 0
    // Their habit, plus one so a first pick at a position is never blocked.
    const habitCap = Math.ceil(share * (picksSoFar + 1)) + 1
    if ((owned[position] ?? 0) >= habitCap) continue
    const closeness = -Math.abs((p.adp as number) - targetAdp) / spread
    const habit = (share - 1 / positions) * 1.5
    const youth = lean !== 0 && windowAge != null && p.age != null && Number.isFinite(p.age) ? lean * Math.max(-MAX_AGE_GAP, Math.min(MAX_AGE_GAP, windowAge - p.age)) * YOUTH_WEIGHT : 0
    const score = closeness + habit + youth
    if (!best || score > best.score) best = { player: p, score }
  }
  return best ? { player: best.player, targetAdp } : null
}
