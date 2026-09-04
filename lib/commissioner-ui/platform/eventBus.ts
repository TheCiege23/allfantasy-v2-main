/**
 * A minimal, typed publish/subscribe bus for cross-module Commissioner OS
 * communication.
 *
 * This is deliberately not a runtime service locator. Modules still import
 * each other's public interfaces statically (Developer Playbook §6;
 * Engineering Conformance Gates rules #3/#4/#18 depend on that being true
 * to do static import-graph analysis at all). This bus exists only for the
 * narrower case of loosely-coupled notification — "something happened"
 * that several modules might independently care about without any of them
 * needing a direct dependency on whichever module raised it.
 *
 * No existing event or message bus was found in this repository during
 * Phase 0.3's repository discovery — this is genuinely new infrastructure,
 * not a duplicate of something already there.
 */

import type { CommissionerPlatformEvent } from './events'

type EventType = CommissionerPlatformEvent['type']
type ListenerFor<E extends EventType> = (event: Extract<CommissionerPlatformEvent, { type: E }>) => void

export class CommissionerEventBus {
  // Internally untyped per event-type bucket by necessity (a single Map
  // can't express "the listener set for key K only holds Listener<K>"
  // in TypeScript) — external subscribe()/publish() below stay fully
  // typed, which is what actually matters for callers.
  private listeners = new Map<EventType, Set<(event: CommissionerPlatformEvent) => void>>()

  subscribe<E extends EventType>(type: E, listener: ListenerFor<E>): () => void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener as (event: CommissionerPlatformEvent) => void)
    this.listeners.set(type, set)
    return () => {
      set.delete(listener as (event: CommissionerPlatformEvent) => void)
    }
  }

  publish(event: CommissionerPlatformEvent): void {
    const set = this.listeners.get(event.type)
    if (!set || set.size === 0) return
    for (const listener of set) {
      listener(event)
    }
  }

  /** Test/debug only — never used by production event flow. */
  listenerCount(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

/**
 * One shared instance, used by CommissionerPlatformProvider throughout the
 * app. The CommissionerEventBus class itself is exported too — only for
 * constructing isolated instances in tests, never for a second production
 * instance.
 */
export const commissionerEventBus = new CommissionerEventBus()
