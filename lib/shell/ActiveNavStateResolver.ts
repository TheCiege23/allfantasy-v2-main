import type { ProductId } from "./ShellRouteResolver"
import {
  PRIMARY_NAV_ITEMS,
  PRODUCT_NAV_ITEMS,
  type NavLinkItem,
} from "@/lib/navigation/NavLinkResolver"

export interface NavItem {
  href: string
  label: string
}

function toNavItems(items: NavLinkItem[]): NavItem[] {
  return items.map((item) => ({ href: item.href, label: item.label }))
}

/** Primary nav items for shell (tabs + mobile drawer). */
export const SHELL_NAV_ITEMS: NavItem[] = toNavItems(PRIMARY_NAV_ITEMS)

export const PRODUCT_SWITCHER_ITEMS: NavItem[] = toNavItems(PRODUCT_NAV_ITEMS)

/**
 * Returns whether the given pathname matches href (exact or prefix).
 */
export function isNavItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (pathname === href) return true
  if (href === "/dashboard" && pathname === "/") return false
  if (href === "/dashboard") {
    return (
      pathname === "/dashboard" ||
      pathname.startsWith("/dashboard/") ||
      pathname === "/leagues" ||
      pathname.startsWith("/leagues/") ||
      pathname.startsWith("/league/") ||
      pathname.startsWith("/import")
    )
  }
  if (href === "/discover/leagues") {
    return (
      pathname === "/discover/leagues" ||
      pathname.startsWith("/discover/") ||
      pathname.startsWith("/sports/") ||
      pathname === "/leagues" ||
      pathname.startsWith("/leagues/")
    )
  }
  if (href === "/tools-hub") return pathname === "/tools-hub" || pathname.startsWith("/tools/")
  if (href === "/af-legacy") {
    return pathname === "/af-legacy" || pathname.startsWith("/af-legacy/") || pathname === "/legacy" || pathname.startsWith("/legacy/")
  }
  return pathname.startsWith(`${href}/`)
}

/**
 * Resolves which nav item is active for the current pathname.
 */
export function getActiveNavHref(pathname: string | null): string | null {
  if (!pathname) return null
  for (const item of SHELL_NAV_ITEMS) {
    if (isNavItemActive(pathname, item.href)) return item.href
  }
  if (pathname.startsWith("/admin")) return "/admin"
  if (pathname.startsWith("/tools-hub") || pathname.startsWith("/tools/")) return "/tools-hub"
  return null
}

export type { ProductId }
