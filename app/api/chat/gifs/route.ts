import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { getGifProviderName, gifProviderForUrl, isGifSearchConfigured, searchGifs } from '@/lib/rich-message/GIFIntegrationResolver'

export const dynamic = 'force-dynamic'

type DbGifRow = {
  id: string
  giphyId: string
  title: string
  url: string
  previewUrl: string
  tags: string[]
  category: string
  width: number
  height: number
}

function mapDbRow(r: DbGifRow) {
  return { id: r.id, giphyId: r.giphyId, url: r.url, previewUrl: r.previewUrl, title: r.title, width: r.width, height: r.height }
}

/*
 * Attribution travels with the response: `provider` is the service the GIFs on screen came from, and
 * `searchProvider` the one a search will ask. The picker used to print "Powered By GIPHY" whatever
 * it showed; Klipy's terms want "Search KLIPY" in the box and credit under its GIFs.
 */
function attribution(urls: string[]) {
  return {
    provider: urls.map((u) => gifProviderForUrl(u)).find((p) => p != null) ?? null,
    searchProvider: getGifProviderName(),
  }
}

/*
 * 🛑 THIS ROUTE WAS OPEN TO ANYONE, UNLIMITED (found 2026-09-25). A search spends the app's GIF
 * provider quota (Klipy / GIPHY keys held server-side), so an anonymous loop could drain it for
 * every member. Every caller is a signed-in chat composer (GifPicker, gifSearchClient), so it now
 * needs a session, and SEARCHES — the requests that can reach the provider — are limited per user
 * with the repo's shared limiter. Browsing the preloaded grid reads our own table and is not counted.
 * The composer debounces typing by 300 ms, so 30 a minute is well above a person picking a GIF.
 */
const GIF_SEARCH_LIMIT_PER_MINUTE = 30
const GIF_SEARCH_WINDOW_MS = 60_000

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ gifs: [], total: 0, error: 'Sign in to search GIFs' }, { status: 401 })
  }

  const q = req.nextUrl.searchParams?.get('q')?.trim() ?? ''
  if (q) {
    const rl = consumeRateLimit({
      scope: 'chat',
      action: 'gif_search',
      sleeperUsername: userId,
      maxRequests: GIF_SEARCH_LIMIT_PER_MINUTE,
      windowMs: GIF_SEARCH_WINDOW_MS,
    })
    if (!rl.success) {
      return NextResponse.json(
        { gifs: [], total: 0, error: 'Too many GIF searches. Please wait a minute.', retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, rl.retryAfterSec)) } },
      )
    }
  }
  const limit = Math.min(Number(req.nextUrl.searchParams?.get('limit') || '24'), 48)
  const offset = Math.max(Number(req.nextUrl.searchParams?.get('offset') || '0'), 0)
  const categoryFilter = req.nextUrl.searchParams?.get('category')?.trim()

  try {
    if (!q) {
      const where = categoryFilter ? { category: categoryFilter } : {}
      const rows = await prisma.chatGif.findMany({
        where,
        orderBy: [{ category: 'asc' }, { title: 'asc' }],
        take: limit,
        skip: offset,
      })
      const total = await prisma.chatGif.count({ where })
      return NextResponse.json({ gifs: rows.map(mapDbRow), total, ...attribution(rows.map((r) => r.url)) })
    }

    // Real live search when a GIF provider key is configured (GIPHY_API_KEY in this deploy) —
    // previously this endpoint only ever searched a small pre-seeded local table regardless
    // of query, so "search" never actually searched anything beyond ~what was curated ahead
    // of time. Falls back to the local table if the live call fails or returns nothing.
    if (isGifSearchConfigured()) {
      try {
        const live = await searchGifs(q, limit)
        if (live.length > 0) {
          return NextResponse.json({
            gifs: live.map((g) => ({
              id: g.id,
              giphyId: g.id,
              url: g.url,
              previewUrl: g.previewUrl || g.url,
              title: g.title || q,
            })),
            total: live.length,
            source: live[0]?.provider ?? 'unknown',
            provider: live[0]?.provider ?? null,
            searchProvider: getGifProviderName(),
          })
        }
      } catch (e) {
        console.error('[api/chat/gifs] live search failed, falling back to local table:', e)
      }
    }

    const term = `%${q}%`
    const dbRows = categoryFilter
      ? await prisma.$queryRaw<DbGifRow[]>`
          SELECT id, "giphyId", title, url, "previewUrl", tags, category, width, height
          FROM "chat_gifs"
          WHERE category = ${categoryFilter}
            AND (title ILIKE ${term}
              OR category ILIKE ${term}
              OR array_to_string(tags, ' ') ILIKE ${term})
          ORDER BY category ASC, title ASC
          OFFSET ${offset}
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<DbGifRow[]>`
          SELECT id, "giphyId", title, url, "previewUrl", tags, category, width, height
          FROM "chat_gifs"
          WHERE (title ILIKE ${term}
             OR category ILIKE ${term}
             OR array_to_string(tags, ' ') ILIKE ${term})
          ORDER BY category ASC, title ASC
          OFFSET ${offset}
          LIMIT ${limit}
        `

    return NextResponse.json({ gifs: dbRows.map(mapDbRow), total: dbRows.length, ...attribution(dbRows.map((r) => r.url)) })
  } catch (e) {
    console.error('[api/chat/gifs]', e)
    return NextResponse.json({ gifs: [], total: 0, error: 'Failed to load GIFs' }, { status: 500 })
  }
}
