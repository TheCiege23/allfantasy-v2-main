/**
 * QuickActionsService — universal quick actions for search/command palette.
 * Covers: mock draft, trade analyzer, waiver advisor, Chimmy, create league, find league, and nav.
 */

import { getChimmyQuickActionLink } from "@/lib/ai-product-layer"

export interface QuickActionItem {
  id: string
  label: string
  href: string
  description?: string
  category: "tool" | "nav" | "ai" | "league"
  keywords?: string[]
}

/** Quick actions shown in search overlay (e.g. when empty or "go to" actions). */
const CHIMMY_HREF = getChimmyQuickActionLink({ source: "quick_action" }).href

const UNIVERSAL_QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: "mock_draft",
    label: "Start mock draft",
    href: "/mock-draft",
    description: "Practice draft simulator",
    category: "tool",
    keywords: ["draft", "simulator", "war room"],
  },
  {
    id: "trade_analyzer",
    label: "Open trade analyzer",
    href: "/trade-evaluator",
    description: "Evaluate trades quickly",
    category: "tool",
    keywords: ["trade", "evaluator", "calculator"],
  },
  {
    id: "waiver_advisor",
    label: "Open waiver advisor",
    href: "/waiver-ai",
    description: "Waiver wire and FAAB guidance",
    category: "tool",
    keywords: ["waiver", "pickup", "faab"],
  },
  {
    id: "ask_chimmy",
    label: "Ask Chimmy",
    href: CHIMMY_HREF,
    description: "AI chat assistant",
    category: "ai",
    keywords: ["chimmy", "ai", "chat"],
  },
  {
    id: "create_league",
    label: "Create league",
    href: "/create-league",
    description: "Start a new league",
    category: "league",
    keywords: ["league", "create", "commissioner"],
  },
  {
    id: "find_league",
    label: "Find league",
    href: "/find-league",
    description: "Discover and join leagues",
    category: "league",
    keywords: ["league", "discover", "join"],
  },
  {
    id: "create_bracket_pool",
    label: "Create bracket pool",
    href: "/brackets/leagues/new",
    description: "Start an NCAA pool",
    category: "league",
    keywords: ["bracket", "pool", "ncaa"],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    description: "Home overview",
    category: "nav",
    keywords: ["home", "overview"],
  },
  {
    id: "webapp",
    label: "WebApp",
    href: "/dashboard",
    description: "Leagues and roster",
    category: "nav",
    keywords: ["sports", "app"],
  },
  {
    id: "brackets",
    label: "Bracket Challenge",
    href: "/brackets",
    description: "Pools and entries",
    category: "nav",
    keywords: ["bracket", "challenge"],
  },
  {
    id: "legacy",
    label: "Legacy AI",
    href: "/af-legacy",
    description: "Legacy tools and AI",
    category: "nav",
    keywords: ["legacy", "dynasty"],
  },
  {
    id: "tools_hub",
    label: "Tools hub",
    href: "/tools-hub",
    description: "All tools by sport",
    category: "nav",
    keywords: ["tools", "hub"],
  },
  {
    id: "profile",
    label: "Profile",
    href: "/profile",
    description: "Your profile",
    category: "nav",
    keywords: ["profile", "account", "identity"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    description: "Account settings",
    category: "nav",
    keywords: ["settings", "preferences"],
  },
]

function getQuickActions(): QuickActionItem[] {
  return [...UNIVERSAL_QUICK_ACTIONS]
}

/** Filter quick actions by query (label + description). */
export function filterQuickActionsByQuery(query: string): QuickActionItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return getQuickActions()
  return getQuickActions().filter(
    (a) =>
      a.label.toLowerCase().includes(q) ||
      (a.description?.toLowerCase().includes(q)) ||
      a.keywords?.some((keyword) => keyword.toLowerCase().includes(q))
  )
}
