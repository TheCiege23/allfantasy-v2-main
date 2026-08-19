/**
 * Central configuration for navigation links used across desktop nav, mobile drawer, and product switcher.
 * Single source of truth for hrefs and labels.
 */

export interface NavLinkItem {
  href: string
  label: string
}

/** Primary nav items (tabs / drawer). Order determines display order. */
export const PRIMARY_NAV_ITEMS: NavLinkItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/commissioner-hub", label: "Commissioner Hub" },
  { href: "/manager-hub", label: "Manager Hub" },
  { href: "/war-room", label: "AF Legacy" },
  { href: "/discover/leagues", label: "Leagues" },
  { href: "/ai/tools", label: "Intelligence Hub" },
  { href: "/af-rankings", label: "Rankings" },
  { href: "/profile", label: "Profile" },
  { href: "/messages", label: "Messages" },
  { href: "/wallet", label: "Wallet" },
  { href: "/settings", label: "Settings" },
]

/** Product switcher items (compact product links in header). */
export const PRODUCT_NAV_ITEMS: NavLinkItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/war-room", label: "AF Legacy" },
  { href: "/ai/tools", label: "Intelligence Hub" },
]

/** User menu dropdown items (profile area). */
export const USER_MENU_ITEMS: NavLinkItem[] = [
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
]

/** Admin nav item (shown only when user is admin). */
export const ADMIN_NAV_ITEM: NavLinkItem = { href: "/admin", label: "Admin" }

/**
 * Broadcast Deck header consolidation: the 11-tab flat strip folds into four
 * groups (single-item groups render as a direct link; multi-item groups render
 * as dropdowns). Every PRIMARY_NAV_ITEMS route survives — this is presentation
 * only, mirroring the league page's Decide/Draft/Roster/League/Legacy fold.
 */
export interface NavGroup {
  id: string
  label: string
  items: NavLinkItem[]
}

export const PRIMARY_NAV_GROUPS: NavGroup[] = [
  { id: "home", label: "Home", items: [{ href: "/dashboard", label: "Home" }] },
  {
    id: "play",
    label: "Play",
    items: [
      // "My Leagues" (incl. every imported league) lives on the dashboard rail —
      // named here so imported leagues are one obvious click from anywhere.
      { href: "/dashboard", label: "My Leagues" },
      { href: "/discover/leagues", label: "Find Leagues" },
      { href: "/af-rankings", label: "Rankings" },
      { href: "/war-room", label: "AF Legacy" },
    ],
  },
  {
    id: "hubs",
    label: "Hubs",
    items: [
      { href: "/commissioner-hub", label: "Commissioner Hub" },
      { href: "/manager-hub", label: "Manager Hub" },
      { href: "/ai/tools", label: "Intelligence Hub" },
    ],
  },
  {
    id: "you",
    label: "You",
    items: [
      { href: "/profile", label: "Profile" },
      { href: "/messages", label: "Messages" },
      { href: "/wallet", label: "Wallet" },
      { href: "/settings", label: "Settings" },
    ],
  },
]

/** Grouped primary nav (optionally appends Admin as its own direct group). */
export function getPrimaryNavGroups(isAdmin: boolean): NavGroup[] {
  if (!isAdmin) return PRIMARY_NAV_GROUPS
  return [...PRIMARY_NAV_GROUPS, { id: "admin", label: "Admin", items: [ADMIN_NAV_ITEM] }]
}

/** Resolve primary nav items for display (optionally include admin when isAdmin). */
export function getPrimaryNavItems(isAdmin: boolean): NavLinkItem[] {
  if (!isAdmin) return PRIMARY_NAV_ITEMS
  return [...PRIMARY_NAV_ITEMS, ADMIN_NAV_ITEM]
}

/** Resolve product switcher items. */
export function getProductNavItems(): NavLinkItem[] {
  return PRODUCT_NAV_ITEMS
}
