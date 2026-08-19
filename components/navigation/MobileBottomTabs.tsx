"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, Swords, Sparkles, User } from "lucide-react"
import { isNavItemActive } from "@/lib/shell"

type BottomTab = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const MOBILE_BOTTOM_TABS: BottomTab[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/discover/leagues", label: "Leagues", icon: Users },
  { href: "/war-room", label: "AF Legacy", icon: Swords },
  { href: "/ai-chat", label: "Chimmy", icon: Sparkles },
  { href: "/profile", label: "Profile", icon: User },
]

const LEAGUES_ACTIVE_PREFIXES = [
  "/discover/",
  "/leagues/",
  "/league/",
  "/sports/",
  "/fantasy-football",
  "/fantasy-basketball",
  "/fantasy-baseball",
  "/fantasy-hockey",
  "/fantasy-soccer",
  "/fantasy-ncaa",
]

const WAR_ROOM_ACTIVE_PREFIXES = [
  "/war-room",
  "/draft/room",
  "/mock-draft",
]

export default function MobileBottomTabs() {
  const pathname = usePathname()
  const currentPath = pathname ?? ""

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--panel) 92%, transparent)",
      }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {MOBILE_BOTTOM_TABS.map((item) => {
          const active =
            item.label === "Leagues"
              ? isNavItemActive(currentPath, item.href) || LEAGUES_ACTIVE_PREFIXES.some((p) => currentPath.startsWith(p))
              : item.label === "AF Legacy"
              ? isNavItemActive(currentPath, item.href) || WAR_ROOM_ACTIVE_PREFIXES.some((p) => currentPath.startsWith(p))
              : isNavItemActive(currentPath, item.href)
          const Icon = item.icon
          const isWarRoom = item.label === "AF Legacy"
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex flex-col items-center justify-center rounded-xl px-1 py-2 text-[10px] font-semibold transition duration-150 active:scale-95"
              aria-current={active ? "page" : undefined}
              style={{
                background: active
                  ? isWarRoom
                    ? "color-mix(in srgb, var(--accent-cyan) 20%, transparent)"
                    : "color-mix(in srgb, var(--accent-cyan) 16%, transparent)"
                  : "transparent",
                color: active
                  ? "var(--accent-cyan-strong)"
                  : isWarRoom
                  ? "var(--muted)"
                  : "var(--muted2)",
              }}
            >
              <span
                className={[
                  "absolute left-1/2 top-1 h-0.5 w-6 -translate-x-1/2 rounded-full transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                ].join(" ")}
                style={{ background: "var(--accent-cyan-strong)" }}
                aria-hidden="true"
              />
              <Icon className="mb-1 h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
