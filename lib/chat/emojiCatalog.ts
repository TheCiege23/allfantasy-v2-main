/**
 * The chat emoji picker's catalog: the full Unicode set from Emojibase (MIT, `emojibase-data`), with
 * a hand-picked fantasy tab in front (owner's call 2026-09-25, pointing at emojibase.dev/docs/datasets).
 *
 * WHY: the picker read a `chat_emojis` table holding 32 rows — measured 2026-09-25 — so a league chat
 * could not send a 🐐 or a 🤡. And those 32 carried categories (`faces`, `reactions`, `stats`…) the
 * picker had no tab icon for, so every tab button rendered as a bare "•".
 *
 * No API: emoji are Unicode text every device already draws. This is data, bundled and served from
 * our own route, so there is no third-party call on any request path.
 *
 * What is left out, and why:
 *   - skin-tone and hair COMPONENT swatches (group 2) and loose regional-indicator letters (no group)
 *     — they are building blocks, not emoji anyone sends;
 *   - skin-tone VARIANTS — the base emoji only, which keeps the payload small;
 *   - anything newer than Emoji MAX_EMOJI_VERSION, because a phone that cannot draw it shows an empty
 *     box, and a reaction nobody can see is worse than one that was never offered.
 *
 * Pure: the route passes the dataset in, tests pass fixtures.
 */

/** Emoji 15.0 (2022) is drawn by iOS 16.4+ and Android 14+; later versions still render as boxes on many phones. */
export const MAX_EMOJI_VERSION = 15

export const EMOJI_CATEGORIES = [
  { key: 'fantasy', label: 'Fantasy', icon: '🏈' },
  { key: 'smileys', label: 'Smileys', icon: '😀' },
  { key: 'people', label: 'People', icon: '👋' },
  { key: 'nature', label: 'Animals & nature', icon: '🐐' },
  { key: 'food', label: 'Food & drink', icon: '🍕' },
  { key: 'activities', label: 'Sports & activities', icon: '🏆' },
  { key: 'travel', label: 'Travel & places', icon: '✈️' },
  { key: 'objects', label: 'Objects', icon: '💡' },
  { key: 'symbols', label: 'Symbols', icon: '❤️' },
  { key: 'flags', label: 'Flags', icon: '🏁' },
] as const

export type EmojiCategoryKey = (typeof EMOJI_CATEGORIES)[number]['key']

/** Emojibase group number → our tab. Group 2 (components) is deliberately absent. */
const GROUP_TO_CATEGORY: Record<number, EmojiCategoryKey> = {
  0: 'smileys',
  1: 'people',
  3: 'nature',
  4: 'food',
  5: 'travel',
  6: 'activities',
  7: 'objects',
  8: 'symbols',
  9: 'flags',
}

/**
 * The fantasy tab: the 32 the old table held, plus the trash talk they were missing. Each is ALSO in
 * its own Unicode tab; this tab only points at them, so search never shows one twice.
 */
export const FANTASY_EMOJI = [
  '🏈', '🏆', '🥇', '🔥', '💯', '🚨', '👀', '🧠', '🐐', '🤝', '👏', '🙌', '👍', '👎', '💪', '🫡',
  '📈', '📉', '🎯', '🚀', '💸', '💀', '😭', '😂', '🤣', '😎', '😤', '🥶', '🤡', '🧂', '🗑️', '⏳',
  '✅', '❌', '📌', '💬', '🏀', '⚾', '🏒', '⚽',
] as const

/** The shape the picker reads. `keywords` is lowercase text the search matches against. */
export type EmojiCatalogRow = {
  id: string
  char: string
  name: string
  shortcode: string
  category: EmojiCategoryKey
  keywords: string
}

export type EmojiCatalog = {
  emojis: EmojiCatalogRow[]
  categories: Array<{ key: EmojiCategoryKey; label: string; icon: string }>
  /** Ids of the fantasy tab, in order. */
  fantasy: string[]
}

/** The fields this reads from Emojibase's `data.json` — see node_modules/emojibase-data/en/data.json.d.ts. */
export type EmojibaseEntry = {
  hexcode: string
  label: string
  emoji: string
  group?: number
  order?: number
  version?: number
  tags?: string[]
}

/** Emojibase `shortcodes/*.json`: hexcode → one shortcode or several. */
export type EmojibaseShortcodes = Record<string, string | string[]>

/** Variation selector 16 — "draw as emoji". Matching ignores it; 🗑 and 🗑️ are one emoji. */
const stripVs16 = (s: string) => s.replace(/\uFE0F/g, '')

export function buildEmojiCatalog(
  data: readonly EmojibaseEntry[],
  shortcodes: EmojibaseShortcodes,
  opts: { maxVersion?: number } = {},
): EmojiCatalog {
  const maxVersion = opts.maxVersion ?? MAX_EMOJI_VERSION
  const rows: Array<EmojiCatalogRow & { order: number }> = []

  for (const e of data) {
    const category = e.group == null ? undefined : GROUP_TO_CATEGORY[e.group]
    if (!category) continue
    if (typeof e.version === 'number' && e.version > maxVersion) continue
    if (!e.emoji || !e.hexcode || !e.label) continue
    const codes = shortcodes[e.hexcode]
    const list = (Array.isArray(codes) ? codes : codes ? [codes] : []).filter((c) => typeof c === 'string' && c)
    const shortcode = list[0] ?? e.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const label = e.label.toLowerCase()
    const words = new Set<string>()
    for (const t of [...(e.tags ?? []), ...list]) {
      const w = String(t).toLowerCase().replace(/_/g, ' ').trim()
      if (w && !label.includes(w)) words.add(w)
    }
    rows.push({
      id: e.hexcode,
      char: e.emoji,
      name: e.label,
      shortcode,
      category,
      keywords: [label, ...words].join(' '),
      order: typeof e.order === 'number' ? e.order : Number.MAX_SAFE_INTEGER,
    })
  }

  rows.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  const emojis: EmojiCatalogRow[] = rows.map(({ order: _order, ...r }) => r)

  const byChar = new Map(emojis.map((r) => [stripVs16(r.char), r.id]))
  const fantasy = FANTASY_EMOJI.map((c) => byChar.get(stripVs16(c))).filter((id): id is string => Boolean(id))

  return {
    emojis,
    categories: EMOJI_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon })),
    fantasy,
  }
}

/** Search by name, shortcode, keyword or the emoji itself; best matches first, capped. */
export function searchEmojiCatalog(emojis: readonly EmojiCatalogRow[], query: string, limit = 120): EmojiCatalogRow[] {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, '')
  if (!q) return []
  const rank = (r: EmojiCatalogRow): number => {
    const name = r.name.toLowerCase()
    if (r.char === query.trim() || stripVs16(r.char) === stripVs16(query.trim())) return 0
    if (name === q || r.shortcode === q) return 1
    if (name.startsWith(q) || r.shortcode.startsWith(q)) return 2
    if (r.keywords.split(' ').some((w) => w.startsWith(q))) return 3
    if (r.keywords.includes(q) || r.shortcode.includes(q)) return 4
    return -1
  }
  const hits: Array<{ r: EmojiCatalogRow; score: number; i: number }> = []
  emojis.forEach((r, i) => {
    const score = rank(r)
    if (score >= 0) hits.push({ r, score, i })
  })
  hits.sort((a, b) => a.score - b.score || a.i - b.i)
  return hits.slice(0, limit).map((h) => h.r)
}
