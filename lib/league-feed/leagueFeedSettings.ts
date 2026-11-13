export type LeagueFeedSettings = {
  enabled?: boolean
  aiFlavorEnabled?: boolean
  verbosity?: "low" | "medium" | "high"
  showArchetypesPublic?: boolean
  reactions?: {
    draft?: boolean
    waiver?: boolean
    trade?: boolean
    matchup?: boolean
  }
}

const DEFAULT_LEAGUE_FEED_SETTINGS: LeagueFeedSettings = {
  enabled: true,
  aiFlavorEnabled: true,
  verbosity: "medium",
  showArchetypesPublic: true,
  reactions: {
    draft: true,
    waiver: true,
    trade: true,
    matchup: true,
  },
}

export function getLeagueFeedSettings(settings: unknown): LeagueFeedSettings {
  if (!settings || typeof settings !== "object") return { ...DEFAULT_LEAGUE_FEED_SETTINGS }
  const o = settings as Record<string, unknown>
  const lf = o.leagueFeed
  if (!lf || typeof lf !== "object") return { ...DEFAULT_LEAGUE_FEED_SETTINGS }
  const raw = lf as Record<string, unknown>
  return {
    ...DEFAULT_LEAGUE_FEED_SETTINGS,
    enabled: raw.enabled !== false,
    aiFlavorEnabled: raw.aiFlavorEnabled !== false,
    verbosity: (raw.verbosity as LeagueFeedSettings["verbosity"]) ?? "medium",
    showArchetypesPublic: raw.showArchetypesPublic !== false,
    reactions: {
      draft: raw.reactions && typeof raw.reactions === "object" && (raw.reactions as Record<string, unknown>).draft === false ? false : true,
      waiver:
        raw.reactions && typeof raw.reactions === "object" && (raw.reactions as Record<string, unknown>).waiver === false ? false : true,
      trade: raw.reactions && typeof raw.reactions === "object" && (raw.reactions as Record<string, unknown>).trade === false ? false : true,
      matchup:
        raw.reactions && typeof raw.reactions === "object" && (raw.reactions as Record<string, unknown>).matchup === false ? false : true,
    },
  }
}

export function mergeLeagueFeedSettings(
  current: Record<string, unknown>,
  patch: Partial<LeagueFeedSettings>
): Record<string, unknown> {
  const prev = getLeagueFeedSettings(current)
  return {
    ...current,
    leagueFeed: { ...prev, ...patch },
  }
}
