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

export type WaiverSeasonPhase = 'pre_draft' | 'regular' | 'playoffs' | 'offseason'

export type WaiverPhaseCode =
  | 'pre_draft_locked'
  | 'offseason_closed'
  | 'offseason_fcfs'
  | 'playoffs_locked'
  | 'playoffs_eliminated'
  | 'best_ball_draft_only'
  | 'best_ball_no_claims'
  | 'best_ball_no_adds'

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
  pre_draft_locked: 'Waiver claims are closed until the draft is complete; player adds open then too.',
  offseason_closed: 'Waiver claims are closed for the offseason, and so is free agency. Both reopen after next season’s draft.',
  offseason_fcfs: 'Waiver claims are closed for the offseason. Free agents are first come, first served — add a player directly.',
  playoffs_locked: 'Waiver claims are closed: every roster is locked for the playoffs.',
  playoffs_eliminated: 'Waiver claims are closed for your team: only teams still alive in the playoff bracket can make moves.',
  best_ball_draft_only:
    'Waiver claims are closed: this is a draft-only Best Ball league. Rosters are set at the draft and the best lineup is picked automatically each week.',
  best_ball_no_claims: 'Waiver claims are closed in this Best Ball league. The commissioner has turned waivers off.',
  best_ball_no_adds:
    'Waiver claims are closed to direct adds in this Best Ball league: the commissioner has turned free agency off. Claim players through waivers instead.',
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
 * A native Classic Best Ball league's saved transaction policy (`League.bbWaiversEnabled` /
 * `bbFaEnabled`). Null for every other league — including Guilly + Best Ball, whose survivors MUST
 * keep waivers and FAAB to claim released rosters.
 */
export type BestBallRosterPolicy = { waiversEnabled: boolean; freeAgencyEnabled: boolean }

/**
 * 🛑 CLASSIC BEST BALL IS DRAFT-ONLY UNLESS THE COMMISSIONER SAID OTHERWISE, AND UNTIL 2026-11-06
 * NOTHING ON THE SERVER SAID SO. Creation and `/api/bestball/settings` save `bbWaiversEnabled` /
 * `bbFaEnabled` (both default false), and no waiver path read either: a Classic Best Ball manager
 * could add, drop and claim exactly like a redraft manager. The phase gate is the one choke point
 * every waiver path already goes through (add/drop, `createClaim`, the redraft claim route, the
 * processor), so the saved policy is applied here — narrowing, never widening, what the phase allows.
 */
export function resolveWaiverPhasePolicy(input: {
  phase: WaiverSeasonPhase
  offseasonRule: OffseasonWaiverRule
  playoffRule: PlayoffWaiverRule
  dynastyFamily: boolean
  eliminated: boolean | null
  bestBallRoster?: BestBallRosterPolicy | null
}): WaiverPhasePolicy {
  return applyBestBallRosterPolicy(resolvePhaseOnlyPolicy(input), input.bestBallRoster ?? null)
}

export function applyBestBallRosterPolicy(base: WaiverPhasePolicy, bb: BestBallRosterPolicy | null): WaiverPhasePolicy {
  if (!bb) return base
  const claimsAllowed = base.claimsAllowed && bb.waiversEnabled
  const immediateAddsAllowed = base.immediateAddsAllowed && bb.freeAgencyEnabled
  if (claimsAllowed === base.claimsAllowed && immediateAddsAllowed === base.immediateAddsAllowed) return base
  // A phase refusal already explains itself; only an otherwise-open phase takes the best ball reason.
  const code: WaiverPhaseCode =
    base.code ?? (!claimsAllowed && !immediateAddsAllowed ? 'best_ball_draft_only' : !claimsAllowed ? 'best_ball_no_claims' : 'best_ball_no_adds')
  return {
    ...base,
    claimsAllowed,
    immediateAddsAllowed,
    firstComeAdds: immediateAddsAllowed && base.firstComeAdds,
    code,
    reason: PHASE_REASONS[code],
  }
}

/**
 * What the phase allows. `eliminated` is the asking team's title-bracket state: true = out, false =
 * still alive, null = unknown (no team, or no bracket) — unknown never blocks.
 */
function resolvePhaseOnlyPolicy(input: {
  phase: WaiverSeasonPhase
  offseasonRule: OffseasonWaiverRule
  playoffRule: PlayoffWaiverRule
  dynastyFamily: boolean
  eliminated: boolean | null
}): WaiverPhasePolicy {
  const { phase } = input
  if (phase === 'pre_draft') return blocked(phase, 'pre_draft_locked')
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
