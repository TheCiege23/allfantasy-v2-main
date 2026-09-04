import { COMMISSIONER_ALL_NAV_ITEMS, type CommissionerModuleId } from './moduleNav'

export interface Breadcrumb {
  label: string
  href: string
}

/**
 * Per the Design Language & Experience System §3: breadcrumbs appear only
 * at depth 2 and depth 3 (List/Detail and Evidence views) — never on a
 * depth-1 module landing page, since the sidebar already shows where you
 * are there.
 */
export function resolveBreadcrumbs(
  moduleId: CommissionerModuleId | null,
  depth: 1 | 2 | 3,
  detailLabel?: string
): Breadcrumb[] {
  if (!moduleId || depth === 1) return []
  const moduleItem = COMMISSIONER_ALL_NAV_ITEMS.find((item) => item.id === moduleId)
  if (!moduleItem) return []

  const trail: Breadcrumb[] = [{ label: moduleItem.label, href: moduleItem.href }]
  if (depth === 3 && detailLabel) {
    trail.push({ label: detailLabel, href: '#' })
  }
  return trail
}
