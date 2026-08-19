/**
 * G15.1 — Event Foundation: Event Publisher abstraction.
 *
 * `publish(input, { tx })` normalizes + validates the event, then persists it via
 * the outbox store. When `tx` is supplied, persistence joins the caller's
 * transaction (atomic with the business write). It does NOT touch the bus — the
 * OutboxRelay dispatches asynchronously. This is the safe half of the outbox
 * pattern: write-with-the-transaction, deliver-separately.
 */
import { EventNormalizer } from './normalizer'
import type { DomainEvent, DomainEventInput, IEventPublisher, IOutboxStore, PersistOptions } from './types'

export class EventPublisher implements IEventPublisher {
  constructor(
    private readonly normalizer: EventNormalizer,
    private readonly outbox: IOutboxStore,
  ) {}

  async publish<T extends Record<string, unknown>>(
    input: DomainEventInput<T>,
    opts?: PersistOptions,
  ): Promise<DomainEvent<T>> {
    const event = this.normalizer.normalize(input)
    await this.outbox.enqueue(event, opts)
    return event
  }
}
