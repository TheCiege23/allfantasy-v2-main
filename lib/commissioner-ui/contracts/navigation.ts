/**
 * Navigation contract — re-exports the canonical types from
 * lib/commissioner-ui/navigation/moduleNav.ts rather than redefining them.
 * One-directional dependency (contracts depends on the implementation
 * file's type exports, never the reverse) — this avoids a circular
 * dependency while still giving every consumer one place to import
 * Commissioner OS contracts from.
 */
export type {
  CommissionerModuleId,
  CommissionerModuleNavItem,
} from '../navigation/moduleNav'
export type { Breadcrumb as CommissionerBreadcrumbContract } from '../navigation/breadcrumbs'
