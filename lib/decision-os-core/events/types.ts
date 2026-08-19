/**
 * Decision OS Core — DecisionEvent (Phase 1).
 *
 * Public, stable name for the existing, already sport-agnostic `BehavioralEvent`
 * taxonomy in `lib/decision-os/behavioral/events`. This is a formalized alias,
 * not a new event bus or a new taxonomy — see
 * docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §13.7 / §16.
 *
 * Future OSes (DFS/Contest/etc.) should emit `DecisionEvent`s of this shape
 * rather than reaching into `lib/decision-os/behavioral` internals directly.
 */

import type { BehavioralEvent } from '@/lib/decision-os/behavioral/events/types'

/**
 * `DecisionEvent` is `BehavioralEvent` under its public Decision OS Core name.
 * Kept as a type alias (not a redeclaration) so the two can never drift apart.
 */
export type DecisionEvent = BehavioralEvent

export function toDecisionEvent(event: BehavioralEvent): DecisionEvent {
  return event
}
