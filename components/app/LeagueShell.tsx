"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { ReactNode } from "react"
import LeagueTabNav, { type LeagueShellTab } from "@/components/app/LeagueTabNav"

export default function LeagueShell({
  leagueName,
  initialTab,
  renderTab,
  tabs,
  leagueModeLabel,
}: {
  leagueName: string
  initialTab?: LeagueShellTab
  renderTab: (tab: LeagueShellTab) => ReactNode
  tabs?: LeagueShellTab[]
  /** e.g. "Redraft" or "Dynasty" so users can tell league type at a glance */
  leagueModeLabel?: string
}) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<LeagueShellTab>(initialTab || "Overview")

  // Sync active tab when URL deep-link changes (e.g. user clicked Trust & legacy → Settings)
  useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  const handleTabChange = useCallback(
    (tab: LeagueShellTab) => {
      setActiveTab(tab)
      const path = pathname ?? ""
      const query = new URLSearchParams(searchParams?.toString() ?? "")
      query.set("tab", tab)
      router.replace(`${path}?${query.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 space-y-4">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{leagueName}</h1>
          {leagueModeLabel && (
            <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-xs font-medium text-cyan-200" title={`League type: ${leagueModeLabel}`}>
              {leagueModeLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-white/60">Sleeper-style league shell with tabbed workflows and shared Chimmy context.</p>
      </section>
      <LeagueTabNav activeTab={activeTab} onChange={handleTabChange} tabs={tabs} />
      {renderTab(activeTab)}
    </main>
  )
}


