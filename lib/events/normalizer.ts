/**
 * G15.1 — Event Foundation: Event Normalizer layer.
 *
 * Turns loose input into a validated, normalized DomainEvent:
 *   1. fill envelope defaults (id, timestamps, tenant, actor) — `normalizeDomainEvent`
 *   2. validate envelope shape (Zod) — `domainEventEnvelopeSchema`
 *   3. validate payload against the registered (type, version) schema
 *
 * `strict` controls unregistered types:
 *   - strict=false (default): unregistered types pass (payload unchecked) and are
 *     flagged in metadata. Lets G15.1 ship before any domain schema is registered.
 *   - strict=true: unregistered types are rejected. Flip on once schemas exist.
 */
import { domainEventEnvelopeSchema, normalizeDomainEvent } from './envelope'
import {
  EventValidationError,
  type DomainEvent,
  type DomainEventInput,
  type IEventSchemaRegistry,
} from './types'

export interface EventNormalizerOptions {
  strict?: boolean
}

export class EventNormalizer {
  constructor(
    private readonly registry: IEventSchemaRegistry,
    private readonly opts: EventNormalizerOptions = {},
  ) {}

  normalize<T extends Record<string, unknown>>(input: DomainEventInput<T>): DomainEvent<T> {
    const event = normalizeDomainEvent(input)

    const envelope = domainEventEnvelopeSchema.safeParse(event)
    if (!envelope.success) {
      const detail = envelope.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      throw new EventValidationError(`invalid event envelope for "${event.type}": ${detail}`)
    }

    if (this.registry.has(event.type, event.schemaVersion)) {
      const res = this.registry.validate(event.type, event.schemaVersion, event.payload)
      if (!res.ok) throw new EventValidationError(`invalid payload for ${event.type} v${event.schemaVersion}: ${res.error}`)
    } else if (this.opts.strict) {
      throw new EventValidationError(`no schema registered for ${event.type} v${event.schemaVersion} (strict mode)`)
    } else {
      // Non-strict: record that the payload was not schema-checked.
      return Object.freeze({
        ...event,
        metadata: { ...event.metadata, schemaUnregistered: true },
      }) as DomainEvent<T>
    }

    return event
  }
}
