// @vitest-environment node
/**
 * lib/workers/x-news-ingestion.ts — the search-result → PlayerNewsRecord mapping.
 *
 * This is the seam that decides whether a search result is visible to Decision
 * OS at all. Its reader (lib/decision-os/world/port.ts) matches `playerName`
 * against roster names with an exact case-insensitive `in` list and no fuzzy
 * fallback, so anything that mangles the name silently produces rows that are
 * written, queryable, and never read.
 */
import { describe, it, expect, vi } from 'vitest'

// lib/prisma builds its client at module scope and throws without DATABASE_URL,
// so importing the worker at all requires this even though `toNewsItems` is pure
// and never touches the database.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { readFileSync } from 'node:fs'
import { classifyImpact, stripInlineCitations, toNewsItems } from '@/lib/workers/x-news-ingestion'
import type { XNewsResult } from '@/lib/ai/xNewsSearch'

const SEARCHED_AT = '2026-08-27T15:00:00.000Z'

const ok = (over: Partial<Extract<XNewsResult, { ok: true }>> = {}) =>
  ({
    ok: true,
    kind: 'injury',
    summary: 'Jeanty is dealing with an ankle injury but is on the mend.',
    bullets: [
      'Adam Schefter: Raiders HC said injured RB Ashton Jeanty is on the mend.',
      'Ian Rapoport: Week 1 status still up in the air.',
    ],
    citations: [
      { label: 'x.com/i/status/1', url: 'https://x.com/i/status/1' },
      { label: 'x.com/i/status/2', url: 'https://x.com/i/status/2' },
    ],
    sourcesUsed: 2,
    empty: false,
    searchedAt: SEARCHED_AT,
    ...over,
  }) as Extract<XNewsResult, { ok: true }>

const ctx = { sport: 'NFL', name: 'Ashton Jeanty', team: 'LV' }

describe('classifyImpact', () => {
  describe('the four keywords that were dead until 2026-08-27', () => {
    // Each carried a capital and was tested with .includes() against an
    // already-lowercased string, so none could ever fire. 'ACL' never matched
    // once; torn-ACL reports only scored high because 'torn' was listed too.
    it('matches "placed on IR"', () => {
      expect(classifyImpact('Smith was placed on IR this morning.')).toBe('high')
    })
    it('matches a bare ACL mention with no other high keyword', () => {
      expect(classifyImpact('Imaging confirmed an ACL issue.')).toBe('high')
    })
    it('matches TJS', () => {
      expect(classifyImpact('He is headed for TJS.')).toBe('high')
    })
    it('matches DNP', () => {
      expect(classifyImpact('Listed as DNP on Wednesday.')).toBe('medium')
    })
  })

  describe('reporter prose, which is what x_search actually returns', () => {
    // Both of these scored low on the live run that prompted this fix.
    it('treats "on the mend" as meaningful rather than noise', () => {
      expect(classifyImpact('Raiders HC said injured RB Ashton Jeanty is on the mend.')).toBe('medium')
    })
    it('treats an up-in-the-air Week 1 status as meaningful', () => {
      expect(classifyImpact('Good news on the ankle, though Week 1 status is up in the air.')).toBe('medium')
    })
  })

  it('still scores the official designations it always did', () => {
    expect(classifyImpact('Ruled out for Sunday.')).toBe('high')
    expect(classifyImpact('Listed as questionable.')).toBe('medium')
    expect(classifyImpact('Caught four passes in the win.')).toBe('low')
  })

  it('does not let a bare "ir" substring match ordinary words', () => {
    // Without word boundaries this scores high, because "first" contains "ir".
    expect(classifyImpact('He led the team in first downs and third-down conversions.')).toBe('low')
  })

  it('every keyword is lowercase, or it silently cannot match', () => {
    // Structural guard: the original bug was invisible to behaviour tests for
    // any keyword nobody happened to write a case for.
    const src = readFileSync('lib/workers/x-news-ingestion.ts', 'utf8')
    const block = src.slice(
      src.indexOf('const HIGH_IMPACT_KEYWORDS'),
      src.indexOf('const HIGH_IMPACT_ACRONYMS'),
    )
    const offenders = [...block.matchAll(/'([^']+)'/g)]
      .map((m) => m[1]!)
      .filter((kw) => kw !== kw.toLowerCase())
    expect(offenders, `keywords with capitals can never match: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('stripInlineCitations', () => {
  it('removes the numeric footnote form', () => {
    expect(stripInlineCitations('On the mend.[[2]](https://x.com/a/status/1)')).toBe('On the mend.')
  })

  it('keeps the label of a normal markdown link but drops the url', () => {
    expect(stripInlineCitations('See [Schefter](https://x.com/a/status/1) for detail')).toBe(
      'See Schefter for detail',
    )
  })

  it('leaves text with no links untouched', () => {
    expect(stripInlineCitations('Ruled out for Sunday.')).toBe('Ruled out for Sunday.')
  })
})

describe('toNewsItems', () => {
  it('emits one record per bullet', () => {
    expect(toNewsItems(ok(), ctx)).toHaveLength(2)
  })

  it('carries the searched name through verbatim, not a model-extracted one', () => {
    // The reason this path exists at all — port.ts joins on an exact name match.
    for (const item of toNewsItems(ok(), ctx)) {
      expect(item.playerName).toBe('Ashton Jeanty')
    }
  })

  it('uses the bullet as the headline and keeps the summary as context', () => {
    const [first] = toNewsItems(ok(), ctx)
    expect(first.headline).toBe('Adam Schefter: Raiders HC said injured RB Ashton Jeanty is on the mend.')
    expect(first.body).toContain('on the mend')
  })

  it('puts citation urls in the body, since PlayerNewsRecord has no url column', () => {
    const [first] = toNewsItems(ok(), ctx)
    expect(first.body).toContain('https://x.com/i/status/1')
    expect(first.body).toContain('https://x.com/i/status/2')
  })

  it('attaches every citation to every record rather than splitting them per claim', () => {
    // Not laziness: annotations come back with start_index/end_index both 0, so
    // there is no mapping from a post to the bullet it supports. Splitting them
    // would invent an attribution the payload cannot justify.
    const items = toNewsItems(ok(), ctx)
    for (const item of items) {
      expect(item.body).toContain('https://x.com/i/status/1')
      expect(item.body).toContain('https://x.com/i/status/2')
    }
  })

  it('truncates the headline to the VarChar(256) column width', () => {
    const [item] = toNewsItems(ok({ bullets: ['x'.repeat(400)] }), ctx)
    expect(item.headline).toHaveLength(256)
  })

  it('classifies an injury bullet deterministically, without asking the model', () => {
    const [item] = toNewsItems(ok(), ctx)
    expect(item.category).toBe('injury')
    expect(['high', 'medium', 'low']).toContain(item.impact)
  })

  it('falls back to a single record when the model returned prose instead of bullets', () => {
    const items = toNewsItems(ok({ bullets: [], summary: 'Ruled out for Sunday.' }), ctx)
    expect(items).toHaveLength(1)
    expect(items[0].headline).toBe('Ruled out for Sunday.')
  })

  it('emits nothing when there is neither a summary nor bullets', () => {
    expect(toNewsItems(ok({ bullets: [], summary: '' }), ctx)).toEqual([])
  })

  it('sets publishedAt to the search time, which is NOT when the post was made', () => {
    // x_search annotations carry no timestamp. Anything rendering this as
    // "reported at" is wrong, and this test is where that gets noticed.
    const [item] = toNewsItems(ok(), ctx)
    expect(item.publishedAt.toISOString()).toBe(SEARCHED_AT)
  })

  it('marks the source distinctly from the legacy web_search sweep', () => {
    // The old path writes 'x_grok_search' and never actually queried X.
    const [item] = toNewsItems(ok(), ctx)
    expect(item.source).toBe('x_search')
  })

  it('strips the inline markdown citations Grok embeds mid-sentence', () => {
    // The exact shape a live run produced on 2026-08-27. Stored verbatim this
    // put raw markdown in the headline, truncated mid-URL at the column width.
    const bullet =
      'Adam Schefter reports Raiders HC said Ashton Jeanty is “on the mend.”[[2]](https://x.com/AdamSchefter/status/2092371465660236156)'
    const [item] = toNewsItems(ok({ bullets: [bullet] }), ctx)
    expect(item.headline).toBe('Adam Schefter reports Raiders HC said Ashton Jeanty is “on the mend.”')
    expect(item.headline).not.toContain('](')
    expect(item.headline).not.toContain('http')
  })

  it('keeps the citation urls in the body even after stripping them from the text', () => {
    const [item] = toNewsItems(ok({ bullets: ['Reported.[[1]](https://x.com/i/status/1)'] }), ctx)
    expect(item.body).toContain('https://x.com/i/status/1')
  })

  it('drops a bullet that was nothing but a citation link', () => {
    const items = toNewsItems(ok({ bullets: ['[[1]](https://x.com/i/status/1)'], summary: '' }), ctx)
    expect(items).toEqual([])
  })

  it('tolerates a result with no citations', () => {
    const [item] = toNewsItems(ok({ citations: [] }), ctx)
    expect(item.sourceUrl).toBeNull()
    expect(item.body).not.toContain('Sources consulted')
  })
})
