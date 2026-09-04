import type { CommissionerModuleId } from './navigation'
import type { CommissionerRelatedLink } from './relatedLink'

/**
 * Notification payload contract for the future Notification Center.
 * Structurally informed by (but deliberately not extending) the existing,
 * unrelated types/platform-shared.ts PlatformNotification type — that one
 * is scoped to the existing app's wallet/chat/cross-product notifications
 * with its own severity scale (low/medium/high) and product taxonomy
 * (shared/app/bracket/legacy). Commissioner OS notifications use this
 * platform's own severity vocabulary instead, matching the Universal
 * Activity Stream blueprint's Event Severity model exactly.
 */
export type CommissionerNotificationSeverity = 'informational' | 'success' | 'warning' | 'critical'

export interface CommissionerNotificationPayload {
  id: string
  severity: CommissionerNotificationSeverity
  message: string
  sourceModuleId: CommissionerModuleId
  createdAt: string
  read: boolean
  /**
   * Where a commissioner goes to actually act on this notification —
   * added by Phase 1.9 (Notification Center). Optional because not every
   * notification has a single obvious destination beyond its own source
   * module. Reuses the existing cross-module link shape rather than
   * inventing a second "notification action" concept.
   */
  relatedLink?: CommissionerRelatedLink
}
