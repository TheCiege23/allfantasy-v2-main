/**
 * Resolves which navigation elements to show based on auth state.
 * Used by full shell (authenticated) and minimal shell (authenticated vs unauthenticated).
 */

import type { NavLinkItem } from "./NavLinkResolver"
import { getPrimaryNavItems } from "./NavLinkResolver"

interface ProtectedNavState {
  /** Show main nav tabs / drawer links (when authenticated in full shell, or when minimal shell shows app entry). */
  showPrimaryNav: boolean
  /** Show user menu / profile / settings (authenticated only). */
  showUserMenu: boolean
  /** Show login/signup links (unauthenticated only). */
  showAuthLinks: boolean
  /** Primary nav items to display (may include admin when isAdmin). */
  primaryItems: NavLinkItem[]
}

/**
 * Resolve nav visibility for the full app shell.
 * Full shell is only rendered for authenticated routes, so we always show primary nav and user menu.
 */
export function getProtectedNavStateFullShell(isAuthenticated: boolean, isAdmin: boolean): ProtectedNavState {
  return {
    showPrimaryNav: isAuthenticated,
    showUserMenu: isAuthenticated,
    showAuthLinks: !isAuthenticated,
    primaryItems: getPrimaryNavItems(isAdmin),
  }
}

/**
 * Resolve nav visibility for minimal shell (landing, tools-hub, etc.).
 * Shows auth links when unauthenticated; full user menu when authenticated.
 */
export function getProtectedNavStateMinimalShell(isAuthenticated: boolean, isAdmin: boolean): ProtectedNavState {
  return {
    showPrimaryNav: true,
    showUserMenu: isAuthenticated,
    showAuthLinks: !isAuthenticated,
    primaryItems: getPrimaryNavItems(isAdmin),
  }
}
