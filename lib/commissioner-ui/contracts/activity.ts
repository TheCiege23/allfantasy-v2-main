import type { CommissionerModuleId } from './navigation'
import type { CommissionerNotificationSeverity } from './notifications'

/**
 * Activity event contract — matches the Universal Activity Stream
 * blueprint's Event Structure (§9) exactly: Event ID, Event Type, Source
 * Module, Timestamp, Initiator, Summary, Supporting Evidence Link. Reuses
 * the same severity vocabulary as notifications rather than inventing a
 * third scale.
 */
export interface CommissionerActivityEventContract {
  id: string
  type: string
  sourceModuleId: CommissionerModuleId
  severity: CommissionerNotificationSeverity
  initiator: 'human' | 'system'
  summary: string
  evidenceHref?: string
  timestamp: string
}
