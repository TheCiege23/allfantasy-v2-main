/**
 * SearchResultResolver — static searchable items (pages, tools) and result grouping.
 */

import { getPrimaryChimmyEntry } from "@/lib/ai-product-layer"

export type SearchResultCategory = "page" | "tool" | "league" | "player" | "quick_action"

export interface SearchResultItem {
  id: string
  label: string
  href: string
  category: SearchResultCategory
  keywords?: string[]
  description?: string
  sport?: string | null
  score?: number
}

/** Static pages and destinations for universal search. */
const CHIMMY_HREF = getPrimaryChimmyEntry({ source: "search" }).href

const STATIC_PAGES: SearchResultItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    category: "page",
    keywords: ["home", "overview"],
    description: "Unified activity overview",
  },
  {
    id: "profile",
    label: "Profile",
    href: "/profile",
    category: "page",
    keywords: ["user", "account", "identity"],
    description: "Identity and progress summary",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    category: "page",
    keywords: ["preferences", "account", "privacy", "security"],
    description: "Account, preferences, and security",
  },
  {
    id: "settings-profile",
    label: "Settings · Profile",
    href: "/settings?tab=profile",
    category: "page",
    keywords: ["settings", "profile", "bio"],
    description: "Edit profile details",
  },
  {
    id: "settings-notifications",
    label: "Settings · Notifications",
    href: "/settings?tab=notifications",
    category: "page",
    keywords: ["settings", "notification", "alerts"],
    description: "Notification preferences",
  },
  {
    id: "settings-account",
    label: "Settings · Account",
    href: "/settings?tab=account",
    category: "page",
    keywords: ["settings", "account", "password", "email"],
    description: "Account and login settings",
  },
  {
    id: "leagues",
    label: "My Leagues",
    href: "/leagues",
    category: "page",
    keywords: ["league", "find", "discover"],
    description: "Open your league hub",
  },
  {
    id: "find-league",
    label: "Find League",
    href: "/find-league",
    category: "page",
    keywords: ["league", "discover", "join"],
    description: "Discover new leagues",
  },
  {
    id: "app",
    label: "WebApp",
    href: "/dashboard",
    category: "page",
    keywords: ["sports", "app", "roster"],
    description: "League manager workspace",
  },
  {
    id: "brackets",
    label: "Bracket Challenge",
    href: "/brackets",
    category: "page",
    keywords: ["bracket", "pool", "ncaa"],
    description: "Pools and picks",
  },
  {
    id: "legacy",
    label: "Legacy AI",
    href: "/af-legacy",
    category: "page",
    keywords: ["legacy", "dynasty", "trade", "draft"],
    description: "Legacy workflows and AI",
  },
  {
    id: "tools-hub",
    label: "Tools Hub",
    href: "/tools-hub",
    category: "page",
    keywords: ["tools", "hub"],
    description: "All cross-product tools",
  },
  {
    id: "chimmy",
    label: "Chimmy",
    href: "/chimmy",
    category: "page",
    keywords: ["chimmy", "ai", "chat"],
    description: "AI landing and onboarding",
  },
  {
    id: "messages",
    label: "Messages",
    href: "/messages",
    category: "page",
    keywords: ["messages", "inbox", "chat"],
    description: "Inbox and league chat",
  },
  {
    id: "wallet",
    label: "Wallet",
    href: "/wallet",
    category: "page",
    keywords: ["wallet", "payments"],
    description: "Wallet and balances",
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/app/notifications",
    category: "page",
    keywords: ["notifications", "alerts"],
    description: "Latest platform alerts",
  },
]

/** Tools with openToolHref-style entries for search. */
const STATIC_TOOLS: SearchResultItem[] = [
  {
    id: "trade-evaluator",
    label: "Trade Analyzer",
    href: "/trade-evaluator",
    category: "tool",
    keywords: ["trade", "analyzer", "evaluate"],
    description: "Evaluate any trade quickly",
  },
  {
    id: "trade-analyzer",
    label: "Trade Analyzer Pro",
    href: "/trade-analyzer",
    category: "tool",
    keywords: ["trade", "calculator", "value"],
    description: "Advanced trade analysis",
  },
  {
    id: "trade-finder",
    label: "Trade Finder",
    href: "/trade-finder",
    category: "tool",
    keywords: ["trade", "finder", "partners"],
    description: "Find trade partners",
  },
  {
    id: "mock-draft",
    label: "Mock Draft",
    href: "/mock-draft",
    category: "tool",
    keywords: ["mock", "draft", "simulator"],
    description: "Practice drafts",
  },
  {
    id: "waiver-ai",
    label: "Waiver Advisor",
    href: "/waiver-ai",
    category: "tool",
    keywords: ["waiver", "wire", "advisor", "pickup"],
    description: "Waiver suggestions and FAAB",
  },
  {
    id: "legacy-mock",
    label: "Draft War Room",
    href: "/legacy?tab=mock-draft",
    category: "tool",
    keywords: ["draft", "war", "room", "mock"],
    description: "Legacy mock draft workflow",
  },
  {
    id: "legacy-chat",
    label: "AI Chat",
    href: CHIMMY_HREF,
    category: "tool",
    keywords: ["chat", "chimmy", "ai"],
    description: "Ask Chimmy in legacy mode",
  },
  {
    id: "bracket-home",
    label: "Bracket Home",
    href: "/bracket/home",
    category: "tool",
    keywords: ["bracket", "challenge", "home"],
    description: "Bracket home tools",
  },
  {
    id: "bracket-new-entry",
    label: "Create Bracket Entry",
    href: "/brackets/leagues/new",
    category: "tool",
    keywords: ["bracket", "entry", "pool", "create"],
    description: "Start a new bracket pool",
  },
  {
    id: "power-rankings",
    label: "Power Rankings",
    href: "/app/power-rankings",
    category: "tool",
    keywords: ["power", "rankings"],
    description: "League power rankings",
  },
  {
    id: "simulation-lab",
    label: "Matchup Simulator",
    href: "/app/simulation-lab",
    category: "tool",
    keywords: ["simulation", "matchup", "simulator"],
    description: "Run matchup simulations",
  },
]

export function getStaticSearchItems(): SearchResultItem[] {
  return [...STATIC_PAGES, ...STATIC_TOOLS]
}

/** Match query against label and keywords; return items that match. */
export function resolveStaticResults(query: string): SearchResultItem[] {
  const q = query.trim().toLowerCase()
  if (!q || q.length < 2) return []
  const items = getStaticSearchItems()
  const ranked: SearchResultItem[] = []

  for (const item of items) {
    const label = item.label.toLowerCase()
    const href = item.href.toLowerCase()
    const keywords = item.keywords ?? []
    const exact = label === q ? 5 : 0
    const prefix = label.startsWith(q) ? 3 : 0
    const include =
      label.includes(q) ||
      href.includes(q) ||
      keywords.some((k) => k.toLowerCase().includes(q))
    if (!include) continue
    ranked.push({ ...item, score: exact + prefix + 1 })
  }

  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.label.localeCompare(b.label))
  return ranked
}

/** Group results by category for display. */
export function groupResultsByCategory<T extends { category: SearchResultCategory }>(
  results: T[]
): Map<SearchResultCategory, T[]> {
  const map = new Map<SearchResultCategory, T[]>()
  for (const r of results) {
    const list = map.get(r.category) ?? []
    list.push(r)
    map.set(r.category, list)
  }
  const order: SearchResultCategory[] = ["quick_action", "league", "player", "tool", "page"]
  const out = new Map<SearchResultCategory, T[]>()
  for (const cat of order) {
    const list = map.get(cat)
    if (list?.length) out.set(cat, list)
  }
  for (const [cat, list] of map) {
    if (!out.has(cat)) out.set(cat, list)
  }
  return out
}

export interface LeagueSearchApiHit {
  id: string
  name: string | null
  sport?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean
  leagueSize?: number | null
}

export interface PlayerSearchApiHit {
  id: string
  name: string
  position?: string | null
  team?: string | null
  sport?: string | null
}

export function mapLeagueSearchHitsToResults(hits: LeagueSearchApiHit[]): SearchResultItem[] {
  return hits.map((hit) => {
    const parts = [
      hit.sport ? String(hit.sport).toUpperCase() : null,
      hit.leagueVariant || (hit.isDynasty ? "Dynasty" : "Redraft"),
      typeof hit.leagueSize === "number" ? `${hit.leagueSize}-team` : null,
    ].filter(Boolean)
    return {
      id: `league-${hit.id}`,
      label: hit.name || "Unnamed League",
      href: `/leagues/${hit.id}`,
      category: "league",
      keywords: parts.map((part) => String(part).toLowerCase()),
      description: parts.join(" · ") || "League destination",
      sport: hit.sport ?? null,
    }
  })
}

export function mapPlayerSearchHitsToResults(hits: PlayerSearchApiHit[]): SearchResultItem[] {
  return hits.map((hit) => {
    const params = new URLSearchParams()
    params.set("playerId", String(hit.id))
    params.set("playerName", String(hit.name))
    if (hit.sport) params.set("sport", String(hit.sport).toUpperCase())
    const href = `/player-comparison?${params.toString()}`
    const details = [hit.position, hit.team].filter(Boolean).join(" · ")
    return {
      id: `player-${hit.id}`,
      label: hit.name,
      href,
      category: "player",
      keywords: [hit.position, hit.team].filter(Boolean).map((part) => String(part).toLowerCase()),
      description: details || "Player destination",
      sport: hit.sport ?? null,
    }
  })
}

export function dedupeSearchResults(results: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>()
  const deduped: SearchResultItem[] = []
  for (const item of results) {
    const key = `${item.category}:${item.href}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}
