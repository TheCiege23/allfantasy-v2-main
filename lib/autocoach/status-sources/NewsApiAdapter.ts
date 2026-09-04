import 'server-only'

import type { NormalizedStatusHit } from './types'
import { getInjuryNewsArticlesDbFirst } from '@/lib/news/newsapi-cache'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

const INJURY_RE = /(ruled out|placed on|inactive|suspended|injured list|\bIR\b|\bIL\b|scratches|scratch|out for|DNP)/i

function majorOutlet(name: string): boolean {
  const n = name.toLowerCase()
  return /espn|cbs|fox|bleacher|nfl\.com|nba\.com|mlb\.com|nhl\.com/.test(n)
}

/**
 * NewsAPI.org structured articles (optional; requires NEWS_API_KEY / NEWSAPI_KEY).
 */
export async function fetchInjuryNewsArticles(sport: string, gameDate: string): Promise<NormalizedStatusHit[]> {
  const normalizedSport = normalizeToSupportedSport(sport)
  const { articles } = await getInjuryNewsArticlesDbFirst({
    sport: normalizedSport,
    gameDate,
  })
  if (articles.length === 0) {
    return []
  }

  try {
    const out: NormalizedStatusHit[] = []
    const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g

    for (const article of articles) {
      const title = String(article.title ?? '')
      const desc = String(article.description ?? '')
      const combined = `${title} ${desc}`
      if (!INJURY_RE.test(combined)) continue
      const sourceName = String(article.source ?? 'newsapi_everything')

      const candidates: string[] = []
      for (const m of combined.matchAll(nameRe)) {
        if (m[1]) candidates.push(m[1].trim())
      }
      const playerName = candidates[0] ?? ''
      if (!playerName || playerName.length < 5) continue

      /*
       * 🛑 THE ACRONYMS NEED WORD BOUNDARIES AND MUST NOT BE CASE-INSENSITIVE.
       * `/IR|injured reserve/i` matches the letter pair "ir" ANYWHERE in the
       * headline — "their", "first", "confirmed", "Sirianni" — so essentially
       * every article that cleared INJURY_RE above was classified IR. `/IL/i`
       * has the same problem ("will", "questionable", "available").
       * `aggregatePlayerStatuses` writes this straight onto `SportsPlayer.status`,
       * so the cost is a healthy player shown on injured reserve league-wide.
       * Uppercase + \b is how `lib/workers/x-news-ingestion.ts` already spells it.
       */
      let status = 'OUT'
      if (/\bIR\b/.test(combined) || /injured reserve/i.test(combined)) status = 'IR'
      else if (/suspended/i.test(combined)) status = 'SUSPENDED'
      else if (/\bIL\b/.test(combined) || /injured list|10-day|60-day/i.test(combined)) status = 'IL'

      const confidence = majorOutlet(sourceName) ? 0.85 : 0.6
      out.push({
        playerName,
        sport: normalizedSport,
        status,
        source: 'news_api',
        confidence,
        sourceUrl: article.url || undefined,
        rawText: title,
        gameDate,
      })
    }

    const seen = new Set<string>()
    const deduped: NormalizedStatusHit[] = []
    for (const h of out) {
      const k = `${h.playerName.toLowerCase()}|${h.status}`
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push(h)
    }
    return deduped
  } catch (e) {
    console.warn('[NewsApiAdapter] error:', e)
    return []
  }
}
