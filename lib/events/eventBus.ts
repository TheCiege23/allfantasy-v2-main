/**
 * G15.1 — Event Foundation: in-process EventBus adapter.
 *
 * Mirrors the proven `lib/league-events/realtime-store.ts` pattern: an interface
 * (`IEventBus` in ./types), an in-process default, and a globalThis singleton.
 *
 * SWAP GUIDE (multi-instance / Redis Streams / BullMQ) — done in G15.3, NOT here:
 *   1. Implement `IEventBus` with the new transport.
 *   2. Inject it via `configureEventInfrastructure({ bus })` (see ./container).
 *   3. No call-site changes — consumers depend only on `IEventBus`.
 *
 * This adapter is single-process by design. Horizontal scaling does NOT depend on
 * it: the transactional outbox (./outboxStore) is the durable record, and the
 * relay (./outboxRelay) can dispatch from any instance once a distributed bus is
 * injected. G15.1 changes no existing behavior — nothing is rerouted onto this bus.
 */
import type { DomainEvent, EventHandler, IEventBus } from './types'

type Subscription = { pattern: string; handler: EventHandler }

function matches(pattern: string, type: string): boolean {
  if (pattern === '*' || pattern === type) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return type === prefix || type.startsWith(prefix + '.')
  }
  return false
}

export class InProcessEventBus implements IEventBus {
  private readonly subs = new Set<Subscription>()

  subscribe(typePattern: string, handler: EventHandler): () => void {
    const sub: Subscription = { pattern: typePattern, handler }
    this.subs.add(sub)
    return () => {
      this.subs.delete(sub)
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    const targets = [...this.subs].filter((s) => matches(s.pattern, event.type))
    // Isolate subscriber failures: one bad handler never blocks the others or the publisher.
    await Promise.all(
      targets.map(async (s) => {
        try {
          await s.handler(event)
        } catch {
          /* swallow — at-least-once delivery + idempotent consumers is the contract */
        }
      }),
    )
  }
}

const g = globalThis as typeof globalThis & { __afEventBus?: IEventBus }

/** Process-wide in-process bus singleton (survives across requests/HMR). */
export const inProcessEventBus: IEventBus = g.__afEventBus ?? (g.__afEventBus = new InProcessEventBus())
