"use client"

import Link from "next/link"
import { useRef, useState, useEffect } from "react"
import { signOutAndPurge } from "@/lib/pwa/signOutAndPurge"
import { ChevronDown, User, Settings as SettingsIcon, LogOut } from "lucide-react"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"
import { USER_MENU_ITEMS } from "@/lib/navigation"

export interface UserMenuDropdownProps {
  userLabel?: string | null
  /** Optional class for the trigger button. */
  className?: string
  /** When true, use compact trigger (icon only). */
  compact?: boolean
}

export function UserMenuDropdown({ userLabel, className = "", compact = false }: UserMenuDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { profile } = useSettingsProfile()
  const username = userLabel ?? profile?.username ?? "User"
  const menuId = "global-user-menu-dropdown"

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 min-w-0 max-w-[160px] transition ${className}`}
        style={{
          borderColor: "var(--border)",
          background: open ? "color-mix(in srgb, var(--panel2) 95%, transparent)" : "color-mix(in srgb, var(--panel2) 82%, transparent)",
          color: "var(--text)",
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        aria-label="User menu"
      >
        <IdentityImageRenderer
          avatarUrl={profile?.profileImageUrl}
          avatarPreset={profile?.avatarPreset}
          displayName={profile?.displayName}
          username={username}
          size="sm"
        />
        {!compact && (
          <span className="truncate text-xs font-medium" style={{ color: "var(--muted)" }}>
            {username}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" style={{ color: "var(--muted)" }} />
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-lg border py-1 shadow-lg"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          role="menu"
        >
          {USER_MENU_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition"
              style={{ color: "var(--text)" }}
            >
              {item.label === "Profile" && <User className="h-4 w-4" style={{ color: "var(--muted)" }} />}
              {item.label === "Settings" && <SettingsIcon className="h-4 w-4" style={{ color: "var(--muted)" }} />}
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void signOutAndPurge({ callbackUrl: "/" })
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm transition"
            style={{ color: "var(--text)" }}
          >
            <LogOut className="h-4 w-4" style={{ color: "var(--muted)" }} />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
