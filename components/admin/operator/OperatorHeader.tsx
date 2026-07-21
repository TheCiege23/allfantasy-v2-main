"use client"
/**
 * Operator Command Center — top bar.
 *
 * Left: mobile nav toggle + environment badge.
 * Center: global search. Scoped honestly to what actually works today — user
 *   search — rather than pretending to search every entity type. Submitting
 *   routes to the Users section with the query.
 * Right: attention + notification deep-links (no fabricated counts) and the
 *   current operator's identity + exit.
 */
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Menu, Search, AlertTriangle, Bell, LogOut } from "lucide-react"
import { OPERATOR_BASE_PATH } from "@/lib/admin-dashboard/operatorNav"
import type { OperatorEnvironment } from "@/lib/admin-dashboard/operatorEnvironment"
import { EnvironmentBadge } from "@/components/admin/operator/EnvironmentBadge"

export type OperatorIdentity = {
  name: string | null
  email: string | null
  role: string | null
  source: "admin_session" | "app_session"
}

export function OperatorHeader({
  operator,
  environment,
  onToggleSidebar,
}: {
  operator: OperatorIdentity
  environment: OperatorEnvironment
  onToggleSidebar: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    router.push(`${OPERATOR_BASE_PATH}/users?q=${encodeURIComponent(q)}`)
  }

  const displayName = operator.name || operator.email || "Operator"
  const sourceLabel = operator.source === "admin_session" ? "Admin session" : "App session"

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-[#0a0e1a]/90 px-3 backdrop-blur-xl sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.05] lg:hidden"
        aria-label="Toggle navigation"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      <EnvironmentBadge environment={environment} className="hidden sm:inline-flex" />

      {/* Search */}
      <form onSubmit={onSubmit} className="relative mx-auto hidden w-full max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users by name or email…"
          aria-label="Search users by name or email"
          className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-9 pr-14 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-400/50"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <Link
          href={`${OPERATOR_BASE_PATH}/attention`}
          title="Attention queue"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.05]"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <span className="sr-only">Attention queue</span>
        </Link>
        <Link
          href={`${OPERATOR_BASE_PATH}/communications`}
          title="Communications & notifications"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.05]"
        >
          <Bell className="h-4 w-4" aria-hidden />
          <span className="sr-only">Communications</span>
        </Link>

        <div className="ml-1 hidden items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] py-1 pl-2.5 pr-1.5 sm:flex">
          <div className="leading-tight">
            <p className="max-w-[160px] truncate text-xs font-bold text-white">{displayName}</p>
            <p className="text-[10px] font-semibold text-slate-500">{sourceLabel}</p>
          </div>
          <Link
            href="/dashboard"
            title="Exit to app"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Exit to app</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
