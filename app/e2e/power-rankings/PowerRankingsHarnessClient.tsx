"use client"

import { useEffect, useState } from "react"
import LeagueTabNav, { type LeagueShellTab } from "@/components/app/LeagueTabNav"
import { PowerRankingsPage } from "@/components/app/power-rankings/PowerRankingsPage"

const HARNESS_TABS: LeagueShellTab[] = ["Overview", "Rankings"]

export default function PowerRankingsHarnessClient() {
  const [tab, setTab] = useState<LeagueShellTab>("Rankings")
  const [hydrated, setHydrated] = useState(false)
  const leagueId = "league_rankings_1"

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <div className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Power Rankings Harness</h1>
        <p className="text-sm text-white/70">
          E2E harness for rankings tab and team card click audit.
        </p>
        <p className="text-xs text-white/50" data-testid="power-rankings-hydrated-flag">
          {hydrated ? "hydrated" : "hydrating"}
        </p>
        <LeagueTabNav activeTab={tab} onChange={setTab} tabs={HARNESS_TABS} />
        {tab === "Overview" ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-white/70">
            Overview placeholder
          </div>
        ) : (
          <PowerRankingsPage leagueId={leagueId} />
        )}
      </div>
    </div>
  )
}
