import { resolveFallbackRoute } from "./FallbackRouteResolver"

type NoResultsContext =
  | "search"
  | "dashboard_leagues"
  | "notifications"
  | "legacy_import"

interface NoResultsActionSpec {
  id: string
  label: string
  href?: string
  action?: "clear_query" | "clear_filters"
}

interface NoResultsState {
  title: string
  description: string
  actions: NoResultsActionSpec[]
}

interface ResolveNoResultsStateInput {
  context: NoResultsContext
  query?: string
  hasFilters?: boolean
  sportLabel?: string | null
}

export function resolveNoResultsState(
  input: ResolveNoResultsStateInput
): NoResultsState {
  if (input.context === "search") {
    const q = (input.query ?? "").trim()
    if (q.length >= 2) {
      return {
        title: `No results for "${q}"`,
        description:
          "Try a different query, remove filters, or jump to a common workflow.",
        actions: [
          { id: "clear_query", label: "Clear search", action: "clear_query" },
          { id: "clear_filters", label: "Clear filters", action: "clear_filters" },
          {
            id: "explore_tools",
            ...resolveFallbackRoute("explore_tools"),
          },
        ],
      }
    }
    return {
      title: "Search everything",
      description:
        "Find leagues, players, tools, settings, AI actions, and bracket destinations in one place.",
      actions: [
        {
          id: "ask_chimmy",
          ...resolveFallbackRoute("ask_chimmy"),
        },
        {
          id: "explore_tools",
          ...resolveFallbackRoute("explore_tools"),
        },
      ],
    }
  }

  if (input.context === "dashboard_leagues") {
    const sportHint = input.sportLabel ? ` for ${input.sportLabel}` : ""
    return {
      title: `No leagues${sportHint}`,
      description:
        "Create, import, or connect a provider to unlock league-first workflows.",
      actions: [
        { id: "create", ...resolveFallbackRoute("create_league") },
        { id: "import", ...resolveFallbackRoute("import_league") },
        { id: "connect", ...resolveFallbackRoute("connect_provider") },
      ],
    }
  }

  if (input.context === "notifications") {
    return {
      title: "No notifications yet",
      description:
        "When league events, mentions, and AI updates arrive, they will appear here.",
      actions: [
        { id: "settings", ...resolveFallbackRoute("settings") },
        { id: "dashboard", ...resolveFallbackRoute("dashboard") },
      ],
    }
  }

  return {
    title: "No import activity yet",
    description:
      "Connect a provider or start your first import to track progress here.",
    actions: [
      { id: "import", ...resolveFallbackRoute("import_league") },
      { id: "connect", ...resolveFallbackRoute("connect_provider") },
    ],
  }
}
