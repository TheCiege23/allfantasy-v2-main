"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { MessageCircle, Shield, Sparkles, Menu, Search, Settings as SettingsIcon, Swords } from "lucide-react"
import { loginUrlWithIntent, signupUrlWithIntent } from "@/lib/auth/auth-intent-resolver"
import { ProductContextSwitcher } from "@/components/shell/ProductContextSwitcher"
import NotificationBell from "@/components/shared/NotificationBell"
import WalletSummaryBadge from "@/components/shared/WalletSummaryBadge"
import LanguageToggle from "@/components/i18n/LanguageToggle"
import { UserMenuDropdown } from "@/components/navigation/UserMenuDropdown"
import { getPrimaryNavItems } from "@/lib/navigation"
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
  const primaryItems = getPrimaryNavItems(isAdmin)
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
                  aria-label="Open AF War Room"
                >
                  <Swords className="h-3.5 w-3.5" />
                  AF War Room
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

        {isAuthenticated && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {primaryItems.map((item) => {
            const active = item.href === "/admin" ? currentPath.startsWith("/admin") : isNavItemActive(currentPath, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] transition sm:px-3 sm:text-xs")}
                aria-current={active ? "page" : undefined}
                style={active
                  ? { background: "var(--text)", color: "var(--bg)" }
                  : { background: "color-mix(in srgb, var(--panel2) 80%, transparent)", color: "var(--muted)" }}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
        )}
      </div>
    </header>
  )
}
