"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { X, Users as UsersIcon, Search, ChevronDown } from "lucide-react"

type SportKey = "NFL" | "NBA" | "MLB"

type PlayerStatus = "healthy" | "questionable" | "injured" | "out" | "ir"

type PlayerRow = {
  id: string
  name: string
  team: string
  position: string
  status: PlayerStatus
  sport: SportKey
  leagueId: string
  leagueName: string
  rosterId: string
}

const MOCK_PLAYERS: PlayerRow[] = [
  {
    id: "p1",
    name: "Christian McCaffrey",
    team: "SF",
    position: "RB",
    status: "healthy",
    sport: "NFL",
    leagueId: "nfl-1",
    leagueName: "AllFantasy Dynasty 1",
    rosterId: "team-cmc",
  },
  {
    id: "p2",
    name: "Joe Burrow",
    team: "CIN",
    position: "QB",
    status: "questionable",
    sport: "NFL",
    leagueId: "nfl-1",
    leagueName: "AllFantasy Dynasty 1",
    rosterId: "team-cmc",
  },
  {
    id: "p3",
    name: "Nikola Jokic",
    team: "DEN",
    position: "C",
    status: "healthy",
    sport: "NBA",
    leagueId: "nba-1",
    leagueName: "AllFantasy Hoops",
    rosterId: "team-jokic",
  },
  {
    id: "p4",
    name: "LeBron James",
    team: "LAL",
    position: "SF",
    status: "questionable",
    sport: "NBA",
    leagueId: "nba-1",
    leagueName: "AllFantasy Hoops",
    rosterId: "team-jokic",
  },
  {
    id: "p5",
    name: "Shohei Ohtani",
    team: "LAD",
    position: "UT",
    status: "healthy",
    sport: "MLB",
    leagueId: "mlb-1",
    leagueName: "AllFantasy Baseball",
    rosterId: "team-ohtani",
  },
  {
    id: "p6",
    name: "Mike Trout",
    team: "LAA",
    position: "OF",
    status: "ir",
    sport: "MLB",
    leagueId: "mlb-1",
    leagueName: "AllFantasy Baseball",
    rosterId: "team-ohtani",
  },
]

const STATUS_LABEL: Record<PlayerStatus, string> = {
  healthy: "Healthy",
  questionable: "Questionable",
  injured: "Injured",
  out: "Out",
  ir: "IR",
}

export interface PlayerFinderPanelProps {
  open?: boolean
  onClose?: () => void
}

export default function PlayerFinderPanel({ open = false, onClose }: PlayerFinderPanelProps) {
  const [visible, setVisible] = useState(open)
  const [sport, setSport] = useState<SportKey>("NFL")
  const [query, setQuery] = useState("")

  const actuallyOpen = visible || open

  const filteredPlayers = useMemo(() => {
    return MOCK_PLAYERS.filter((p) => {
      if (p.sport !== sport) return false
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q) ||
        p.leagueName.toLowerCase().includes(q)
      )
    })
  }, [sport, query])

  const handleOpen = () => setVisible(true)
  const handleClose = () => {
    setVisible(false)
    onClose?.()
  }

  if (!actuallyOpen) {
    // Launcher button bottom-right
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--panel2) 90%, transparent)",
          color: "var(--text)",
        }}
      >
        <UsersIcon className="h-4 w-4" />
        Player Finder
      </button>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <aside
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md translate-x-0 shadow-xl transition-transform duration-200 sm:max-w-lg"
        style={{
          background: "color-mix(in srgb, var(--panel) 96%, transparent)",
          borderLeft: "1px solid var(--border)",
        }}
        aria-label="Player finder"
      >
        <header className="flex items-center justify-between border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border text-[11px] font-semibold"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            >
              PF
            </span>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Player Finder
              </h2>
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                View players across your AllFantasy rosters and jump into their leagues.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border text-xs"
            style={{
              borderColor: "var(--border)",
              background: "color-mix(in srgb, var(--panel2) 88%, transparent)",
              color: "var(--muted)",
            }}
            aria-label="Close player finder"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Controls */}
        <div className="border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-[11px] font-medium" style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--muted2)" }}>
              <span className="hidden sm:inline">Sport:</span>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value as SportKey)}
                className="bg-transparent text-xs outline-none"
              >
                <option value="NFL">NFL</option>
                <option value="NBA">NBA</option>
                <option value="MLB">MLB</option>
              </select>
              <ChevronDown className="h-3 w-3" />
            </div>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgba(148,163,184,0.9)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your players…"
                className="w-full rounded-full pl-9 pr-3 py-1.5 text-xs outline-none"
                style={{
                  background: "color-mix(in srgb, var(--panel2) 92%, transparent)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Player list */}
        <div className="flex h-[calc(100%-4.5rem)] flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 text-xs">
          {filteredPlayers.length === 0 ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              No players found for this sport. Connect leagues from the Sports App to populate your player list.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filteredPlayers.map((p) => (
                <li key={p.id}>
                  <div
                    className="group flex cursor-pointer items-start justify-between gap-2 rounded-xl border px-3 py-2 transition-colors"
                    style={{
                      borderColor: "var(--border)",
                      background: "color-mix(in srgb, var(--panel2) 90%, transparent)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div
                            className="truncate text-xs font-semibold"
                            style={{ color: "var(--text)" }}
                          >
                            {p.name}
                          </div>
                          <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted2)" }}>
                            {p.team} • {p.position} • {p.leagueName}
                          </div>
                        </div>
                        <StatusPill status={p.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                        <Link
                          href={`/league/${encodeURIComponent(p.leagueId)}`}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors"
                          style={{
                            borderColor: "var(--border)",
                            color: "var(--muted2)",
                            background: "color-mix(in srgb, var(--panel) 90%, transparent)",
                          }}
                        >
                          League
                        </Link>
                        <Link
                          href={`/app/league/${encodeURIComponent(p.leagueId)}/roster/${encodeURIComponent(
                            p.rosterId,
                          )}`}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors"
                          style={{
                            borderColor: "color-mix(in srgb, var(--accent-cyan) 60%, var(--border))",
                            color: "var(--accent-cyan-strong)",
                            background: "color-mix(in srgb, var(--accent-cyan) 10%, transparent)",
                          }}
                        >
                          Roster
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

function StatusPill({ status }: { status: PlayerStatus }) {
  let bg = "color-mix(in srgb, var(--panel2) 88%, transparent)"
  let color = "var(--muted2)"

  if (status === "healthy") {
    bg = "color-mix(in srgb, var(--accent-emerald) 18%, transparent)"
    color = "var(--accent-emerald-strong)"
  } else if (status === "questionable") {
    bg = "color-mix(in srgb, var(--accent-amber) 18%, transparent)"
    color = "var(--accent-amber-strong)"
  } else if (status === "injured" || status === "out" || status === "ir") {
    bg = "color-mix(in srgb, var(--accent-red) 18%, transparent)"
    color = "var(--accent-red-strong)"
  }

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: bg, color }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

