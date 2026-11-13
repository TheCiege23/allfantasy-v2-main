"use client"

export type LeagueShellTab =
  | "Overview"
  | "Team"
  | "Matchups"
  | "Roster"
  | "Players"
  | "Waivers"
  | "Trades"
  | "Draft"
  | "Standings / Playoffs"
  | "Rankings"
  | "Divisions"
  | "League"
  | "News"
  | "Hall of Fame"
  | "Legacy"
  | "Career"
  | "Awards"
  | "Record Books"
  | "Store"
  | "Advisor"
  | "Intelligence"
  | "Chat"
  | "Settings"
  | "Commissioner"
  | "Previous Leagues"

const LEAGUE_SHELL_TABS: LeagueShellTab[] = [
  "Overview",
  "Team",
  "Matchups",
  "Roster",
  "Players",
  "Waivers",
  "Trades",
  "Draft",
  "Standings / Playoffs",
  "Rankings",
  "Divisions",
  "League",
  "News",
  "Hall of Fame",
  "Legacy",
  "Career",
  "Awards",
  "Record Books",
  "Store",
  "Advisor",
  "Intelligence",
  "Chat",
  "Settings",
  "Previous Leagues",
]

export default function LeagueTabNav({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: LeagueShellTab
  onChange: (tab: LeagueShellTab) => void
  tabs?: LeagueShellTab[]
}) {
  const list = tabs ?? LEAGUE_SHELL_TABS
  const toSlug = (tab: LeagueShellTab) =>
    tab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  return (
    <div className="flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-2">
      {list.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition ${activeTab === tab ? "bg-white text-black" : "border border-white/10 bg-black/20 text-white/75 hover:bg-white/10"}`}
          data-testid={`league-tab-${toSlug(tab)}`}
          data-audit={tab === "Rankings" ? "rankings-tab" : undefined}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
