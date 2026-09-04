import type { CommissionerModuleId } from './navigation'

/**
 * Search result contract, deliberately shaped for future compatibility
 * with the existing lib/search system (UniversalSearchService,
 * SearchResultCategory, SearchResultItem) discovered during Phase 0.3 —
 * Commissioner OS's eventual Search work should extend that system with
 * these categories, not build a parallel result shape. See
 * lib/commissioner-ui/platform/README.md.
 */
export type CommissionerSearchResultCategory =
  | 'recommendation'
  | 'manager'
  | 'task'
  | 'report'
  | 'setting'
  | 'automation'
  | 'page'
  | 'help'

export interface CommissionerSearchResultContract {
  id: string
  category: CommissionerSearchResultCategory
  title: string
  href: string
  sourceModuleId: CommissionerModuleId
}
