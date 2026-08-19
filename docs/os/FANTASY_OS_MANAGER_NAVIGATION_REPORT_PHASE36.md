# Manager Navigation Report (Phase 36, Part 3)

## Change made

Added `{ href: "/manager-hub", label: "Manager Hub" }` to `lib/navigation/NavLinkResolver.ts`'s `PRIMARY_NAV_ITEMS`, positioned immediately after `/commissioner-hub` — matching existing terminology/pattern exactly (label style, single source-of-truth array, no new navigation component invented).

## Desktop

Real, verified entry point: `PRIMARY_NAV_ITEMS` feeds `DesktopNavBar.tsx` (via `GlobalTopNav.tsx`) directly — `/manager-hub` now appears in top-level desktop navigation, active-state and auth behavior inherited automatically from the existing `getPrimaryNavItems`/`ActiveNavStateResolver` machinery (no new logic needed, same mechanism every other item already uses).

## Mobile — deliberate, documented exclusion, matching an existing precedent

**Not added to `MobileBottomTabs.tsx`** (5 fixed slots: Home/Leagues/War Room/Chimmy/Profile) or **`MobileNavigationDrawer.tsx`**'s allowlist (which explicitly filters to specific hrefs per section). This mirrors the exact real precedent already established for `/commissioner-hub` — despite being a full top-level desktop nav item, Commissioner Hub has **zero mobile presence today**, confirmed via code. Extending Manager Hub further than its closest analog would be an unjustified inconsistency, not a fix. If mobile access to either hub becomes a real product priority, it should be a deliberate decision covering both hubs together, not a one-off change scoped to this phase.

## Verification

- **Active-state behavior**: inherited from `ActiveNavStateResolver`'s existing `href`-matching logic — no new code path.
- **Authentication behavior**: `/manager-hub`'s own page (`app/manager-hub/page.tsx`) is already session-gated independently of nav visibility — adding a nav link doesn't change or need to change that.
- **Mobile accessibility**: confirmed unaffected/unchanged (deliberately, see above).
- **Role visibility**: `PRIMARY_NAV_ITEMS` has no role-based filtering today (only `getPrimaryNavItems(isAdmin)` appends `/admin`) — `/manager-hub` is visible to all signed-in users, matching every other item in the list and matching the real page's own "works for any league role" design.
- **Localization**: no i18n wrapper exists on `PRIMARY_NAV_ITEMS`'s labels today (confirmed — they're plain English strings, same as `/commissioner-hub`, `/war-room`, etc.) — `/manager-hub`'s label follows the identical, existing (non-localized) convention. No new localization gap introduced.

## Tests

New: `__tests__/nav-link-resolver-manager-hub.test.ts` (3 tests) — confirms the entry exists, is present for both admin/non-admin resolution, and that no existing item was duplicated or removed.
