import 'server-only'

import type { NormalizedStatusHit } from './types'

const RSS_BY_SPORT: Record<string, string> = {
  NFL: 'https://bleacherreport.com/nfl/rss',
  NBA: 'https://bleacherreport.com/nba/rss',
  MLB: 'https://bleacherreport.com/mlb/rss',
  NHL: 'https://bleacherreport.com/nhl/rss',
  NCAAF: 'https://bleacherreport.com/college-football/rss',
  NCAAB: 'https://bleacherreport.com/college-basketball/rss',
  SOCCER: 'https://bleacherreport.com/soccer/rss',
}

const INJURY_RE =
  /(ruled out|placed on ir|inactive|scratched|suspended|injured list|out for|placed on)/i

function extractItems(xml: string): Array<{ title: string; description: string; pubDate: string; link: string }> {
  const items: Array<{ title: string; description: string; pubDate: string; link: string }> = []
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? ''
    const rawTitle =
      (/<title(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block) ?? [])[1] ?? ''
    const t = String(rawTitle)
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    const rawDesc =
      (/<description(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i.exec(block) ?? [])[1] ??
      ''
    const desc = String(rawDesc)
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    const pubDate = (/<pubDate>([^<]+)<\/pubDate>/i.exec(block) ?? [])[1]?.trim() ?? ''
    const link = (/<link>([^<]+)<\/link>/i.exec(block) ?? [])[1]?.trim() ?? ''
    if (t) items.push({ title: t, description: desc, pubDate, link })
  }
  return items
}

function isTodayPub(pubDate: string, gameDate: string): boolean {
  try {
    const d = new Date(pubDate)
    if (Number.isNaN(d.getTime())) return true
    return d.toISOString().slice(0, 10) === gameDate
  } catch {
    return true
  }
}

function guessPlayerName(title: string): string {
  const t = title.replace(/^[^\w]+/, '')
  const m = /^([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){1,3})\s+/i.exec(t)
  return m ? m[1]!.trim() : ''
}

/**
 * Bleacher Report RSS — injury keyword filter; confidence 0.75.
 */
export async function fetchBleacherReportInjuries(sport: string, gameDate: string): Promise<NormalizedStatusHit[]> {
  const sk = sport.toUpperCase()
  const url = RSS_BY_SPORT[sk]
  if (!url) {
    return []
  }

  try {
    const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'AllFantasy-StatusWorker/1.0' } })
    if (!res.ok) {
      console.warn('[BleacherReportAdapter] RSS failed:', res.status)
      return []
    }
    const xml = await res.text()
    const items = extractItems(xml)
    const out: NormalizedStatusHit[] = []

    for (const it of items) {
      if (!isTodayPub(it.pubDate, gameDate)) continue
      const text = `${it.title} ${it.description}`
      if (!INJURY_RE.test(text)) continue
      const playerName = guessPlayerName(it.title)
      if (!playerName) continue
      /*
       * 🛑 `/ir\b/i` HAS A TRAILING BOUNDARY BUT NO LEADING ONE, so it matches the
       * END of ordinary words — "their", "air", "chair", "Blair" — and filed this
       * item's guessed player onto injured reserve. `aggregatePlayerStatuses`
       * writes the result straight onto `SportsPlayer.status`, so the cost is a
       * healthy player shown as injured on every surface that reads it.
       * Both boundaries, and the acronym is uppercase.
       */
      let status = 'OUT'
      if (/suspended/i.test(text)) status = 'SUSPENDED'
      else if (/\bIR\b/.test(text) || /injured reserve/i.test(text)) status = 'IR'
      else if (/scratch/i.test(text)) status = 'SCRATCHED'

      out.push({
        playerName,
        sport: sk,
        status,
        source: 'bleacher_report',
        confidence: 0.75,
        sourceUrl: it.link || undefined,
        rawText: it.title,
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
    console.warn('[BleacherReportAdapter] error:', e)
    return []
  }
}
