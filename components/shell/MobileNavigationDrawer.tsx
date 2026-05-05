"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { X, Shield, Bell, Sparkles, Search } from "lucide-react"
import { SHELL_NAV_ITEMS, isNavItemActive } from "@/lib/shell"
import { showAdminNav } from "@/lib/navigation"
import { getPrimaryChimmyEntry } from "@/lib/ai-product-layer"
import LanguageToggle from "@/components/i18n/LanguageToggle"

export interface MobileNavigationDrawerProps {
  open: boolean
  onClose: () => void
  isAdmin?: boolean
  onOpenSearch?: () => void
}

export function MobileNavigationDrawer({
  open,
  onClose,
  isAdmin = false,
  onOpenSearch,
}: MobileNavigationDrawerProps) {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const chimmyEntry = getPrimaryChimmyEntry({ source: "top_bar" })

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const productLinks = [
    { href: "/discover/leagues", label: "Sports" },
    ...SHELL_NAV_ITEMS.filter((item) =>
      ["/dashboard", "/brackets", "/af-legacy"].includes(item.href)
    ),
  ]
  const workspaceLinks = SHELL_NAV_ITEMS.filter((item) =>
    ["/tools-hub", "/messages", "/wallet"].includes(item.href)
  )
  const accountLinks = SHELL_NAV_ITEMS.filter((item) =>
    ["/profile", "/settings"].includes(item.href)
  )

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 transition-opacity lg:hidden"
        data-testid="mobile-nav-overlay"
        aria-hidden
        onClick={onClose}
      />
      <aside
        className="fixed top-0 right-0 z-50 h-full w-[min(100vw-2rem,280px)] border-l shadow-xl transition-transform lg:hidden"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
        id="global-mobile-nav-drawer"
        data-testid="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Menu</span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-4">
            <div className="rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Quick actions
              </p>
              <div className="space-y-1">
                <Link
                  href="/messages"
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition"
                  aria-current={isNavItemActive(pathname, "/messages") ? "page" : undefined}
                  style={{
                    background: isNavItemActive(pathname, "/messages")
                      ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)"
                      : "transparent",
                    color: isNavItemActive(pathname, "/messages")
                      ? "var(--accent-cyan-strong)"
                      : "var(--text)",
                  }}
                >
                  <Bell className="h-4 w-4" />
                  Notifications
                </Link>
                <Link
                  href={chimmyEntry.href}
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition"
                  style={{ color: "var(--text)" }}
                >
                  <Sparkles className="h-4 w-4" />
                  {chimmyEntry.label}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenSearch) {
                      onClose()
                      onOpenSearch()
                      return
                    }
                    onClose()
                    router.push("/dashboard")
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition"
                  style={{ color: "var(--text)" }}
                >
                  <Search className="h-4 w-4" />
                  Search
                </button>
              </div>
            </div>

            <div>
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Products
              </p>
              <div className="space-y-1">
                {productLinks.map((item) => {
                  const active = isNavItemActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className="block rounded-lg px-3 py-2.5 text-sm font-medium transition"
                      style={{
                        background: active ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "transparent",
                        color: active ? "var(--accent-cyan-strong)" : "var(--text)",
                      }}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Workspace
              </p>
              <div className="space-y-1">
                {workspaceLinks.map((item) => {
                  const active = isNavItemActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className="block rounded-lg px-3 py-2.5 text-sm font-medium transition"
                      style={{
                        background: active ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "transparent",
                        color: active ? "var(--accent-cyan-strong)" : "var(--text)",
                      }}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Account
              </p>
              <div className="space-y-1">
                {accountLinks.map((item) => {
                  const active = isNavItemActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className="block rounded-lg px-3 py-2.5 text-sm font-medium transition"
                      style={{
                        background: active ? "color-mix(in srgb, var(--accent-cyan) 18%, transparent)" : "transparent",
                        color: active ? "var(--accent-cyan-strong)" : "var(--text)",
                      }}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>

            <div className="rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
              <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Appearance
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <LanguageToggle />
              </div>
            </div>

            {showAdminNav(isAdmin) && (
              <Link
                href="/admin"
                onClick={onClose}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium transition"
                aria-current={pathname?.startsWith("/admin") ? "page" : undefined}
                style={{
                  background: pathname?.startsWith("/admin") ? "color-mix(in srgb, var(--accent-amber) 18%, transparent)" : "transparent",
                  color: pathname?.startsWith("/admin") ? "var(--accent-amber-strong)" : "var(--text)",
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Admin
                </span>
              </Link>
            )}
          </nav>
        </div>
      </aside>
    </>
  )
}
