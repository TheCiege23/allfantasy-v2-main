import type { CommissionerSearchResultContract } from '../../contracts'

/**
 * Settings has no real client yet — Settings is still a placeholder
 * (Phase 1.8 does not build it). These five entries are not fabricated:
 * they're the exact sub-areas Settings' own placeholder text already
 * names ("league identity, constitution, rules, integrations, roles"),
 * every one pointing at the one real route that exists today. Static
 * product-defined navigation content, not backend data — the same reason
 * `pages` entries (built from `COMMISSIONER_ALL_NAV_ITEMS`) are safe to
 * include identically in both demo and live mode. When Settings gets its
 * own phase, this is replaced by a real client the same way every other
 * category already is. Shared by `demo.ts` and `live.ts` so it is defined
 * once, not duplicated.
 */
export const SETTINGS_RESULTS: CommissionerSearchResultContract[] = [
  { id: 'setting-league-identity', category: 'setting', title: 'League Identity', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-constitution', category: 'setting', title: 'League Constitution', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-rules', category: 'setting', title: 'Rules', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-integrations', category: 'setting', title: 'Integrations', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-roles', category: 'setting', title: 'Roles & Permissions', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
]
