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

import { toNewsItems } from '@/lib/workers/x-news-ingestion'
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

  it('tolerates a result with no citations', () => {
    const [item] = toNewsItems(ok({ citations: [] }), ctx)
    expect(item.sourceUrl).toBeNull()
    expect(item.body).not.toContain('Sources consulted')
  })
})
