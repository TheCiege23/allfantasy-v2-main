import type { CommissionerPlatformResponse, CommissionerSearchResultContract } from '../../contracts'

/**
 * Global Search & Command Palette is a platform service, not a business
 * module — per its own placeholder description, it "does not own"
 * recommendations, managers, tasks, reports, or automations, it only
 * provides fast access to them. `getIndex()` therefore returns
 * `CommissionerSearchResultContract` entries only: an id, category,
 * title, href, and `sourceModuleId` pointing back to whichever module
 * actually owns the underlying entity — never the entity's own data
 * (a recommendation's rationale, a task's description, and so on never
 * appear here, only enough to find and navigate to it).
 *
 * One method, not `search(query)` — the full index is small, in-memory,
 * and safe to fetch once per layout mount; matching against `query` is
 * `cmdk`'s own job (the same fuzzy-filtering every `Command` consumer
 * already gets for free), not logic this client should duplicate.
 */
export interface SearchClient {
  getIndex(): Promise<CommissionerPlatformResponse<CommissionerSearchResultContract[]>>
}
