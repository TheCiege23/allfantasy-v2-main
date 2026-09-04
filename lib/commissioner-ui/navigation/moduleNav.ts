/**
 * Commissioner OS module navigation — the sidebar's primary destinations.
 *
 * Deliberately self-contained. lib/shell's ProductId/SHELL_NAV_ITEMS is the
 * existing product switcher for the live home/webapp/bracket/legacy
 * surfaces — Commissioner OS is not registered there, and folding it in
 * would mean editing a closed union type and shared route-resolution logic
 * used across the entire existing app, for a product surface that is still
 * placeholder-only. That's a bigger decision than a foundation phase
 * should make unilaterally (see the Repository Discovery Rules appendix,
 * Developer Playbook). The NavItem-shaped convention below intentionally
 * mirrors lib/shell's for consistency, without importing or extending its
 * content.
 */

export type CommissionerModuleId =
  | 'mission-control'
  | 'league-health'
  | 'recommendations'
  | 'managers'
  | 'workspace'
  | 'automations'
  | 'analytics'
  | 'reports'
  | 'settings'
  | 'activity'
  | 'help'

export interface CommissionerModuleNavItem {
  id: CommissionerModuleId
  href: string
  label: string
}

/** Primary sidebar items, in Decision Hierarchy order per the Mission Control Blueprint. */
export const COMMISSIONER_MODULE_NAV_ITEMS: CommissionerModuleNavItem[] = [
  { id: 'mission-control', href: '/commissioner-os', label: 'Mission Control' },
  { id: 'league-health', href: '/commissioner-os/league-health', label: 'League Health' },
  { id: 'recommendations', href: '/commissioner-os/recommendations', label: 'Recommendations' },
  { id: 'managers', href: '/commissioner-os/managers', label: 'Manager Intelligence' },
  { id: 'workspace', href: '/commissioner-os/workspace', label: 'Workspace' },
  { id: 'automations', href: '/commissioner-os/automations', label: 'Automations' },
  { id: 'analytics', href: '/commissioner-os/analytics', label: 'League Analytics' },
  { id: 'reports', href: '/commissioner-os/reports', label: 'Reports' },
  { id: 'settings', href: '/commissioner-os/settings', label: 'Settings' },
]

/** Lower-weight sidebar entries, per Mission Control's information hierarchy. */
export const COMMISSIONER_SECONDARY_NAV_ITEMS: CommissionerModuleNavItem[] = [
  { id: 'activity', href: '/commissioner-os/activity', label: 'Activity Stream' },
  { id: 'help', href: '/commissioner-os/help', label: 'Help & Knowledge Center' },
]

export const COMMISSIONER_ALL_NAV_ITEMS: CommissionerModuleNavItem[] = [
  ...COMMISSIONER_MODULE_NAV_ITEMS,
  ...COMMISSIONER_SECONDARY_NAV_ITEMS,
]

/**
 * Search has no sidebar entry — reached via the Command Palette overlay per
 * the Global Search & Command Palette blueprint (§3–4: keyboard shortcut,
 * header button, mobile action) — but still resolves to a direct-linkable
 * route, per this phase's explicit placeholder requirement.
 */
export const COMMISSIONER_SEARCH_ROUTE = '/commissioner-os/search'

export function isCommissionerModuleActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (href === '/commissioner-os') return pathname === '/commissioner-os'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function getActiveCommissionerModuleId(pathname: string | null): CommissionerModuleId | null {
  if (!pathname) return null
  const match = COMMISSIONER_ALL_NAV_ITEMS.find((item) => isCommissionerModuleActive(pathname, item.href))
  return match?.id ?? null
}

const MODULE_LABELS: Record<CommissionerModuleId, string> = Object.fromEntries(
  COMMISSIONER_ALL_NAV_ITEMS.map((item) => [item.id, item.label])
) as Record<CommissionerModuleId, string>

/**
 * A module id's display label, looked up from the same nav data every
 * sidebar entry already uses — promoted here once both Notification
 * Center and Activity Stream needed the identical lookup (`sourceModuleId`
 * → a human label), so neither module's own label file defines it twice.
 * Falls back to the raw id for a source with no nav entry (none exist
 * today, but this stays honest if one ever is added without a label).
 */
export function getModuleLabel(moduleId: CommissionerModuleId): string {
  return MODULE_LABELS[moduleId] ?? moduleId
}
