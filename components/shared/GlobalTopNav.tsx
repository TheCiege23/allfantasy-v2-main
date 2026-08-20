"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ChevronDown, MessageCircle, Shield, Sparkles, Menu, Search, Settings as SettingsIcon, Swords } from "lucide-react"
import { loginUrlWithIntent, signupUrlWithIntent } from "@/lib/auth/auth-intent-resolver"
import { ProductContextSwitcher } from "@/components/shell/ProductContextSwitcher"
import NotificationBell from "@/components/shared/NotificationBell"
import WalletSummaryBadge from "@/components/shared/WalletSummaryBadge"
import LanguageToggle from "@/components/i18n/LanguageToggle"
import { UserMenuDropdown } from "@/components/navigation/UserMenuDropdown"
import { getPrimaryNavGroups, type NavGroup } from "@/lib/navigation"
import { showAdminNav } from "@/lib/navigation"
import { isNavItemActive } from "@/lib/shell"
import { getPrimaryChimmyEntry } from "@/lib/ai-product-layer"
import { getCommandPaletteShortcut } from "@/lib/search"
import { getTopBarUtilities, type TopBarUtilitySpec } from "@/lib/notification-center"

type Props = {
  isAuthenticated: boolean
  isAdmin?: boolean
  userLabel?: string | null
  onOpenMobileMenu?: () => void
  onOpenSearch?: () => void
  mobileMenuOpen?: boolean
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

/**
 * Broadcast Deck nav fold: one pill per GROUP. Single-item groups are direct
 * links; multi-item groups open a dropdown. Active group wears the deck's
 * pink→orange gradient (same treatment as the league page's tab groups), and
 * every old flat-strip route survives inside a group.
 */
function NavGroupBar({ groups, currentPath }: { groups: NavGroup[]; currentPath: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click and on navigation.
  useEffect(() => {
    if (!openId) return
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenId(null)
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [openId])
  useEffect(() => {
    setOpenId(null)
  }, [currentPath])

  const isItemActive = (href: string) =>
    href === "/admin" ? currentPath.startsWith("/admin") : isNavItemActive(currentPath, href)

  return (
    <div ref={barRef} className="flex gap-1 overflow-x-auto pb-1">
      {groups.map((group) => {
        const groupActive = group.items.some((item) => isItemActive(item.href))
        const pillStyle = groupActive
          ? { background: "linear-gradient(90deg,#ff3d81,#ff8a3d)", color: "#fff" }
          : { background: "color-mix(in srgb, var(--panel2) 80%, transparent)", color: "var(--muted)" }
        const pillClass = cn(
          "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] transition sm:px-3 sm:text-xs",
          groupActive && "font-black italic uppercase tracking-wide",
        )

        if (group.items.length === 1) {
          const item = group.items[0]
          return (
            <Link
              key={group.id}
              href={item.href}
              className={pillClass}
              style={pillStyle}
              aria-current={groupActive ? "page" : undefined}
              data-testid={`global-nav-group-${group.id}`}
            >
              {group.label}
            </Link>
          )
        }

        const open = openId === group.id
        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : group.id)}
              className={cn(pillClass, "inline-flex items-center gap-1")}
              style={pillStyle}
              aria-expanded={open}
              aria-haspopup="menu"
              data-testid={`global-nav-group-${group.id}`}
            >
              {group.label}
              <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
              <div
                role="menu"
                className="absolute left-0 top-full z-50 mt-1 min-w-[13rem] overflow-hidden rounded-xl border shadow-2xl"
                style={{ background: "#12163e", borderColor: "#262c6a" }}
                data-testid={`global-nav-menu-${group.id}`}
              >
                {group.items.map((item) => {
                  const active = isItemActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpenId(null)}
                      className="block px-3.5 py-2.5 text-[12.5px] transition"
                      style={active
                        ? { color: "#ff9d5c", background: "rgba(255,255,255,0.05)", fontWeight: 800 }
                        : { color: "#c6cbf5" }}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default function GlobalTopNav({
  isAuthenticated,
  isAdmin = false,
  userLabel,
  onOpenMobileMenu,
  onOpenSearch,
  mobileMenuOpen = false,
}: Props) {
  const pathname = usePathname()
  const currentPath = pathname ?? ""
  const chimmyEntry = getPrimaryChimmyEntry({ source: "top_bar" })
  const primaryGroups = getPrimaryNavGroups(isAdmin)
  const shortcutLabel = getCommandPaletteShortcut()
  const utilitySpecs = getTopBarUtilities({
    isAuthenticated,
    isAdmin,
    hasSearch: Boolean(onOpenSearch),
  })

  function renderUtility(spec: TopBarUtilitySpec) {
    if (!isAuthenticated) return null
    if (spec.id === "search" && onOpenSearch) {
      return (
        <button
          key={spec.id}
          type="button"
          onClick={onOpenSearch}
          className="rounded-lg border p-2 transition"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel2) 82%, transparent)", color: "var(--muted)" }}
          title={`${spec.title} (${shortcutLabel})`}
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      )
    }
    if (spec.id === "wallet") {
      return <WalletSummaryBadge key={spec.id} />
    }
    if (spec.id === "messages") {
      return (
        <Link key={spec.id} href={spec.href ?? "/messages"} className="rounded-lg border p-2 transition" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel2) 82%, transparent)", color: "var(--text)" }} title={spec.title} aria-label={spec.title}>
          <MessageCircle className="h-4 w-4" />
        </Link>
      )
    }
    if (spec.id === "notifications") {
      return <NotificationBell key={spec.id} />
    }
    if (spec.id === "settings") {
      return (
        <Link
          key={spec.id}
          href={spec.href ?? "/settings"}
          className="rounded-lg border p-2 transition"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel2) 82%, transparent)", color: "var(--text)" }}
          title={spec.title}
          aria-label={spec.title}
          data-testid="topbar-settings-shortcut"
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      )
    }
    if (spec.id === "ai_chat") {
      return (
        <Link key={spec.id} href={spec.href ?? chimmyEntry.href} className="rounded-lg border p-2 transition hover:opacity-90" style={{ borderColor: "color-mix(in srgb, var(--accent-cyan) 45%, var(--border))", background: "color-mix(in srgb, var(--accent-cyan) 14%, transparent)", color: "var(--accent-cyan-strong)" }} title={spec.title} aria-label={spec.title}>
          <Sparkles className="h-4 w-4" />
        </Link>
      )
    }
    if (spec.id === "language") {
      return (
        <div key={spec.id} className="hidden sm:inline-flex">
          <LanguageToggle />
        </div>
      )
    }
    if (spec.id === "admin" && showAdminNav(isAdmin)) {
      return (
        <Link key={spec.id} href={spec.href ?? "/admin"} className="rounded-lg border p-2 transition hover:opacity-90" style={{ borderColor: "color-mix(in srgb, var(--accent-amber) 45%, var(--border))", background: "color-mix(in srgb, var(--accent-amber) 14%, transparent)", color: "var(--accent-amber-strong)" }} title={spec.title} aria-label={spec.title}>
          <Shield className="h-4 w-4" />
        </Link>
      )
    }
    if (spec.id === "profile") {
      return <UserMenuDropdown key={spec.id} userLabel={userLabel} />
    }
    return null
  }

  return (
    <header className="sticky top-0 z-40 border-b backdrop-blur-xl transition-colors mode-panel" style={{ background: "color-mix(in srgb, var(--panel) 88%, transparent)", borderColor: "var(--border)" }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="flex lg:hidden h-9 w-9 items-center justify-center rounded-lg border"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="global-mobile-nav-drawer"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <Link href={isAuthenticated ? "/dashboard" : "/"} className="flex shrink-0 items-center gap-2">
            <Image
              src="/af-crest.png"
              alt="AllFantasy crest"
              width={32}
              height={32}
              className="mode-logo-safe h-8 w-8 rounded-lg object-contain"
            />
            <span className="mode-wordmark-safe text-sm font-bold tracking-wide mode-text">AllFantasy.ai</span>
          </Link>

          <ProductContextSwitcher />

          <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:gap-2">
            {isAuthenticated ? (
              <>
                <Link
                  href="/war-room"
                  className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition hover:opacity-90 sm:inline-flex"
                  style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
                  aria-label="Open AF Legacy"
                >
                  <Swords className="h-3.5 w-3.5" />
                  AF Legacy
                </Link>
                {utilitySpecs.map((spec) => renderUtility(spec))}
              </>
            ) : (
              <>
                <Link href={loginUrlWithIntent(currentPath || "/dashboard")} className="rounded-lg border px-3 py-1.5 text-sm transition" style={{ borderColor: "var(--border)", color: "var(--text)", background: "color-mix(in srgb, var(--panel2) 82%, transparent)" }}>Login</Link>
                <Link href={signupUrlWithIntent(currentPath || "/dashboard")} className="rounded-lg px-3 py-1.5 text-sm font-semibold transition" style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}>Sign Up</Link>
              </>
            )}
          </div>
        </div>

        {isAuthenticated && <NavGroupBar groups={primaryGroups} currentPath={currentPath} />}
      </div>
    </header>
  )
}
