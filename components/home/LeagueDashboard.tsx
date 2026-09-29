"use client"

import { useMemo, useState } from "react"
import { Crown, Star, Users as UsersIcon, ChevronDown, ChevronUp } from "lucide-react"
import { ProjectionDisplay } from "@/components/weather/ProjectionDisplay"

type SportKey = "NFL" | "NBA" | "MLB"

type LeagueCard = {
  id: string
  name: string
  sport: SportKey
  type: string // e.g. "Dynasty", "Redraft"
  teamName: string
  record: string // "10-3"
  projectedPoints: number
  teamCount: number
  paid: boolean
  defendingChampion: boolean
  favorite?: boolean
}

type TabId = "my" | "join" | "orphan"

const MOCK_LEAGUES: LeagueCard[] = [
  {
    id: "nfl-1",
    name: "AllFantasy Dynasty 1",
    sport: "NFL",
    type: "Dynasty",
    teamName: "CMC Enthusiasts",
    record: "9-3",
    projectedPoints: 145.2,
    teamCount: 12,
    paid: true,
    defendingChampion: true,
    favorite: true,
  },
  {
    id: "nfl-2",
    name: "AllFantasy Home League",
    sport: "NFL",
    type: "Redraft",
    teamName: "Zero RB Truthers",
    record: "6-6",
    projectedPoints: 132.7,
    teamCount: 10,
    paid: false,
    defendingChampion: false,
  },
  {
    id: "nba-1",
    name: "AllFantasy Hoops",
    sport: "NBA",
    type: "Points",
    teamName: "Jokic & Chill",
    record: "14-5",
    projectedPoints: 182.1,
    teamCount: 10,
    paid: true,
    defendingChampion: false,
  },
  {
    id: "mlb-1",
    name: "AllFantasy Baseball",
    sport: "MLB",
    type: "Roto",
    teamName: "Barrels Only",
    record: "18-9",
    projectedPoints: 98.4,
    teamCount: 12,
    paid: false,
    defendingChampion: false,
  },
]

export default function LeagueDashboard() {
  const [tab, setTab] = useState<TabId>("my")
  const [leagues, setLeagues] = useState<LeagueCard[]>(MOCK_LEAGUES)
  const [collapsedSports, setCollapsedSports] = useState<Set<SportKey>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const groups: Record<SportKey, LeagueCard[]> = { NFL: [], NBA: [], MLB: [] }
    for (const lg of leagues) {
      groups[lg.sport].push(lg)
    }
    return groups
  }, [leagues])

  function toggleSportCollapse(sport: SportKey) {
    setCollapsedSports((prev) => {
      const next = new Set(prev)
      if (next.has(sport)) next.delete(sport)
      else next.add(sport)
      return next
    })
  }

  function onFavoriteToggle(id: string) {
    setLeagues((prev) =>
      prev.map((lg) => (lg.id === id ? { ...lg, favorite: !lg.favorite } : lg)),
    )
  }

  function handleDragStart(id: string) {
    setDragId(id)
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    setLeagues((prev) => {
      const items = [...prev]
      const fromIndex = items.findIndex((l) => l.id === dragId)
      const toIndex = items.findIndex((l) => l.id === targetId)
      if (fromIndex === -1 || toIndex === -1) return prev
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return items
    })
    setDragId(null)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  const tabDescription =
    tab === "my"
      ? "Leagues you currently manage or play in across AllFantasy."
      : tab === "join"
      ? "Public or invite‑only leagues you can join. Placeholder content for now."
      : "Teams in need of a manager. Placeholder content for now."

  return (
    <section className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setTab("my")}
              className={`rounded-full px-3 py-1.5 font-semibold ${
                tab === "my" ? "text-black" : ""
              }`}
              style={{
                background:
                  tab === "my"
                    ? "linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))"
                    : "color-mix(in srgb, var(--panel2) 82%, transparent)",
                color: tab === "my" ? "var(--on-accent-bg)" : "var(--muted2)",
              }}
            >
              My Leagues
            </button>
            <button
              type="button"
              onClick={() => setTab("join")}
              className={`rounded-full px-3 py-1.5 font-semibold ${
                tab === "join" ? "text-black" : ""
              }`}
              style={{
                background:
                  tab === "join"
                    ? "linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan))"
                    : "color-mix(in srgb, var(--panel2) 82%, transparent)",
                color: tab === "join" ? "var(--on-accent-bg)" : "var(--muted2)",
              }}
            >
              Join Leagues
            </button>
            <button
              type="button"
              onClick={() => setTab("orphan")}
              className={`rounded-full px-3 py-1.5 font-semibold ${
                tab === "orphan" ? "text-black" : ""
              }`}
              style={{
                background:
                  tab === "orphan"
                    ? "linear-gradient(135deg, var(--accent-amber), var(--accent-purple))"
                    : "color-mix(in srgb, var(--panel2) 82%, transparent)",
                color: tab === "orphan" ? "var(--on-accent-bg)" : "var(--muted2)",
              }}
            >
              Orphan Teams
            </button>
          </div>
          <p className="text-[11px] sm:text-xs" style={{ color: "var(--muted)" }}>
            {tabDescription}
          </p>
        </div>

        {/* Only render detailed cards for "My Leagues" for now */}
        {tab === "my" ? (
          <div className="space-y-4">
            {(["NFL", "NBA", "MLB"] as SportKey[]).map((sport) => {
              const list = grouped[sport]
              if (!list.length) return null
              const collapsed = collapsedSports.has(sport)
              return (
                <div key={sport} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => toggleSportCollapse(sport)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{
                      background: "color-mix(in srgb, var(--panel2) 88%, transparent)",
                      color: "var(--text)",
                    }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-semibold"
                        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
                      >
                        {sport}
                      </span>
                      <span>{sport === "NFL" ? "Football" : sport === "NBA" ? "Basketball" : "Baseball"}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--muted2)" }}>
                      {list.length} league{list.length > 1 ? "s" : ""}
                      {collapsed ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronUp className="h-3 w-3" />
                      )}
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((league) => (
                        <div
                          key={league.id}
                          draggable
                          onDragStart={() => handleDragStart(league.id)}
                          onDragOver={handleDragOver}
                          onDrop={() => handleDrop(league.id)}
                          className="cursor-move rounded-2xl border p-3 text-xs"
                          style={{
                            borderColor: "color-mix(in srgb, var(--border) 80%, transparent)",
                            background: "color-mix(in srgb, var(--panel) 90%, transparent)",
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div
                                className="truncate text-sm font-semibold"
                                style={{ color: "var(--text)" }}
                              >
                                {league.name}
                              </div>
                              <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted2)" }}>
                                {league.type} • {league.sport}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {league.defendingChampion && (
                                <span
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px]"
                                  title="Defending champion"
                                  style={{
                                    borderColor: "color-mix(in srgb, var(--accent-amber) 60%, var(--border))",
                                    background:
                                      "color-mix(in srgb, var(--accent-amber) 12%, transparent)",
                                    color: "var(--accent-amber-strong)",
                                  }}
                                >
                                  <Crown className="h-3.5 w-3.5" />
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => onFavoriteToggle(league.id)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px]"
                                title={league.favorite ? "Unfavorite" : "Mark as favorite"}
                                style={{
                                  borderColor: league.favorite
                                    ? "color-mix(in srgb, var(--accent-cyan) 60%, var(--border))"
                                    : "var(--border)",
                                  background: league.favorite
                                    ? "color-mix(in srgb, var(--accent-cyan) 15%, transparent)"
                                    : "color-mix(in srgb, var(--panel2) 88%, transparent)",
                                  color: league.favorite ? "var(--accent-cyan-strong)" : "var(--muted2)",
                                }}
                              >
                                <Star className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--muted2)" }}>
                                Team
                              </div>
                              <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--text)" }}>
                                {league.teamName}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--muted2)" }}>
                                Record
                              </div>
                              <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--text)" }}>
                                {league.record}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--muted2)" }}>
                                Projected
                              </div>
                              <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--text)" }}>
                                <ProjectionDisplay
                                  projection={league.projectedPoints}
                                  suffix="pts"
                                  showAFCrest={false}
                                  pointsClassName="text-xs font-medium"
                                />
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--muted2)" }}>
                                Teams
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-xs font-medium" style={{ color: "var(--text)" }}>
                                <UsersIcon className="h-3.5 w-3.5" />
                                <span>{league.teamCount}</span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <div className="inline-flex items-center gap-1">
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
                                title={league.paid ? "Paid league" : "Free league"}
                                style={{
                                  background: league.paid
                                    ? "color-mix(in srgb, var(--accent-red) 18%, transparent)"
                                    : "color-mix(in srgb, var(--accent-emerald) 20%, transparent)",
                                  color: league.paid
                                    ? "var(--accent-red-strong)"
                                    : "var(--accent-emerald-strong)",
                                }}
                              >
                                {league.paid ? "P" : "F"}
                              </span>
                              <span style={{ color: "var(--muted2)" }}>
                                {league.paid ? "Paid" : "Free"} league
                              </span>
                            </div>
                            <span style={{ color: "var(--muted2)" }}>Drag to reorder</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div
            className="rounded-2xl border px-4 py-5 text-xs sm:text-sm"
            style={{
              borderColor: "var(--border)",
              background: "color-mix(in srgb, var(--panel2) 84%, transparent)",
              color: "var(--muted)",
            }}
          >
            Placeholder content for the “{tab === "join" ? "Join Leagues" : "Orphan Teams"}” tab. This area
            will later surface discoverable leagues and orphan teams based on your connected providers.
          </div>
        )}
      </div>
    </section>
  )
}

