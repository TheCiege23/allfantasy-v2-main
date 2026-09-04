/**
 * Type-level only. These are the event *shapes* the platform event bus can
 * carry — no module currently publishes or subscribes to any of them.
 * The contract is agreed on here first, before any real producer or
 * consumer exists, per Developer Playbook §6's "interfaces are contracts"
 * principle applied to cross-module notification rather than module
 * ownership specifically. Kept deliberately small and infrastructure-
 * level — this is not a place to pre-invent business event types for
 * modules that don't exist yet.
 */

export interface CommissionerModuleActivatedEvent {
  type: 'module:activated'
  moduleId: string
  timestamp: string
}

/**
 * The generic contract a future Notification Center would consume.
 * Severity vocabulary matches the Universal Activity Stream blueprint's
 * own Event Severity model exactly (Informational/Success/Warning/
 * Critical) — reused, not reinvented.
 */
export interface CommissionerNotificationRaisedEvent {
  type: 'notification:raised'
  severity: 'informational' | 'success' | 'warning' | 'critical'
  message: string
  timestamp: string
}

export type CommissionerPlatformEvent = CommissionerModuleActivatedEvent | CommissionerNotificationRaisedEvent
