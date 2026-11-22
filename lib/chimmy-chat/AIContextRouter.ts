import type { AIChatContext } from "./types"
import { resolveSportForAIChat } from "./SportAIChatResolver"

type SearchParamReader = {
  get: (name: string) => string | null
}

const MESSAGES_AI_PATH = "/messages"

type MessageTab = "dm" | "groups" | "ai"

function readNumberParam(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function resolveMessagesTab(tab?: string | null): MessageTab {
  if (tab === "groups") return "groups"
  if (tab === "ai") return "ai"
  return "dm"
}

export function readAIContextFromSearchParams(
  searchParams: SearchParamReader | null | undefined
): AIChatContext {
  const prompt = searchParams?.get("prompt")?.trim()
  const leagueId = searchParams?.get("leagueId")?.trim()
  const leagueName = searchParams?.get("leagueName")?.trim()
  const sleeperUsername = searchParams?.get("sleeperUsername")?.trim()
  const teamId = searchParams?.get("teamId")?.trim()
  const sport = resolveSportForAIChat(searchParams?.get("sport") ?? null, null)
  const insightTypeRaw = searchParams?.get("insightType")?.trim()
  const source = searchParams?.get("source")?.trim()
  const conversationId = searchParams?.get("conversationId")?.trim()
  const privateModeRaw = searchParams?.get("privateMode")?.trim().toLowerCase()
  const targetUsername = searchParams?.get("targetUsername")?.trim()
  const strategyMode = searchParams?.get("strategyMode")?.trim()

  const insightType =
    insightTypeRaw === "matchup" ||
    insightTypeRaw === "playoff" ||
    insightTypeRaw === "dynasty" ||
    insightTypeRaw === "trade" ||
    insightTypeRaw === "waiver" ||
    insightTypeRaw === "draft"
      ? insightTypeRaw
      : undefined

  return {
    prompt: prompt || undefined,
    leagueId: leagueId || undefined,
    leagueName: leagueName || undefined,
    sleeperUsername: sleeperUsername || undefined,
    insightType,
    teamId: teamId || undefined,
    sport,
    season: readNumberParam(searchParams?.get("season") ?? null),
    week: readNumberParam(searchParams?.get("week") ?? null),
    conversationId: conversationId || undefined,
    privateMode: privateModeRaw === "1" || privateModeRaw === "true" ? true : undefined,
    targetUsername: targetUsername || undefined,
    strategyMode: strategyMode || undefined,
    source: source ? (source as AIChatContext["source"]) : undefined,
  }
}

/**
 * Canonical private AI chat route in the messaging center.
 */
export function buildAIChatHref(context?: AIChatContext): string {
  try {
    const url = new URL(MESSAGES_AI_PATH, "https://allfantasy.com")
    url.searchParams.set("tab", "ai")

    if (context?.prompt?.trim()) url.searchParams.set("prompt", context.prompt.trim().slice(0, 500))
    if (context?.leagueId) url.searchParams.set("leagueId", context.leagueId)
    if (context?.leagueName) url.searchParams.set("leagueName", context.leagueName)
    if (context?.sleeperUsername) url.searchParams.set("sleeperUsername", context.sleeperUsername)
    if (context?.insightType) url.searchParams.set("insightType", context.insightType)
    if (context?.teamId) url.searchParams.set("teamId", context.teamId)
    if (context?.sport) url.searchParams.set("sport", context.sport)
    if (typeof context?.season === "number") url.searchParams.set("season", String(context.season))
    if (typeof context?.week === "number") url.searchParams.set("week", String(context.week))
    if (context?.conversationId) url.searchParams.set("conversationId", context.conversationId)
    if (context?.privateMode) url.searchParams.set("privateMode", "1")
    if (context?.targetUsername) url.searchParams.set("targetUsername", context.targetUsername)
    if (context?.strategyMode) url.searchParams.set("strategyMode", context.strategyMode)
    if (context?.source) url.searchParams.set("source", context.source)

    return `${url.pathname}${url.search}`
  } catch {
    return "/messages?tab=ai"
  }
}
