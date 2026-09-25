import { NextRequest, NextResponse } from 'next/server'
import emojibaseData from 'emojibase-data/en/data.json'
import emojibaseShortcodes from 'emojibase-data/en/shortcodes/emojibase.json'
import {
  buildEmojiCatalog,
  searchEmojiCatalog,
  type EmojiCatalog,
  type EmojibaseEntry,
  type EmojibaseShortcodes,
} from '@/lib/chat/emojiCatalog'

/**
 * The chat emoji picker's catalog — the full Unicode set from Emojibase with a fantasy tab in front.
 * See lib/chat/emojiCatalog.ts for what is included and why.
 *
 * It used to read the `chat_emojis` table, which holds 32 rows (measured 2026-09-25). That table is
 * still seeded by lib/chat/catalogSync.ts and no longer read here; the 32 live on as the fantasy tab.
 *
 *   GET                 → { emojis, categories, fantasy }   the whole catalog, cached a day
 *   GET ?q=goat         → { emojis }                        best matches first
 *   GET ?category=food  → { emojis }                        one tab
 */

export const dynamic = 'force-dynamic'

let catalog: EmojiCatalog | null = null
function getCatalog(): EmojiCatalog {
  if (!catalog) {
    catalog = buildEmojiCatalog(
      emojibaseData as unknown as EmojibaseEntry[],
      emojibaseShortcodes as unknown as EmojibaseShortcodes,
    )
  }
  return catalog
}

/** The dataset only changes with a deploy, so a browser may keep it for a day. */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' }

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams?.get('q')?.trim() ?? ''
  const category = req.nextUrl.searchParams?.get('category')?.trim() ?? ''

  try {
    const c = getCatalog()
    if (q) {
      return NextResponse.json({ emojis: searchEmojiCatalog(c.emojis, q) }, { headers: CACHE_HEADERS })
    }
    if (category) {
      const emojis =
        category === 'fantasy'
          ? c.fantasy.map((id) => c.emojis.find((e) => e.id === id)).filter(Boolean)
          : c.emojis.filter((e) => e.category === category)
      return NextResponse.json({ emojis }, { headers: CACHE_HEADERS })
    }
    return NextResponse.json(c, { headers: CACHE_HEADERS })
  } catch (e) {
    console.error('[api/chat/emojis]', e instanceof Error ? e.message : e)
    return NextResponse.json({ emojis: [], categories: [], fantasy: [], error: 'Failed to load emojis' }, { status: 500 })
  }
}
