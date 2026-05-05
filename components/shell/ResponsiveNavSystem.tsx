"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppHeader } from "./AppHeader"
import MobileBottomTabs from "@/components/navigation/MobileBottomTabs"
import { MobileNavDrawer } from "./MobileNavDrawer"
import { SearchOverlay } from "@/components/search/SearchOverlay"
import { ChimmyFloatingActionButton } from "@/components/chimmy-surfaces"
import { createCommandPaletteHandler } from "@/lib/search"
import { shouldHideChimmyFloatingFab } from "@/lib/shell/draftRoomFloatingUi"

const LG_BREAKPOINT_PX = 1024
const USER_NOTIFICATIONS_UNREAD = "/api/user/notifications?unread=true&limit=50"
const CHIMMY_SHORTCUTS_DISABLED_KEY = "af_chimmy_shortcuts_disabled"
const CHIMMY_SHORTCUT_HINT_SEEN_KEY = "af_chimmy_shortcut_hint_seen"

type UnreadNotificationsResponse = {
  notifications?: Array<{ type?: string | null }>
}

function extractLeagueIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/(?:app\/)?league\/(?<id>[^/]+)/i)
  return match?.groups?.id ? decodeURIComponent(match.groups.id) : null
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || tag === "select"
}

function isAiNotificationType(value: string | null | undefined): boolean {
  if (!value) return false
  const type = value.toLowerCase()
  return (
    type.startsWith("ai_") ||
    type.startsWith("ai:") ||
    type.startsWith("chimmy_") ||
    type.startsWith("chimmy:") ||
    type.includes("chimmy") ||
    type.includes("ai_commissioner") ||
    type.includes("ai_insight") ||
    type.includes("ai_check_in")
  )
}

export interface ResponsiveNavSystemProps {
  isAuthenticated: boolean
  isAdmin: boolean
  userLabel: string | null
  children: React.ReactNode
  /** Dashboard cleanup — hide the global desktop top nav + mobile bottom tabs on this route. */
  hideHeader?: boolean
}

/**
 * Responsive navigation: desktop bar + mobile drawer + search overlay. Closes drawer when viewport
 * resizes to lg (desktop) so state does not get stuck.
 */
export function ResponsiveNavSystem({
  isAuthenticated,
  isAdmin,
  userLabel,
  children,
  hideHeader = false,
}: ResponsiveNavSystemProps) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileTopNavHidden, setMobileTopNavHidden] = useState(false)
  const [isCommissionerInLeague, setIsCommissionerInLeague] = useState(false)
  const [hasUnreadAiAlerts, setHasUnreadAiAlerts] = useState(false)
  const [chimmyShortcutsEnabled, setChimmyShortcutsEnabled] = useState(true)
  const [showShortcutHint, setShowShortcutHint] = useState(false)

  const leagueId = extractLeagueIdFromPath(pathname)
  const hideChimmyFabOnDraftSurface = shouldHideChimmyFloatingFab(pathname)

  const openChimmy = useCallback(() => {
    try {
      window.localStorage.setItem(CHIMMY_SHORTCUT_HINT_SEEN_KEY, "1")
    } catch {
      // Ignore storage failures.
    }
    setShowShortcutHint(false)

    if (isAdmin) {
      router.push("/admin")
      return
    }

    if (leagueId && isCommissionerInLeague) {
      router.push(`/league/${leagueId}/commissioner/integrity`)
      return
    }

    router.push("/ai-chat")
  }, [isAdmin, router, leagueId, isCommissionerInLeague])

  useEffect(() => {
    if (!isAuthenticated) {
      setChimmyShortcutsEnabled(true)
      setShowShortcutHint(false)
      return
    }

    const syncShortcutState = () => {
      try {
        const shortcutsDisabled = window.localStorage.getItem(CHIMMY_SHORTCUTS_DISABLED_KEY) === "1"
        const hintSeen = window.localStorage.getItem(CHIMMY_SHORTCUT_HINT_SEEN_KEY) === "1"
        setChimmyShortcutsEnabled(!shortcutsDisabled)
        setShowShortcutHint(!shortcutsDisabled && !hintSeen)
      } catch {
        setChimmyShortcutsEnabled(true)
        setShowShortcutHint(false)
      }
    }

    syncShortcutState()

    const onStorage = (event: StorageEvent) => {
      if (event.key === CHIMMY_SHORTCUTS_DISABLED_KEY) {
        setChimmyShortcutsEnabled(event.newValue !== "1")
      }
      if (event.key === CHIMMY_SHORTCUT_HINT_SEEN_KEY) {
        setShowShortcutHint(event.newValue !== "1")
      }
    }

    const onSameTabShortcutChange = () => {
      syncShortcutState()
    }

    window.addEventListener("storage", onStorage)
    window.addEventListener("af:chimmy-shortcuts-changed", onSameTabShortcutChange)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("af:chimmy-shortcuts-changed", onSameTabShortcutChange)
    }
  }, [isAuthenticated])

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT_PX}px)`)
    const handle = () => {
      if (mql.matches) {
        setMobileMenuOpen(false)
        setMobileTopNavHidden(false)
      }
    }
    mql.addEventListener("change", handle)
    return () => mql.removeEventListener("change", handle)
  }, [])

  useEffect(() => {
    const handler = createCommandPaletteHandler(() => {
      setMobileMenuOpen(false)
      setSearchOpen(true)
    })
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !leagueId) {
      setIsCommissionerInLeague(false)
      return
    }

    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/check`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as { isCommissioner?: unknown }
        if (active) setIsCommissionerInLeague(Boolean(json?.isCommissioner))
      } catch {
        if (active) setIsCommissionerInLeague(false)
      }
    })()

    return () => {
      active = false
    }
  }, [isAuthenticated, leagueId])

  useEffect(() => {
    if (!isAuthenticated) {
      setHasUnreadAiAlerts(false)
      return
    }

    let active = true
    const pollUnreadAiAlerts = async () => {
      try {
        const res = await fetch(USER_NOTIFICATIONS_UNREAD, {
          cache: "no-store",
          credentials: "include",
        })
        if (!res.ok) {
          if (active) setHasUnreadAiAlerts(false)
          return
        }
        const data = (await res.json().catch(() => ({}))) as UnreadNotificationsResponse
        const hasAi = Boolean(data.notifications?.some((n) => isAiNotificationType(n?.type)))
        if (active) setHasUnreadAiAlerts(hasAi)
      } catch {
        if (active) setHasUnreadAiAlerts(false)
      }
    }

    void pollUnreadAiAlerts()
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void pollUnreadAiAlerts()
    }, 60_000)

    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !chimmyShortcutsEnabled) return

    const onShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      const slashShortcut = key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey
      const commandShortcut = key === "k" && (event.metaKey || event.ctrlKey) && event.shiftKey
      if (!slashShortcut && !commandShortcut) return

      event.preventDefault()
      setMobileMenuOpen(false)
      setSearchOpen(false)
      openChimmy()
    }

    window.addEventListener("keydown", onShortcut)
    return () => window.removeEventListener("keydown", onShortcut)
  }, [isAuthenticated, chimmyShortcutsEnabled, openChimmy])

  useEffect(() => {
    if (!mobileMenuOpen && !searchOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileMenuOpen, searchOpen])

  useEffect(() => {
    let lastY = window.scrollY
    let ticking = false

    const onScroll = () => {
      if (window.innerWidth >= LG_BREAKPOINT_PX) {
        if (mobileTopNavHidden) setMobileTopNavHidden(false)
        return
      }
      if (mobileMenuOpen || searchOpen) {
        if (mobileTopNavHidden) setMobileTopNavHidden(false)
        lastY = window.scrollY
        return
      }
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        const currentY = window.scrollY
        const delta = currentY - lastY
        if (currentY <= 8 || delta < -6) {
          setMobileTopNavHidden(false)
        } else if (delta > 10) {
          setMobileTopNavHidden(true)
        }
        lastY = currentY
        ticking = false
      })
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [mobileMenuOpen, searchOpen, mobileTopNavHidden])

  return (
    <>
      {hideHeader ? null : (
        <div className={mobileTopNavHidden ? "-translate-y-full transition-transform duration-200 lg:translate-y-0" : "translate-y-0 transition-transform duration-200"}>
          <AppHeader
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            userLabel={userLabel}
            mobileMenuOpen={mobileMenuOpen}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </div>
      )}
      <MobileNavDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isAdmin={isAdmin}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className={isAuthenticated ? "pb-20 lg:pb-0" : undefined}>{children}</div>
      {isAuthenticated ? (
        <>
          {showShortcutHint ? (
            <div className="fixed bottom-[8.2rem] right-4 z-40 w-[13.5rem] rounded-lg border border-white/15 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-2xl lg:bottom-20 lg:right-6">
              <p className="font-semibold text-white/90">Chimmy shortcuts</p>
              <p className="mt-1 text-white/70">Press <span className="rounded border border-white/20 px-1 py-0.5">/</span> or <span className="rounded border border-white/20 px-1 py-0.5">Ctrl/Cmd+Shift+K</span></p>
              <button
                type="button"
                onClick={() => {
                  setShowShortcutHint(false)
                  try {
                    window.localStorage.setItem(CHIMMY_SHORTCUT_HINT_SEEN_KEY, "1")
                  } catch {
                    // Ignore storage failures.
                  }
                }}
                className="mt-2 text-[11px] font-medium text-cyan-300 hover:text-cyan-200"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {!hideChimmyFabOnDraftSurface ? (
          <ChimmyFloatingActionButton
            label={isAdmin ? "Open Admin AI" : isCommissionerInLeague ? "Open Commissioner Chimmy" : "Open Chimmy"}
            hasNotification={hasUnreadAiAlerts}
            onClick={openChimmy}
            positionClass="fixed bottom-24 right-4 z-40 lg:bottom-6 lg:right-6"
            className="shadow-2xl"
          />
          ) : null}
        </>
      ) : null}
      {isAuthenticated && !hideHeader ? <MobileBottomTabs /> : null}
    </>
  )
}
