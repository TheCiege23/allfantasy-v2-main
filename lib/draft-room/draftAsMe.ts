/**
 * DRAFT AS ME — when a manager misses a pick, the autopick drafts the way THEY draft instead of
 * taking the plain best available player (AF Commissioner, owner decision 2026-10-26,
 * docs/AF_COMMISSIONER_SETTINGS_SPEC.md §5).
 *
 * A manager's style comes from their own completed drafts (managerHistoryReads.ts supplies the same
 * picks it uses for the reach/value read):
 *   - how far from ADP they take players (`reachDelta`, overall − ADP: negative = reaches early)
 *   - which positions they spend picks on (`positionShare`)
 *
 * The pick is made from the top of the board only — the `WINDOW` best available by ADP — so a style
 * can tilt a pick but never produce one no human would make. A position the manager already holds
 * more of than their habit says is passed over. Not enough history means no style: the caller falls
 * back to its ordinary autopick rather than guessing.
 *
 * Pure. No Prisma, no fetch.
 */

export type StylePick = { overall: number; adpAtPick: number | null; position: string }

export type DraftStyle = {
  /** Mean of overall − ADP across past picks inside the ADP horizon. Negative: takes players early. */
  reachDelta: number
  /** Share of past picks at each position (upper-case), summing to 1. */
  positionShare: Record<string, number>
  /** Past picks behind the read. */
  sample: number
}

export type BoardPlayer = {
  playerName: string
  position: string
  adp: number | null
}

/** Past picks needed before a style is trusted. */
export const MIN_STYLE_SAMPLE = 10
/** Picks deep in a draft drift from ADP for reasons that are not style (the board runs thin). */
export const STYLE_ADP_HORIZON = 150
/** Only the top of the board is considered. */
export const WINDOW = 15
/** A reach is capped at this many picks, so one wild past draft cannot send a pick off the board. */
export const MAX_REACH = 18

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
  return { reachDelta: sum / withAdp, positionShare, sample: withAdp }
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

  let best: { player: T; score: number } | null = null
  for (const p of window) {
    const position = pos(p.position)
    const share = style.positionShare[position] ?? 0
    // Their habit, plus one so a first pick at a position is never blocked.
    const habitCap = Math.ceil(share * (picksSoFar + 1)) + 1
    if ((owned[position] ?? 0) >= habitCap) continue
    const closeness = -Math.abs((p.adp as number) - targetAdp) / spread
    const lean = (share - 1 / positions) * 1.5
    const score = closeness + lean
    if (!best || score > best.score) best = { player: p, score }
  }
  return best ? { player: best.player, targetAdp } : null
}
