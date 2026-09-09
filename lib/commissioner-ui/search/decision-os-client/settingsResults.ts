import type { CommissionerSearchResultContract } from '../../contracts'

/**
 * Settings' searchable sub-areas.
 *
 * 🛑 THESE USED TO NAME THE PLACEHOLDER'S SUB-AREAS, NOT THE PAGE'S. When Settings was a centred
 * card, its own copy promised "league identity, constitution, rules, integrations, roles", and these
 * five entries mirrored that text — reasonably, since it was the only description of the page that
 * existed. Now that Settings actually renders, three of those five point at sections it does not
 * have: there is no constitution, no integrations panel and no roles editor. A search result is a
 * promise that the thing you searched for is on the other side of it, and "Roles & Permissions"
 * landing on a page with no roles is the same class of failure as a default presented as a fact.
 *
 * These are the groups the page really renders. Static product-defined navigation content rather
 * than backend data — the same reason `pages` entries (built from `COMMISSIONER_ALL_NAV_ITEMS`) are
 * identical in demo and live mode. Shared by `demo.ts` and `live.ts` so it is defined once.
 *
 * ⚠ KEEP IN STEP WITH `readLeagueSettingsSnapshot`'s GROUPS. Nothing type-checks the correspondence —
 * the groups are built per-league at read time and this list is static — so a group added there and
 * not here is simply unsearchable, and one removed there leaves a dead result here.
 */
export const SETTINGS_RESULTS: CommissionerSearchResultContract[] = [
  { id: 'setting-league', category: 'setting', title: 'League format and size', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-roster', category: 'setting', title: 'Roster slots, bench, taxi and IR', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-scoring', category: 'setting', title: 'Scoring rules', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-waivers', category: 'setting', title: 'Waivers and FAAB budget', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-playoffs', category: 'setting', title: 'Playoffs and trade deadline', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
  { id: 'setting-draft', category: 'setting', title: 'Draft type', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
]
