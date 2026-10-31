/**
 * Waiver rules by season phase — the offseason and the playoffs. Pure and client-safe: the server
 * gate (lib/waiver-wire/season-phase-gate.ts) loads the inputs, and the waiver screens read the same
 * policy off GET /api/waiver-wire/leagues/:id/settings to say why a move is blocked.
 *
 * The commissioner's rules live in `LeagueWaiverSettings.waiverEngineConfig`
 * (`offseason_waiver_rules`, `playoff_waiver_rules`; readers in hub-waiver-options.ts):
 *   - offseason `closed` (default) — no claims and no adds. `fcfs` — first-come adds only, whatever
 *     the league's waiver type, with no waiver period on dropped players; claims stay off.
 *   - playoffs `all_teams` (default) — unchanged. `alive_only` — a team out of the title bracket can
 *     neither claim nor add. `locked` — nobody can, until the season ends.
 *
 * A dynasty-family league's offseason is not governed by the offseason rule: its rosters carry over
 * and the lifecycle gate keeps its offseason open on purpose (server/services/leagueLifecycleService.ts).
 */
import type { OffseasonWaiverRule, PlayoffWaiverRule } from './hub-waiver-options'

export type WaiverSeasonPhase = 'regular' | 'playoffs' | 'offseason'

export type WaiverPhaseCode = 'offseason_closed' | 'offseason_fcfs' | 'playoffs_locked' | 'playoffs_eliminated'

export type WaiverPhasePolicy = {
  phase: WaiverSeasonPhase
  claimsAllowed: boolean
  immediateAddsAllowed: boolean
  /** Offseason FCFS: an add is first come, first served — no waiver type, no waiver period. */
  firstComeAdds: boolean
  /** Set whenever the phase changes what a manager can do; null when nothing does. */
  code: WaiverPhaseCode | null
  /** The server's sentence for `code`. The add/drop and claim refusals use it verbatim. */
  reason: string | null
}

/** Claim refusals start "Waiver claims are closed", which the claims route maps to WAIVER_CLOSED. */
export const PHASE_REASONS: Record<WaiverPhaseCode, string> = {
  offseason_closed: 'Waiver claims are closed for the offseason, and so is free agency. Both reopen after next season’s draft.',
  offseason_fcfs: 'Waiver claims are closed for the offseason. Free agents are first come, first served — add a player directly.',
  playoffs_locked: 'Waiver claims are closed: every roster is locked for the playoffs.',
  playoffs_eliminated: 'Waiver claims are closed for your team: only teams still alive in the playoff bracket can make moves.',
}

const OFFSEASON_STATES = new Set(['completed', 'offseason', 'renewal_pending'])
const BEFORE_DRAFT_STATES = new Set(['setup', 'pre_draft'])

/**
 * Which phase a league is in.
 *   - offseason: the season is over (`completed`, `offseason`, `renewal_pending`), or the league is
 *     back before its draft (`setup` / `pre_draft`) with a completed season behind it — between the
 *     season's end and next season's draft. A brand-new league before its first draft is not.
 *   - playoffs: the lifecycle says so, or the latest native season does. Bracket generation sets both
 *     (lib/playoff-runtime/resolveNflRedraftPlayoffRuntime.ts), but only the season row is set for
 *     every sport, so either is enough.
 */
export function resolveWaiverSeasonPhase(input: {
  lifecycleState: string | null | undefined
  latestSeasonStatus: string | null | undefined
  hasCompletedSeason: boolean
}): WaiverSeasonPhase {
  const state = String(input.lifecycleState ?? '')
  if (OFFSEASON_STATES.has(state)) return 'offseason'
  if (BEFORE_DRAFT_STATES.has(state)) return input.hasCompletedSeason ? 'offseason' : 'regular'
  if (state === 'playoffs' || input.latestSeasonStatus === 'playoffs') return 'playoffs'
  return 'regular'
}

const OPEN = { claimsAllowed: true, immediateAddsAllowed: true, firstComeAdds: false, code: null, reason: null } as const

function blocked(phase: WaiverSeasonPhase, code: WaiverPhaseCode): WaiverPhasePolicy {
  return { phase, claimsAllowed: false, immediateAddsAllowed: false, firstComeAdds: false, code, reason: PHASE_REASONS[code] }
}

/**
 * What the phase allows. `eliminated` is the asking team's title-bracket state: true = out, false =
 * still alive, null = unknown (no team, or no bracket) — unknown never blocks.
 */
export function resolveWaiverPhasePolicy(input: {
  phase: WaiverSeasonPhase
  offseasonRule: OffseasonWaiverRule
  playoffRule: PlayoffWaiverRule
  dynastyFamily: boolean
  eliminated: boolean | null
}): WaiverPhasePolicy {
  const { phase } = input
  if (phase === 'offseason') {
    if (input.dynastyFamily) return { phase, ...OPEN }
    if (input.offseasonRule === 'fcfs') {
      return {
        phase,
        claimsAllowed: false,
        immediateAddsAllowed: true,
        firstComeAdds: true,
        code: 'offseason_fcfs',
        reason: PHASE_REASONS.offseason_fcfs,
      }
    }
    return blocked(phase, 'offseason_closed')
  }
  if (phase === 'playoffs') {
    if (input.playoffRule === 'locked') return blocked(phase, 'playoffs_locked')
    if (input.playoffRule === 'alive_only' && input.eliminated === true) return blocked(phase, 'playoffs_eliminated')
  }
  return { phase, ...OPEN }
}
