/**
 * A static, type-level registry of Commissioner OS's platform services —
 * deliberately not a runtime dependency-injection container. A dynamic,
 * string-keyed service locator would hide the actual dependency behind a
 * runtime lookup, which is exactly what the Engineering Conformance
 * Gates' import-graph checks (rules #3, #4, #18) cannot see through.
 * "Registry" here means an agreed, documented contract list — closer to a
 * shared types file than a DI framework.
 *
 * No implementation lives here. Search, Notifications, Activity Stream,
 * and Help Center are all later milestones (Architecture Index §9 — Shared
 * Platform Service Blueprints); this only records what each one's
 * placeholder shape is while it doesn't exist yet.
 */

export type CommissionerPlatformServiceId = 'search' | 'notifications' | 'activity-stream' | 'help-center'

export interface CommissionerPlatformServiceContract {
  id: CommissionerPlatformServiceId
  displayName: string
  /**
   * True once a dedicated blueprint document exists for this service.
   *
   * Notifications is architecturally well-established — a Decision
   * Ownership Matrix row, referenced as the delivery target by many
   * module blueprints (Recommendations Center §31, Universal Activity
   * Stream §21, Operational Work Queues) — but has never had its own
   * dedicated specification the way Search and Activity Stream did.
   * False here reflects that documentation gap, not doubt about whether
   * the service belongs in the architecture.
   *
   * Help Center originally had no grounding anywhere in the architecture
   * series at all — it did not appear in the PRD, the Architecture Index,
   * or the Decision Ownership Matrix, and was included here only because
   * Phase 0.3's task explicitly requested a placeholder for it. That gap
   * was closed in Phase 1.11: a Discovery Report confirmed it (rather
   * than assuming it away), and a real blueprint
   * (`lib/commissioner-ui/help/BLUEPRINT.md`) was authored and approved
   * before implementation began.
   */
  hasDedicatedBlueprint: boolean
}

export const COMMISSIONER_PLATFORM_SERVICE_CONTRACTS: Record<
  CommissionerPlatformServiceId,
  CommissionerPlatformServiceContract
> = {
  search: {
    id: 'search',
    displayName: 'Global Search & Command Palette',
    hasDedicatedBlueprint: true,
  },
  notifications: {
    id: 'notifications',
    displayName: 'Notification Center',
    hasDedicatedBlueprint: false,
  },
  'activity-stream': {
    id: 'activity-stream',
    displayName: 'Universal Activity Stream',
    hasDedicatedBlueprint: true,
  },
  'help-center': {
    id: 'help-center',
    displayName: 'Help Center',
    hasDedicatedBlueprint: true,
  },
}

export function getCommissionerPlatformService(id: CommissionerPlatformServiceId): CommissionerPlatformServiceContract {
  return COMMISSIONER_PLATFORM_SERVICE_CONTRACTS[id]
}
