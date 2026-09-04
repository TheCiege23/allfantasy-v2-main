import type { CommissionerPlatformResponse, CommissionerActivityEventContract } from '../../contracts'

/**
 * Universal Activity Stream owns the curated, cross-module chronological
 * record of meaningful events — per its own placeholder description,
 * "never a duplicate of any module's own evidence, workflow, or audit
 * log." One method, mirroring Recommendations Center's own single
 * `getQueue()`: this is a stream of items Mission Control previews via
 * slicing, not an aggregate a `getSummary()` would compute — the same
 * "stream module" shape Recommendations already established, distinct
 * from the "aggregate module" shape Reports/Analytics/Automation/
 * Notifications use.
 */
export interface ActivityClient {
  getEvents(): Promise<CommissionerPlatformResponse<CommissionerActivityEventContract[]>>
}
