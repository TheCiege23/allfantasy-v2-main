import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"

type SportsRouteSportParam = {
  sport: string
  requestedSport: string
  isWorldCup: boolean
}

const WORLD_CUP_ALIASES = new Set(["world-cup", "world cup", "worldcup", "wc", "wc_soccer", "world_cup"])
const ROUTE_SPORT_ALIASES: Record<string, string> = {
  cfb: "NCAAF",
  ncaafb: "NCAAF",
  "college-football": "NCAAF",
  "college football": "NCAAF",
  "ncaa-football": "NCAAF",
  "ncaa football": "NCAAF",
  cbb: "NCAAB",
  ncaam: "NCAAB",
  ncaabb: "NCAAB",
  "college-basketball": "NCAAB",
  "college basketball": "NCAAB",
  "ncaa-basketball": "NCAAB",
  "ncaa basketball": "NCAAB",
  epl: "SOCCER",
  euro: "SOCCER",
  uefa: "SOCCER",
}

export function parseSportsRouteSportParam(raw: string | null | undefined): SportsRouteSportParam {
  const requestedSport = raw?.trim() || DEFAULT_SPORT
  const lower = requestedSport.toLowerCase()

  if (WORLD_CUP_ALIASES.has(lower)) {
    return { sport: "SOCCER", requestedSport, isWorldCup: true }
  }

  const alias = ROUTE_SPORT_ALIASES[lower]
  if (alias) {
    return { sport: alias, requestedSport, isWorldCup: false }
  }

  const normalized = normalizeToSupportedSport(requestedSport)
  const isExplicit = Boolean(raw?.trim())
  const isValid =
    !isExplicit ||
    (SUPPORTED_SPORTS as readonly string[]).includes(requestedSport.toUpperCase()) ||
    normalized.toLowerCase() === lower ||
    normalized === requestedSport.toUpperCase()

  if (!isValid) {
    throw new Error(`Unsupported sport: ${requestedSport}`)
  }

  return { sport: normalized, requestedSport, isWorldCup: false }
}
