import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isGifSearchConfigured, searchGifs } from '@/lib/rich-message/GIFIntegrationResolver'

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

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams?.get('q')?.trim() ?? ''
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
      return NextResponse.json({ gifs: rows.map(mapDbRow), total })
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

    return NextResponse.json({ gifs: dbRows.map(mapDbRow), total: dbRows.length })
  } catch (e) {
    console.error('[api/chat/gifs]', e)
    return NextResponse.json({ gifs: [], total: 0, error: 'Failed to load GIFs' }, { status: 500 })
  }
}
