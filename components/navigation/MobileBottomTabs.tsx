"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, MessageCircle, Trophy, User, Volleyball } from "lucide-react"
import { isNavItemActive } from "@/lib/shell"

type BottomTab = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const MOBILE_BOTTOM_TABS: BottomTab[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/discover/leagues", label: "Sports", icon: Volleyball },
  { href: "/brackets", label: "Bracket", icon: Trophy },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/profile", label: "Profile", icon: User },
]

const SPORTS_ACTIVE_PREFIXES = [
  "/discover/",
  "/sports/",
  "/fantasy-football",
  "/fantasy-basketball",
  "/fantasy-baseball",
  "/fantasy-hockey",
  "/fantasy-soccer",
  "/fantasy-ncaa",
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
              item.label === "Sports"
                ? isNavItemActive(currentPath, item.href) || SPORTS_ACTIVE_PREFIXES.some((prefix) => currentPath.startsWith(prefix))
                : isNavItemActive(currentPath, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex flex-col items-center justify-center rounded-xl px-1 py-2 text-[10px] font-semibold transition duration-150 active:scale-95"
              aria-current={active ? "page" : undefined}
              style={{
                background: active
                  ? "color-mix(in srgb, var(--accent-cyan) 16%, transparent)"
                  : "transparent",
                color: active ? "var(--accent-cyan-strong)" : "var(--muted2)",
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
