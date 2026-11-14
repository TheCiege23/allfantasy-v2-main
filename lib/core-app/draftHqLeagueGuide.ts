/**
 * The top of ONE league's Draft HQ (/core/draft-hq?league=…) in plain words (2026-11-13).
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. The
 * page used to open on the full pick grid, with its "Draft HQ" title 1,500–2,200px further down, and
 * nothing on it said where you stand. Everything this needs is already loaded: the draft's status and
 * your slot (getDraftHqData), the live cursor and whose pick it is (getDraftBoardData), your picks with
 * trades applied, and what you have drafted. For an imported draft (the archive is the page) the
 * archive's own record says the status and pick count.
 *
 * Pure, so the rules are testable and the screens stay renderers.
 */

/** Which part of a draft's life this is — it decides the order of the page, not just the headline. */
export type LeagueDraftPhase = 'before' | 'live' | 'paused' | 'done'

export function leagueDraftPhase(status: string | null | undefined): LeagueDraftPhase | null {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'in_progress' || s === 'drafting' || s === 'live') return 'live'
  if (s === 'paused') return 'paused'
  if (s === 'completed' || s === 'complete' || s === 'post_draft' || s === 'done') return 'done'
  return 'before'
}

export type LeagueDraftHeadline =
  /** No draft we can read for this league. */
  | { kind: 'none' }
  | { kind: 'yourPick'; label: string | null }
  /** Paused. `yours` when the pick waiting is yours; otherwise your next pick, if you hold one. */
  | { kind: 'paused'; yours: boolean; next: string | null }
  /** Running, not your pick: where the draft is and when you are up. */
  | { kind: 'live'; pick: number | null; total: number | null; next: string | null; away: number | null }
  | { kind: 'before'; slot: number | null; teams: number | null }
  | { kind: 'done'; drafted: number | null }

type LeagueDraftHeadlineInput = {
  status: string | null
  /** From the live board (getDraftBoardData.clock); false when unknown. */
  yoursOnClock: boolean
  /** The next pick to be made, overall; null off a running draft. */
  currentPickOverall: number | null
  totalPicks: number | null
  /** Your picks with trades applied (getDraftHqData.pickSlots); null when unknown. */
  held: ReadonlyArray<{ overall: number; label: string }> | null
  yourSlot: number | null
  teamCount: number | null
  /** How many players you have drafted; null when unknown. */
  drafted: number | null
}

/** Your first pick at or after the current one — "next" is never a pick already made. */
function nextHeld(held: LeagueDraftHeadlineInput['held'], from: number | null) {
  if (!held || held.length === 0) return null
  const sorted = [...held].sort((a, b) => a.overall - b.overall)
  return from == null ? sorted[0]! : (sorted.find((p) => p.overall >= from) ?? null)
}

export function leagueDraftHeadline(input: LeagueDraftHeadlineInput): LeagueDraftHeadline {
  const phase = leagueDraftPhase(input.status)
  if (!phase) return { kind: 'none' }
  if (phase === 'done') return { kind: 'done', drafted: input.drafted }
  if (phase === 'before') return { kind: 'before', slot: input.yourSlot, teams: input.teamCount }

  const next = nextHeld(input.held, input.currentPickOverall)
  if (phase === 'paused') return { kind: 'paused', yours: input.yoursOnClock, next: next?.label ?? null }
  if (input.yoursOnClock) {
    // The pick on the clock IS yours; name it when the inventory agrees on which one it is.
    const onIt = next && input.currentPickOverall != null && next.overall === input.currentPickOverall ? next.label : null
    return { kind: 'yourPick', label: onIt }
  }
  return {
    kind: 'live',
    pick: input.currentPickOverall,
    total: input.totalPicks,
    next: next?.label ?? null,
    away: next && input.currentPickOverall != null ? next.overall - input.currentPickOverall : null,
  }
}

/** An imported draft (it runs on the platform; the archive is our record of it). */
type ImportedDraftHeadline =
  | { kind: 'drafting'; picks: number }
  | { kind: 'done'; picks: number; season: number | null }
  | { kind: 'before' }
  /** A status we do not recognise — shown as it is, never guessed into a phase. */
  | { kind: 'other'; status: string }

export function importedDraftHeadline(choice: { status: string; season: number | null }, picks: number): ImportedDraftHeadline {
  const phase = leagueDraftPhase(choice.status)
  if (phase === 'live' || phase === 'paused') return { kind: 'drafting', picks }
  if (phase === 'done') return { kind: 'done', picks, season: choice.season }
  const s = choice.status.trim().toLowerCase()
  if (s === 'pre_draft' || s === 'pre-draft' || s === 'scheduled' || s === 'upcoming') return { kind: 'before' }
  return { kind: 'other', status: choice.status }
}
