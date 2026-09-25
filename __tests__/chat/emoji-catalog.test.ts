import { describe, expect, it } from 'vitest'
import emojibaseData from 'emojibase-data/en/data.json'
import emojibaseShortcodes from 'emojibase-data/en/shortcodes/emojibase.json'

import {
  buildEmojiCatalog,
  EMOJI_CATEGORIES,
  FANTASY_EMOJI,
  MAX_EMOJI_VERSION,
  searchEmojiCatalog,
  type EmojibaseEntry,
  type EmojibaseShortcodes,
} from '@/lib/chat/emojiCatalog'

/**
 * The picker used to hold 32 emoji under tab buttons that all rendered "•". Built here from the real
 * Emojibase dataset the route ships, so a dataset upgrade that changes its shape fails here first.
 */

const real = buildEmojiCatalog(emojibaseData as unknown as EmojibaseEntry[], emojibaseShortcodes as unknown as EmojibaseShortcodes)
const char = (id: string) => real.emojis.find((e) => e.id === id)?.char

describe('the catalog built from Emojibase', () => {
  it('is the full set, not 32', () => {
    expect(real.emojis.length).toBeGreaterThan(1800)
    expect(new Set(real.emojis.map((e) => e.id)).size).toBe(real.emojis.length)
  })

  it('fills every tab it offers, in the declared order', () => {
    expect(real.categories.map((c) => c.key)).toEqual(EMOJI_CATEGORIES.map((c) => c.key))
    for (const c of real.categories.filter((c) => c.key !== 'fantasy')) {
      expect(real.emojis.some((e) => e.category === c.key), c.key).toBe(true)
    }
    for (const c of real.categories) expect(c.icon).not.toBe('•')
  })

  it('leaves out component swatches, loose letters, and emoji too new to draw', () => {
    const data = emojibaseData as unknown as EmojibaseEntry[]
    const ids = new Set(real.emojis.map((e) => e.id))
    for (const e of data) {
      if (e.group === 2 || e.group == null) expect(ids.has(e.hexcode), e.label).toBe(false)
      if (typeof e.version === 'number' && e.version > MAX_EMOJI_VERSION) expect(ids.has(e.hexcode), e.label).toBe(false)
    }
  })

  it('puts every fantasy pick in its tab — including ones written with a variation selector', () => {
    expect(real.fantasy).toHaveLength(FANTASY_EMOJI.length)
    const chars = real.fantasy.map((id) => char(id)?.replace(/️/g, ''))
    expect(chars).toEqual(FANTASY_EMOJI.map((c) => c.replace(/️/g, '')))
    expect(chars).toContain('🗑')
    expect(chars).toContain('🐐')
  })

  it('finds what people type', () => {
    expect(searchEmojiCatalog(real.emojis, 'goat')[0]?.char).toBe('🐐')
    expect(searchEmojiCatalog(real.emojis, ':fire:')[0]?.char).toBe('🔥')
    expect(searchEmojiCatalog(real.emojis, 'FIRE')[0]?.char).toBe('🔥')
    expect(searchEmojiCatalog(real.emojis, 'clown')[0]?.char).toBe('🤡')
    expect(searchEmojiCatalog(real.emojis, '🔥')[0]?.char).toBe('🔥')
    // A tag, not a name: 🔥 is tagged "lit".
    expect(searchEmojiCatalog(real.emojis, 'lit').map((e) => e.char)).toContain('🔥')
    expect(searchEmojiCatalog(real.emojis, 'zzqxnotanemoji')).toEqual([])
    expect(searchEmojiCatalog(real.emojis, '   ')).toEqual([])
    expect(searchEmojiCatalog(real.emojis, 'face', 5)).toHaveLength(5)
  })
})

describe('the rules, on a fixture', () => {
  const fixture: EmojibaseEntry[] = [
    { hexcode: '1F525', label: 'fire', emoji: '🔥', group: 5, order: 20, version: 0.6, tags: ['lit', 'fire'] },
    { hexcode: '1F600', label: 'grinning face', emoji: '😀', group: 0, order: 1, version: 1 },
    { hexcode: '1F3FB', label: 'light skin tone', emoji: '🏻', group: 2, order: 2, version: 1 },
    { hexcode: '1F1E6', label: 'regional indicator A', emoji: '🇦' },
    { hexcode: '1FAE9', label: 'face with bags under eyes', emoji: '🫩', group: 0, order: 3, version: 16 },
    { hexcode: '1F5D1', label: 'wastebasket', emoji: '🗑️', group: 7, order: 10, version: 0.7 },
  ]
  const c = buildEmojiCatalog(fixture, { '1F525': ['fire', 'flame'], '1F600': 'grinning' })

  it('keeps base emoji in Unicode order, and names each by its shortcode or label', () => {
    expect(c.emojis.map((e) => e.char)).toEqual(['😀', '🗑️', '🔥'])
    expect(c.emojis.find((e) => e.char === '🔥')).toMatchObject({ shortcode: 'fire', category: 'travel' })
    expect(c.emojis.find((e) => e.char === '🗑️')).toMatchObject({ shortcode: 'wastebasket', category: 'objects' })
  })

  it('lets a caller raise the version cap', () => {
    expect(buildEmojiCatalog(fixture, {}, { maxVersion: 16 }).emojis.map((e) => e.char)).toContain('🫩')
  })

  it('indexes tags and extra shortcodes without repeating the name', () => {
    const fire = c.emojis.find((e) => e.char === '🔥')!
    expect(fire.keywords.split(' ')).toEqual(['fire', 'lit', 'flame'])
  })
})
