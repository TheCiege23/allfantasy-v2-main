"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { usePathname } from "next/navigation"
import { Bell } from "lucide-react"
import { useNotifications } from "@/hooks/useNotifications"
import { NotificationPanelView } from "@/components/notifications/NotificationPanel"
import { getUnreadCount } from "@/lib/notification-center"
import { isNotificationDrawerCloseKey } from "@/lib/notification-center"
import { addStateRefreshListener } from "@/lib/state-consistency/state-events"
import { IconTooltip } from "@/components/shared/IconTooltip"

const USER_NOTIFICATIONS_UNREAD = "/api/user/notifications?unread=true&limit=1"

async function fetchUnreadTotal(): Promise<number> {
  const res = await fetch(USER_NOTIFICATIONS_UNREAD, {
    cache: "no-store",
    credentials: "include",
  })
  if (!res.ok) return 0
  const data = (await res.json().catch(() => ({}))) as {
    unreadTotal?: unknown
    unreadCount?: unknown
  }
  if (typeof data.unreadTotal === "number" && Number.isFinite(data.unreadTotal)) {
    return data.unreadTotal
  }
  if (typeof data.unreadCount === "number" && Number.isFinite(data.unreadCount)) {
    return data.unreadCount
  }
  return 0
}

export default function NotificationBell() {
  const pathname = usePathname() ?? ""
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const lastPathRef = useRef(pathname)
  const notificationsState = useNotifications(40, { usePlaceholders: false })
  const { notifications, refresh } = notificationsState
  const [serverUnreadCount, setServerUnreadCount] = useState<number | null>(null)
  const listUnread = getUnreadCount(notifications)
  const mergedUnread = serverUnreadCount != null ? Math.max(serverUnreadCount, listUnread) : listUnread
  const unreadBadge: number | string =
    mergedUnread <= 0 ? 0 : mergedUnread <= 9 ? mergedUnread : "9+"
  const panelId = "notification-center-drawer"

  const pollUnread = useCallback(async () => {
    try {
      const n = await fetchUnreadTotal()
      setServerUnreadCount(n)
    } catch {
      setServerUnreadCount((c) => c ?? 0)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void pollUnread().then(() => {
      if (cancelled) return
    })
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void pollUnread()
    }, 45_000)
    const unsub = addStateRefreshListener(["notifications", "all"], () => {
      void pollUnread()
    })
    return () => {
      cancelled = true
      clearInterval(id)
      unsub()
    }
  }, [pollUnread])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      )
        return
      setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (isNotificationDrawerCloseKey(e.key)) {
        e.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open])

  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      setOpen(false)
      lastPathRef.current = pathname
    }
  }, [pathname])

  const handleBellClick = () => {
    const next = !open
    setOpen(next)
    if (!next) return
    void (async () => {
      try {
        await fetch("/api/user/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ids: "all" }),
        })
        setServerUnreadCount(0)
        await refresh()
      } catch {
        /* still open panel */
      }
    })()
  }

  return (
    <div className="relative">
      <IconTooltip label="Notifications">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => void handleBellClick()}
          className="relative rounded-lg border p-2 transition"
          style={{
            borderColor: "var(--border)",
            background: open
              ? "color-mix(in srgb, var(--panel2) 95%, transparent)"
              : "color-mix(in srgb, var(--panel2) 82%, transparent)",
            color: "var(--text)",
          }}
          title="Notifications"
          aria-label="Notifications"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
        >
          <Bell className="h-4 w-4" />
          {unreadBadge !== 0 && (
            <span
              className="absolute -right-1 -top-1 inline-flex min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
              style={{
                background: "var(--accent-cyan-strong)",
                color: "var(--on-accent-bg)",
              }}
            >
              {String(unreadBadge)}
            </span>
          )}
        </button>
      </IconTooltip>
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-1.5"
          id={panelId}
          role="dialog"
          aria-label="Notification center"
        >
          <NotificationPanelView state={notificationsState} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
