import { toApiChainSport, type ApiChainSport, type ApiFetchParams, type ApiProvider } from '@/lib/workers/api-config'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

const ESPN_SPORT_PATH: Partial<Record<ApiChainSport, { sport: string; league: string }>> = {
  nfl: { sport: 'football', league: 'nfl' },
  mlb: { sport: 'baseball', league: 'mlb' },
  nba: { sport: 'basketball', league: 'nba' },
  nhl: { sport: 'hockey', league: 'nhl' },
  ncaaf: { sport: 'football', league: 'college-football' },
  ncaab: { sport: 'basketball', league: 'mens-college-basketball' },
  soccer_mls: { sport: 'soccer', league: 'usa.1' },
  soccer_euro: { sport: 'soccer', league: 'eng.1' },
}

const ESPN_TIMEOUT_MS = 8_000

async function fetchEspnJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPN_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function normalizeNewsArticles(json: unknown): unknown[] {
  const articles = (json as { articles?: unknown[] })?.articles
  if (!Array.isArray(articles)) return []
  return articles
    .map((a) => {
      const o = a as Record<string, unknown>
      const links = o.links as { web?: { href?: string } } | undefined
      return {
        id: o.id ?? null,
        headline: o.headline ?? o.title ?? null,
        description: o.description ?? null,
        published: o.published ?? null,
        url: links?.web?.href ?? null,
        source: 'espn',
      }
    })
    .filter((a) => a.headline)
}

function normalizeInjuries(json: unknown): unknown[] {
  const injuries = (json as { injuries?: unknown[] })?.injuries
  if (!Array.isArray(injuries)) return []
  const out: unknown[] = []
  for (const teamBlock of injuries) {
    const block = teamBlock as Record<string, unknown>
    const items = block.injuries
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const i = item as Record<string, unknown>
      const athlete = i.athlete as Record<string, unknown> | undefined
      out.push({
        playerName: athlete?.displayName ?? null,
        playerId: athlete?.id ?? null,
        team: (block.team as { abbreviation?: string } | undefined)?.abbreviation ?? null,
        status: i.status ?? null,
        type: (i.type as { description?: string } | undefined)?.description ?? null,
        details: (i.details as { detail?: string } | undefined)?.detail ?? null,
        date: i.date ?? null,
        source: 'espn',
      })
    }
  }
  return out
}

export const espnProvider: ApiProvider = {
  name: 'espn',
  supports: ({ sport, dataType }: ApiFetchParams) => {
    const cs = toApiChainSport(sport as string)
    if (!cs || !ESPN_SPORT_PATH[cs]) return false
    return dataType === 'news' || dataType === 'injuries'
  },
  async fetch({ sport, dataType }: ApiFetchParams) {
    const cs = toApiChainSport(sport as string)
    if (!cs) return null
    const path = ESPN_SPORT_PATH[cs]
    if (!path) return null

    const base = `${ESPN_SITE_API_BASE}/${path.sport}/${path.league}`

    if (dataType === 'news') {
      const json = await fetchEspnJson(`${base}/news`)
      const articles = normalizeNewsArticles(json)
      return articles.length ? articles : null
    }

    if (dataType === 'injuries') {
      const json = await fetchEspnJson(`${base}/injuries`)
      const items = normalizeInjuries(json)
      return items.length ? items : null
    }

    return null
  },
}
