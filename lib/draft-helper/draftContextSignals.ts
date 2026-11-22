/**
 * Draft-context signals the ONE draft engine (RecommendationEngine.ts) scores on top of value and
 * need, so its advice is specific to THIS draft rather than to drafts in general (2026-11-14).
 *
 *   - Scoring window: an in-season or tournament-stage draft scores only some NFL weeks. A player
 *     whose bye falls inside them loses a real share of his value to this roster; one whose bye is
 *     already played loses nothing. (The KBI tournament's redraft stage drafts in week 10 and
 *     scores weeks 11+, for example.)
 *   - Position runs: several managers taking the same position in a short span drains that
 *     position faster than ADP alone predicts.
 *   - The teams that pick before your next turn: how many of them still have an open starting slot
 *     at a position — facts about THEIR ROSTERS in THIS draft, never labels about the people and
 *     never a claim about what any one of them will pick (see the Competitive Edge rule, "facts,
 *     never labels", lib/competitive-edge/draftEdge.ts).
 *
 * PURE. Every function takes already-resolved inputs; the I/O lives in DraftContextAssembler.
 */

export type ScoringWindow = {
  /** First NFL week this draft's rosters score. */
  startWeek: number
  /** Last scoring week, when known (a tournament stage); null = through the end of the season. */
  endWeek: number | null
  /** Short human label, e.g. "Tournament round 2". */
  label?: string | null
}

export type ByeStatus = 'in_window' | 'played' | 'after_window' | 'unknown'

export type ByeWindowVerdict = { status: ByeStatus; score: number }

/** A season without a stage end is scored through week 17 for the purpose of sizing the window. */
const DEFAULT_SEASON_END_WEEK = 17

export function windowLength(window: ScoringWindow): number {
  const end = window.endWeek ?? DEFAULT_SEASON_END_WEEK
  return Math.max(1, end - window.startWeek + 1)
}

export function describeWindow(window: ScoringWindow): string {
  const range =
    window.endWeek == null
      ? `week ${window.startWeek} on`
      : window.endWeek === window.startWeek
        ? `week ${window.startWeek}`
        : `weeks ${window.startWeek}–${window.endWeek}`
  return window.label ? `${window.label} (${range})` : range
}

/**
 * How a player's bye sits against the scoring window, and what it is worth.
 *
 * A bye inside the window costs that week's points outright, so the penalty scales with how much of
 * the window one week is: a two-week stage loses half its value to one bye, a full season a
 * seventeenth. A bye already played is a small plus — it is the one guarantee of a full window.
 */
export function byeWindowVerdict(bye: number | null | undefined, window: ScoringWindow | null | undefined): ByeWindowVerdict {
  if (!window) return { status: 'unknown', score: 0 }
  if (bye == null || !Number.isFinite(Number(bye))) return { status: 'unknown', score: 0 }
  const week = Number(bye)
  const end = window.endWeek ?? DEFAULT_SEASON_END_WEEK
  if (week < window.startWeek) return { status: 'played', score: 2 }
  if (week > end) return { status: 'after_window', score: 0 }
  const penalty = Math.min(35, Math.max(8, Math.round(60 / windowLength(window))))
  return { status: 'in_window', score: -penalty }
}

export type PositionRun = {
  position: string
  /** Picks at this position in the window. */
  count: number
  /** How many recent picks the window spans. */
  window: number
}

/**
 * Runs in the most recent picks. The window is half a round (at least 6 picks); a run is a position
 * taking at least 40% of it and at least 3 picks — a cluster ADP alone would not produce.
 * `recentPositions` is oldest-first, as the picks were made.
 */
export function detectPositionRuns(recentPositions: readonly string[], totalTeams: number): PositionRun[] {
  const window = Math.max(6, Math.round(Math.max(2, totalTeams) / 2))
  const slice = recentPositions.slice(-window).map((p) => String(p || '').toUpperCase()).filter(Boolean)
  if (slice.length < Math.min(window, 6)) return []
  const counts = new Map<string, number>()
  for (const pos of slice) counts.set(pos, (counts.get(pos) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count >= 3 && count / slice.length >= 0.4)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([position, count]) => ({ position, count, window: slice.length }))
}

/** A run at a position you still need moves that position up: supply is leaving faster than ADP says. */
export function runUrgency(position: string, runs: readonly PositionRun[], needScore: number): number {
  const run = runs.find((r) => r.position === position.toUpperCase())
  if (!run || needScore < 40) return 0
  return Math.min(10, 2 * run.count)
}

export function describeRuns(runs: readonly PositionRun[]): string | null {
  if (runs.length === 0) return null
  return `Run on ${runs.map((r) => `${r.position} (${r.count} of the last ${r.window} picks)`).join(', ')}.`
}

/**
 * Snake-draft picks between now and the target's next turn. `currentOverall` is the pick on the
 * clock; `targetSlot` is the target's 1-based draft slot. Linear drafts repeat the same order.
 */
export function picksUntilNextTurn(args: {
  currentOverall: number
  targetSlot: number
  totalTeams: number
  snake: boolean
}): number {
  const teams = Math.max(1, args.totalTeams)
  for (let overall = args.currentOverall; overall < args.currentOverall + 2 * teams + 1; overall++) {
    const round = Math.ceil(overall / teams)
    const inRound = ((overall - 1) % teams) + 1
    const slot = args.snake && round % 2 === 0 ? teams - inRound + 1 : inRound
    if (slot === args.targetSlot) return overall - args.currentOverall
  }
  return teams
}

export type OpenSlotFact = { position: string; teams: number; of: number }

/**
 * For the teams picking before the target's next turn, how many still have an open STARTING slot
 * at each position — read off their own picks in this draft against the league's starting slots.
 * A count of rosters, not a prediction about any manager.
 */
export function openStarterSlotsAhead(args: {
  teamsAhead: ReadonlyArray<ReadonlyArray<string>>
  rosterSlots: readonly string[]
}): OpenSlotFact[] {
  const required = new Map<string, number>()
  for (const raw of args.rosterSlots) {
    const slot = String(raw || '').toUpperCase()
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(slot)) continue
    required.set(slot, (required.get(slot) ?? 0) + 1)
  }
  const out: OpenSlotFact[] = []
  for (const [position, need] of required) {
    const teams = args.teamsAhead.filter((positions) => positions.filter((p) => String(p).toUpperCase() === position).length < need).length
    if (teams > 0) out.push({ position, teams, of: args.teamsAhead.length })
  }
  return out.sort((a, b) => b.teams - a.teams || a.position.localeCompare(b.position))
}

export function describeOpenSlotsAhead(facts: readonly OpenSlotFact[], picksAhead: number): string | null {
  if (picksAhead <= 0 || facts.length === 0) return null
  const parts = facts.slice(0, 3).map((f) => `${f.teams} of ${f.of} still need a starting ${f.position}`)
  return `${picksAhead} pick${picksAhead === 1 ? '' : 's'} before your next turn: ${parts.join('; ')}.`
}
