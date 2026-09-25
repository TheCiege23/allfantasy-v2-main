import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/chat/emojis/route'
import { FANTASY_EMOJI } from '@/lib/chat/emojiCatalog'

/** The picker's catalog is served from the bundled dataset — no database, no third party. */

const get = async (qs = '') => {
  const res = await GET(new NextRequest(`https://allfantasy.ai/api/chat/emojis${qs}`))
  return { res, body: await res.json() }
}

describe('GET /api/chat/emojis', () => {
  it('serves the whole catalog, cacheable for a day', async () => {
    const { res, body } = await get()
    expect(res.status).toBe(200)
    expect(body.emojis.length).toBeGreaterThan(1800)
    expect(body.categories[0]).toMatchObject({ key: 'fantasy', label: 'Fantasy' })
    expect(body.fantasy).toHaveLength(FANTASY_EMOJI.length)
    expect(res.headers.get('cache-control')).toContain('max-age=86400')
  })

  it('searches', async () => {
    const { body } = await get('?q=goat')
    expect(body.emojis[0].char).toBe('🐐')
  })

  it('serves one tab, the fantasy one in its own order', async () => {
    const { body } = await get('?category=fantasy')
    expect(body.emojis.map((e: { char: string }) => e.char.replace(/️/g, ''))).toEqual(
      FANTASY_EMOJI.map((c) => c.replace(/️/g, '')),
    )
    const food = await get('?category=food')
    expect(food.body.emojis.length).toBeGreaterThan(50)
    expect(food.body.emojis.every((e: { category: string }) => e.category === 'food')).toBe(true)
  })
})
