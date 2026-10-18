/**
 * SURVIVOR REVEAL GATE — the only place that decides how much of a Tribal Council read a client
 * may receive. Pure and dependency-free so it can be unit-tested and shared by every payload
 * builder (season route, league summary, per-user tribal view).
 *
 * Rules:
 *  - Nothing is sent before the council is published (`isRevealed`) AND `revealStartsAt` has passed.
 *  - "One at a time" releases one step every REVEAL_STEP_MS from `revealStartsAt`; a commissioner
 *    can release faster with `reveal_next`, which advances `revealStep` (never the sequence).
 *  - "Commissioner" mode releases steps only through `revealStep`.
 *  - "All at once" releases the whole sequence at `revealStartsAt`.
 *  - The verdict (eliminated manager, tie) is withheld until every step is released.
 *  - Steps carry the name voted for and the ballot status only — never a voter or a user id.
 */

export const REVEAL_STEP_MS = 2500

export type RevealPacing = 'one_at_a_time' | 'all_at_once' | 'commissioner'

export type RevealStepStatus =
  | 'counts'
  | 'late_does_not_count'
  | 'forfeited_by_shot'
  | 'blocked_by_idol'
  | 'blocked_by_shot'
  | 'target_safe'
  | 'taken_by_vote_steal'

const STATUSES: ReadonlySet<string> = new Set<RevealStepStatus>([
  'counts', 'late_does_not_count', 'forfeited_by_shot', 'blocked_by_idol', 'blocked_by_shot', 'target_safe', 'taken_by_vote_steal',
])

/** What a client may see for one ballot. */
export interface PublicRevealStep {
  order: number
  targetName: string | null
  status: RevealStepStatus
  /** Second ballot from a double/extra vote. Shown as its own slip. */
  isExtraVote: boolean
}

export interface GatedReveal {
  /** Presentation for the client: commissioner pacing reads one at a time. */
  mode: 'one_at_a_time' | 'all_at_once'
  pacing: RevealPacing
  started: boolean
  /** Total ballots in the read; null until the read starts. */
  totalSteps: number | null
  visibleSteps: number
  complete: boolean
  /** When the server will release the next step on its own clock (one_at_a_time only). */
  nextStepAt: string | null
  steps: PublicRevealStep[]
  eliminatedName: string | null
  isTie: boolean
  tiePhase: string | null
}

export interface RevealGateInput {
  isRevealed: boolean
  revealStartsAt: Date | string | null | undefined
  revealStep?: number | null
  revealSequence: unknown
  revealMode?: string | null
  eliminatedName?: string | null
  isTie?: boolean | null
  tiePhase?: string | null
  now?: Date
}

/** League.survivorRevealMode → pacing. Unknown/legacy values read one at a time. */
export function normalizeRevealPacing(raw: string | null | undefined): RevealPacing {
  const value = (raw ?? '').trim().toLowerCase()
  if (['simultaneous', 'all_at_once', 'all', 'instant'].includes(value)) return 'all_at_once'
  if (['commissioner', 'manual', 'commissioner_paced'].includes(value)) return 'commissioner'
  return 'one_at_a_time'
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Parse a stored sequence into the public shape, dropping anything that is not a ballot. */
export function toPublicRevealSteps(raw: unknown): PublicRevealStep[] {
  if (!Array.isArray(raw)) return []
  const out: PublicRevealStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const status = typeof row.status === 'string' && STATUSES.has(row.status) ? (row.status as RevealStepStatus) : 'counts'
    out.push({
      order: out.length + 1,
      targetName: typeof row.targetName === 'string' && row.targetName.trim() ? row.targetName : null,
      status,
      isExtraVote: row.isExtraVote === true,
    })
  }
  return out
}

/**
 * How many steps a client may receive right now. `revealStartsAt` null on a published council is a
 * legacy row from before reveal timing was recorded; those reads finished long ago and are shown whole.
 */
export function revealVisibleCount(input: {
  isRevealed: boolean
  revealStartsAt: Date | string | null | undefined
  revealStep?: number | null
  total: number
  pacing: RevealPacing
  now?: Date
}): number {
  const { total } = input
  if (!input.isRevealed || total <= 0) return 0
  const start = toDate(input.revealStartsAt)
  if (!start) return total
  const now = input.now ?? new Date()
  if (now.getTime() < start.getTime()) return 0
  const released = Math.max(0, Math.floor(input.revealStep ?? 0))
  if (input.pacing === 'all_at_once') return total
  if (input.pacing === 'commissioner') return Math.min(total, released)
  const byClock = Math.floor((now.getTime() - start.getTime()) / REVEAL_STEP_MS) + 1
  return Math.min(total, Math.max(released, byClock))
}

export function gateRevealPayload(input: RevealGateInput): GatedReveal {
  const pacing = normalizeRevealPacing(input.revealMode)
  const mode = pacing === 'all_at_once' ? 'all_at_once' : 'one_at_a_time'
  const now = input.now ?? new Date()
  const start = toDate(input.revealStartsAt)
  const started = input.isRevealed && (!start || now.getTime() >= start.getTime())
  if (!started) {
    return { mode, pacing, started: false, totalSteps: null, visibleSteps: 0, complete: false, nextStepAt: null, steps: [], eliminatedName: null, isTie: false, tiePhase: null }
  }
  const all = toPublicRevealSteps(input.revealSequence)
  const visible = revealVisibleCount({ isRevealed: true, revealStartsAt: start, revealStep: input.revealStep, total: all.length, pacing, now })
  const complete = visible >= all.length
  const nextStepAt = !complete && pacing === 'one_at_a_time' && start
    ? new Date(start.getTime() + visible * REVEAL_STEP_MS).toISOString()
    : null
  return {
    mode,
    pacing,
    started: true,
    totalSteps: all.length,
    visibleSteps: visible,
    complete,
    nextStepAt,
    steps: all.slice(0, visible),
    eliminatedName: complete ? input.eliminatedName ?? null : null,
    isTie: complete ? input.isTie === true : false,
    tiePhase: complete ? input.tiePhase ?? null : null,
  }
}

/** The stored council fields the gate needs. */
export interface RevealStateRow {
  isRevealed: boolean
  revealStartsAt?: Date | string | null
  revealStep?: number | null
  revealSequence?: unknown
}

/**
 * True once every ballot of a published read has been released, i.e. the verdict may be shown.
 * Anything that names who was voted out (history, AI/Chimmy context, chat verdict, elimination)
 * must wait for this.
 */
export function isCouncilReadComplete(row: RevealStateRow, revealMode: string | null | undefined, now: Date = new Date()): boolean {
  if (!row.isRevealed) return false
  const start = toDate(row.revealStartsAt)
  if (start && now.getTime() < start.getTime()) return false
  const total = toPublicRevealSteps(row.revealSequence).length
  return revealVisibleCount({ isRevealed: true, revealStartsAt: row.revealStartsAt, revealStep: row.revealStep, total, pacing: normalizeRevealPacing(revealMode), now }) >= total
}
