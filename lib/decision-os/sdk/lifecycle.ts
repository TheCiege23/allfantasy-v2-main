/**
 * Decision OS — Phase 7.4 Widget SDK lifecycle state machine.
 *
 * Pure, deterministic lifecycle contract. No rendering code — only the state
 * machine every platform SDK runtime must implement identically.
 *
 * States: initializing → authenticating → loading → rendering → ready →
 *   refreshing → (back to ready) | error | offline | rate_limited | disposed
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKLifecycleState } from './types'

// ── Transition table ──────────────────────────────────────────────────────────

/**
 * Valid next states for each lifecycle state.
 * 'disposed' is terminal — no outbound transitions.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<SDKLifecycleState, readonly SDKLifecycleState[]>> = {
  initializing:   ['authenticating', 'error', 'disposed'],
  authenticating: ['loading', 'error', 'rate_limited', 'disposed'],
  loading:        ['rendering', 'error', 'offline', 'rate_limited', 'disposed'],
  rendering:      ['ready', 'error', 'disposed'],
  ready:          ['refreshing', 'error', 'offline', 'disposed'],
  refreshing:     ['ready', 'error', 'offline', 'rate_limited', 'disposed'],
  error:          ['initializing', 'disposed'],
  offline:        ['loading', 'disposed'],
  rate_limited:   ['loading', 'disposed'],
  disposed:       [],
}

export const ALL_LIFECYCLE_STATES: readonly SDKLifecycleState[] = [
  'initializing', 'authenticating', 'loading', 'rendering', 'ready',
  'refreshing', 'error', 'offline', 'rate_limited', 'disposed',
]

export const TERMINAL_LIFECYCLE_STATES: readonly SDKLifecycleState[] = ['disposed']

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Whether a transition from `from` to `to` is permitted by the state machine.
 * Self-transitions (from === to) are never valid — a runtime must always
 * make forward progress or explicitly handle the transition as a new event.
 */
export function isValidLifecycleTransition(
  from: SDKLifecycleState,
  to: SDKLifecycleState,
): boolean {
  if (from === to) return false
  return LIFECYCLE_TRANSITIONS[from].includes(to)
}

/**
 * Returns the ordered list of valid next states for a given state.
 * Deterministic — always returns the same array contents for the same input.
 */
export function nextLifecycleStates(from: SDKLifecycleState): SDKLifecycleState[] {
  return [...LIFECYCLE_TRANSITIONS[from]]
}

/** Whether a state is terminal (no further transitions possible). */
export function isTerminalLifecycleState(state: SDKLifecycleState): boolean {
  return TERMINAL_LIFECYCLE_STATES.includes(state)
}

/**
 * Validates an entire lifecycle transition sequence (e.g. from recorded
 * telemetry or a test scenario). Returns the first invalid transition found,
 * or null if the whole sequence is valid.
 */
export function validateLifecycleSequence(
  states: SDKLifecycleState[],
): { valid: boolean; invalidAt: number | null; reason: string | null } {
  for (let i = 1; i < states.length; i++) {
    const from = states[i - 1]
    const to = states[i]
    if (isTerminalLifecycleState(from)) {
      return { valid: false, invalidAt: i, reason: `'${from}' is terminal; cannot transition to '${to}'` }
    }
    if (!isValidLifecycleTransition(from, to)) {
      return { valid: false, invalidAt: i, reason: `'${from}' → '${to}' is not a permitted transition` }
    }
  }
  return { valid: true, invalidAt: null, reason: null }
}
