import type { CommissionerModuleId } from './navigation'

export type CommissionerErrorCategory =
  | 'validation'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'upstream_unavailable'
  | 'unknown'

/**
 * Errors can be attributed to a business module (`CommissionerModuleId`)
 * or to a platform service that isn't one — Global Search & Command
 * Palette was the first of the four `CommissionerPlatformServiceId`
 * services (`lib/commissioner-ui/platform/serviceRegistry.ts`) to flow
 * real errors through this contract, so `'search'` was added narrowly
 * rather than importing that whole union — the same "don't build for
 * hypothetical future requirements" reasoning every other phase in this
 * program has already applied. `'notifications'` is added the identical
 * way now that Notification Center needs it. Activity Stream and Help
 * Center both turned out **not** to need this widening at all — both
 * became real `CommissionerModuleId`s in their own phase (concrete
 * scaffolding/blueprint decision, not a platform-service reach-through),
 * so their adapter methods pass a plain `CommissionerModuleId` instead.
 */
export type CommissionerErrorAttributableId = CommissionerModuleId | 'search' | 'notifications'

/** A platform-wide error shape every Commissioner OS interface returns instead of throwing an untyped Error. */
export interface CommissionerErrorContract {
  category: CommissionerErrorCategory
  message: string
  moduleId?: CommissionerErrorAttributableId
  retryable: boolean
  timestamp: string
}
