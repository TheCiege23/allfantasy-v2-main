import { prisma } from '@/lib/prisma'
import type { ADPEntry } from '@/lib/adp-data'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

const ESPN_NEWS_TTL_MS = 45 * 60 * 1000

type EspnNewsCacheRow = {
  playerName?: string | null
  title: string
  content?: string | null
  source: string
}

function buildEspnNewsCacheKey(sport: string, scope: string, dateBucket: string): string {
  return `espn:news:${sport.toLowerCase()}:${scope}:${dateBucket}`
}

function currentUtcDateBucket(): string {
  return new Date().toISOString().slice(0, 10)
}

async function getCachedEspnNewsRows(): Promise<EspnNewsCacheRow[]> {
  const cacheKey = buildEspnNewsCacheKey('nfl', 'all', currentUtcDateBucket())
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  if (cached && cached.expiresAt > new Date()) {
    console.log(`[espn/news] ESPN cache hit { cacheKey: '${cacheKey}' }`)
    return Array.isArray(cached.data) ? (cached.data as EspnNewsCacheRow[]) : []
  }

  const refreshStart = Date.now()
  try {
    console.log(`[espn/news] ESPN cache miss { cacheKey: '${cacheKey}' }`)
    /*
     * ESPN news read inline on cache miss from a REQUEST path — this module is imported by five
     * app/api/mock-draft/* routes, so a cold cache puts provider latency in front of a user.
     * Mitigated but not fixed: 45-minute TTL, 4s timeout, stale-on-failure fallback.
     *
     * MIGRATION: read `player_news`, which app/api/sports/news/sync-helper.ts already populates
     * from this same ESPN feed. This fetch goes away entirely once that read path is wired, which
     * is what makes the marker below a temporary exception rather than a silencer.
     *
     * ⚠ The marker has to sit on the OFFENDING LINE — the guard skips lines that CONTAIN the
     * string, not blocks that precede them. Putting it in this comment left the violation flagged.
     */
    const res = await fetch(`${ESPN_SITE_API_BASE}/football/nfl/news?limit=40`, { // db-first-exception: request-path ESPN news on cache miss; migrating to player_news
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      if (cached && Array.isArray(cached.data)) return cached.data as EspnNewsCacheRow[]
      return []
    }

    const json = await res.json()
    const articles = Array.isArray(json?.articles) ? json.articles : []
    const rows = articles.map((a: any) => ({
      playerName: null,
      title: String(a?.headline || ''),
      content: String(a?.description || a?.story || ''),
      source: 'espn_live',
    }))

    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        data: rows as unknown as object,
        expiresAt: new Date(Date.now() + ESPN_NEWS_TTL_MS),
      },
      update: {
        data: rows as unknown as object,
        expiresAt: new Date(Date.now() + ESPN_NEWS_TTL_MS),
      },
    }).catch(() => {})

    console.log(`[espn/news] live refresh durationMs=${Date.now() - refreshStart} cacheKey='${cacheKey}'`)
    console.log(`[espn/news] cache save { cacheKey: '${cacheKey}' }`)
    return rows
  } catch {
    if (cached && Array.isArray(cached.data)) return cached.data as EspnNewsCacheRow[]
    return []
  }
}

type AdpAdjustment = {
  name: string
  adjustedAdp: number
  delta: number
  reasons: string[]
}

function normalizeName(name: string) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.'-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

async function fetchRecentSportsSignals() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const dbNews = await prisma.sportsNews.findMany({
    where: {
      sport: 'NFL',
      OR: [
        { publishedAt: { gte: sevenDaysAgo } },
        { createdAt: { gte: sevenDaysAgo } },
      ],
    },
    orderBy: { publishedAt: 'desc' },
    take: 150,
    select: { playerName: true, title: true, content: true, source: true },
  }).catch(() => [])

  const espnNews = await getCachedEspnNewsRows()

  return [...dbNews, ...espnNews]
}

function computeNewsDelta(text: string): { delta: number; reasons: string[] } {
  const t = text.toLowerCase()
  let delta = 0
  const reasons: string[] = []

  if (/(out|ir|injured reserve|season-ending|torn|suspension)/.test(t)) {
    delta += 10
    reasons.push('Negative injury/availability signal')
  }
  if (/(questionable|doubtful|limited|setback)/.test(t)) {
    delta += 4
    reasons.push('Short-term risk signal')
  }
  if (/(promoted|starter|first team|extended|breakout|impressed|surging)/.test(t)) {
    delta -= 4
    reasons.push('Positive role/momentum signal')
  }
  if (/(traded|trade to)/.test(t)) {
    delta -= 2
    reasons.push('Recent trade/news volatility signal')
  }

  return { delta, reasons }
}

export async function applyRealtimeAdpAdjustments(entries: ADPEntry[], opts?: { isDynasty?: boolean }) {
  const news = await fetchRecentSportsSignals()
  const rookieRanks = await (prisma as any).rookieRanking.findMany({
    where: { year: { in: [new Date().getFullYear(), new Date().getFullYear() + 1] } },
    select: { name: true, rank: true },
    orderBy: { rank: 'asc' },
    take: 80,
  }).catch(() => [])

  const rookieRankMap = new Map<string, number>()
  for (const r of rookieRanks) rookieRankMap.set(normalizeName(r.name), Number(r.rank || 999))

  const newsByPlayer = new Map<string, { delta: number; reasons: string[] }>()

  for (const n of news) {
    const playerHint = n.playerName ? normalizeName(n.playerName) : ''
    const text = `${n.title || ''} ${n.content || ''}`
    const parsed = computeNewsDelta(text)

    if (playerHint) {
      const existing = newsByPlayer.get(playerHint) || { delta: 0, reasons: [] }
      existing.delta += parsed.delta
      existing.reasons.push(...parsed.reasons)
      newsByPlayer.set(playerHint, existing)
      continue
    }
  }

  const adjusted: ADPEntry[] = []
  const adjustments: AdpAdjustment[] = []

  for (const e of entries) {
    const key = normalizeName(e.name)
    let adpDelta = 0
    const reasons: string[] = []

    const fromNews = newsByPlayer.get(key)
    if (fromNews) {
      adpDelta += fromNews.delta
      reasons.push(...fromNews.reasons)
    }

    if (opts?.isDynasty) {
      const rk = rookieRankMap.get(key)
      if (rk != null) {
        if (rk <= 5) { adpDelta -= 9; reasons.push('Top rookie ranking boost') }
        else if (rk <= 12) { adpDelta -= 5; reasons.push('Strong rookie ranking boost') }
        else if (rk <= 24) { adpDelta -= 2; reasons.push('Rookie ranking support') }
      }
    }

    const adjustedAdp = clamp(Number(e.adp || 999) + adpDelta, 1, 999)
    adjusted.push({ ...e, adp: adjustedAdp })

    if (Math.abs(adpDelta) >= 2) {
      adjustments.push({
        name: e.name,
        adjustedAdp,
        delta: adpDelta,
        reasons: Array.from(new Set(reasons)).slice(0, 2),
      })
    }
  }

  adjusted.sort((a, b) => a.adp - b.adp)

  return {
    entries: adjusted,
    adjustments: adjustments.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 35),
    sourcesUsed: {
      rookieRanking: rookieRanks.length,
      sportsNews: news.length,
      espn: news.filter(n => n.source === 'espn_live').length,
    },
  }
}
