"use client"

import { useEffect, useRef } from "react"
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
  const drawerRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((node) => node.getClientRects().length > 0)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener("keydown", onKeyDown)
      const restoreTarget = restoreFocusRef.current
      if (restoreTarget?.isConnected) {
        window.requestAnimationFrame(() => restoreTarget.focus())
      }
    }
  }, [open, onClose])

  if (!open) return null

  const productLinks = [
    { href: "/discover/leagues", label: "Leagues" },
    ...SHELL_NAV_ITEMS.filter((item) =>
      ["/dashboard", "/war-room", "/ai/tools"].includes(item.href)
    ),
  ]
  const workspaceLinks = SHELL_NAV_ITEMS.filter((item) =>
    ["/messages", "/wallet"].includes(item.href)
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
        ref={drawerRef}
        className="fixed right-0 top-0 z-[51] h-[100dvh] w-[min(100vw,22rem)] border-l shadow-xl transition-transform lg:hidden"
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
          <div className="flex items-center justify-between border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]" style={{ borderColor: "var(--border)" }}>
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Menu</span>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-lg border"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-4 overscroll-contain overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Quick actions
              </p>
              <div className="space-y-1">
                <Link
                  href="/messages"
                  onClick={onClose}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition"
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
                  className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition"
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
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition"
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
                      className="flex min-h-11 items-center rounded-lg px-3 py-2.5 text-sm font-medium transition"
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
                      className="flex min-h-11 items-center rounded-lg px-3 py-2.5 text-sm font-medium transition"
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
                      className="flex min-h-11 items-center rounded-lg px-3 py-2.5 text-sm font-medium transition"
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
                className="flex min-h-11 items-center rounded-lg px-3 py-2.5 text-sm font-medium transition"
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
