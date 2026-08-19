/**
 * Decision OS — Phase 7.6 Widget Runtime Core: lifecycle controller.
 *
 * Owns the current SDKLifecycleState and drives transitions through the
 * deterministic Phase 7.4 lifecycle table (`lib/decision-os/sdk/lifecycle.ts`).
 * Invalid transitions throw a typed programmer error (not an SDKError) —
 * these indicate a runtime/adapter bug, not a user-facing failure mode.
 */

import {
  isValidLifecycleTransition,
  nextLifecycleStates,
} from '../../../lib/decision-os/sdk/lifecycle'
import type { SDKLifecycleState } from '../../../lib/decision-os/sdk/types'

export class InvalidLifecycleTransitionError extends Error {
  readonly fromState: SDKLifecycleState
  readonly toState: SDKLifecycleState

  constructor(fromState: SDKLifecycleState, toState: SDKLifecycleState) {
    super(`Invalid lifecycle transition: '${fromState}' → '${toState}'`)
    this.name = 'InvalidLifecycleTransitionError'
    this.fromState = fromState
    this.toState = toState
  }
}

export class LifecycleController {
  private state: SDKLifecycleState
  private readonly transitionHistory: SDKLifecycleState[]

  constructor(initialState: SDKLifecycleState = 'initializing') {
    this.state = initialState
    this.transitionHistory = [initialState]
  }

  get currentState(): SDKLifecycleState {
    return this.state
  }

  /** Full ordered history of states this controller has held, including the initial state. */
  get history(): readonly SDKLifecycleState[] {
    return [...this.transitionHistory]
  }

  canTransition(to: SDKLifecycleState): boolean {
    return isValidLifecycleTransition(this.state, to)
  }

  nextStates(): SDKLifecycleState[] {
    return nextLifecycleStates(this.state)
  }

  /**
   * Transitions to `to`. Throws InvalidLifecycleTransitionError if the
   * transition is not permitted by the Phase 7.4 lifecycle table — this is
   * a programmer error, never converted to an SDKError.
   */
  transition(to: SDKLifecycleState): SDKLifecycleState {
    if (!isValidLifecycleTransition(this.state, to)) {
      throw new InvalidLifecycleTransitionError(this.state, to)
    }
    this.state = to
    this.transitionHistory.push(to)
    return this.state
  }
}
