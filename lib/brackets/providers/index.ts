import type { BracketDataProvider } from "./types"
import { MockProvider } from "./mock-provider"
import { HttpProvider } from "./http-provider"
import { getTheSportsDbApiKey } from '@/lib/env/sports-media-keys'

let cachedProvider: BracketDataProvider | null = null
let cachedAt = 0
const CACHE_TTL = 5 * 60 * 1000

function buildProviders(): BracketDataProvider[] {
  const providers: BracketDataProvider[] = []

  const apiSportsKey = process.env.API_SPORTS_KEY
  const ncaafLeagueId = process.env.APISPORTS_NCAAF_LEAGUE_ID || '2'
  if (apiSportsKey) {
    providers.push(
      new HttpProvider({
        name: "API-Sports NCAAF",
        id: "api-sports",
        baseUrl: "https://v1.american-football.api-sports.io",
        apiKey: apiSportsKey,
        endpoints: {
          schedule: `/games?league=${ncaafLeagueId}&season={season}`,
          liveScores: `/games?live=all&league=${ncaafLeagueId}`,
        },
        headers: {
          "x-apisports-key": apiSportsKey,
        },
      })
    )
  }

  const theSportsDbKey = getTheSportsDbApiKey()
  if (theSportsDbKey || process.env.NODE_ENV === "development") {
    providers.push(
      new HttpProvider({
        name: "TheSportsDB",
        id: "thesportsdb",
        baseUrl: `https://www.thesportsdb.com/api/v1/json/${theSportsDbKey || "3"}`,
        endpoints: {
          schedule: "/eventsseason.php?id=4607&s={season}",
          liveScores: "/eventslast.php?id=4607",
        },
      })
    )
  }

  if (process.env.NODE_ENV === "development" || process.env.USE_MOCK_PROVIDER === "true") {
    providers.push(new MockProvider())
  }

  return providers
}

export async function selectBestProvider(): Promise<BracketDataProvider> {
  if (cachedProvider && Date.now() - cachedAt < CACHE_TTL) {
    return cachedProvider
  }

  const providers = buildProviders()
  if (providers.length === 0) {
    throw new Error("[ProviderSelector] No bracket data providers configured")
  }

  const scored: Array<{ provider: BracketDataProvider; score: number; healthy: boolean }> = []

  await Promise.all(
    providers.map(async (p) => {
      try {
        const [score, healthy] = await Promise.all([p.capabilityScore(), p.checkHealth()])
        scored.push({ provider: p, score, healthy })
      } catch {
        scored.push({ provider: p, score: 0, healthy: false })
      }
    })
  )

  scored.sort((a, b) => {
    if (a.healthy && !b.healthy) return -1
    if (!a.healthy && b.healthy) return 1
    return b.score - a.score
  })

  const best = scored[0]
  console.log(
    `[ProviderSelector] Selected: ${best.provider.name} (score=${best.score}, healthy=${best.healthy}). ` +
    `Candidates: ${scored.map((s) => `${s.provider.id}:${s.score}`).join(", ")}`
  )

  cachedProvider = best.provider
  cachedAt = Date.now()
  return cachedProvider
}

export function listProviders(): Array<{ id: string; name: string }> {
  return buildProviders().map((p) => ({ id: p.id, name: p.name }))
}

export { MockProvider } from "./mock-provider"
export { HttpProvider } from "./http-provider"
export type { BracketDataProvider, CapabilityScore, NcaabGame, TournamentField } from "./types"
