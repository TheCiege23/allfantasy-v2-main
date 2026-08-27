// @vitest-environment node
/**
 * lib/ai/xNewsSearch.ts — the two pure functions that decide what gets searched.
 *
 * `resolveHandles` is the allowlist boundary, where an empty override and an
 * unset one mean opposite things; `buildQuery` is what the model is actually
 * asked. Both are string-and-env logic with no DOM, so this opts out of the
 * suite-wide jsdom default: standing jsdom up costs ~34s against ~30ms of
 * assertions, which was most of this file's runtime.
 */
import { describe, it, expect } from 'vitest'
import { resolveHandles, buildQuery, toCitations, type XNewsKind } from '@/lib/ai/xNewsSearch'

const env = (over: Record<string, string | undefined> = {}) => over as unknown as NodeJS.ProcessEnv

describe('resolveHandles', () => {
  it('falls back to the built-in list for a known sport', () => {
    const handles = resolveHandles('NFL', env())
    expect(handles.length).toBeGreaterThan(0)
    expect(handles).toContain('AdamSchefter')
  })

  it('is case-insensitive on sport', () => {
    expect(resolveHandles('nfl', env())).toEqual(resolveHandles('NFL', env()))
  })

  it('returns an empty list for an unknown sport rather than throwing', () => {
    expect(resolveHandles('CRICKET', env())).toEqual([])
  })

  it('honours a per-sport env override', () => {
    const e = env({ X_SEARCH_HANDLES_NFL: 'HandleOne,HandleTwo' })
    expect(resolveHandles('NFL', e)).toEqual(['HandleOne', 'HandleTwo'])
  })

  it('strips @ prefixes and whitespace from overrides', () => {
    const e = env({ X_SEARCH_HANDLES_NBA: ' @Alpha , Beta ,, @Gamma ' })
    expect(resolveHandles('NBA', e)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('treats an explicitly empty override as "search all of X"', () => {
    // Distinct from unset: this is how a caller widens past a stale list.
    const e = env({ X_SEARCH_HANDLES_NFL: '' })
    expect(resolveHandles('NFL', e)).toEqual([])
  })
})

describe('buildQuery', () => {
  const kinds: XNewsKind[] = ['injury', 'transaction', 'depth_chart', 'general']

  it('produces a distinct, non-empty query for every kind', () => {
    const queries = kinds.map((kind) => buildQuery({ kind, subject: 'Player X' }))
    expect(new Set(queries).size).toBe(kinds.length)
    for (const q of queries) expect(q.length).toBeGreaterThan(10)
  })

  it('always includes the subject', () => {
    for (const kind of kinds) {
      expect(buildQuery({ kind, subject: 'Player X' })).toContain('Player X')
    }
  })

  it('includes the team when supplied', () => {
    const q = buildQuery({ kind: 'injury', subject: 'Player X', teamName: 'Team Y' })
    expect(q).toContain('Player X')
    expect(q).toContain('Team Y')
  })

  it('omits team formatting when the team is null or undefined', () => {
    expect(buildQuery({ kind: 'injury', subject: 'Player X', teamName: null })).not.toContain('(')
    expect(buildQuery({ kind: 'injury', subject: 'Player X' })).not.toContain('(')
  })

  it('asks about designations for injury and roster moves for transaction', () => {
    expect(buildQuery({ kind: 'injury', subject: 'P' }).toLowerCase()).toMatch(/injury|inactive|practice/)
    expect(buildQuery({ kind: 'transaction', subject: 'P' }).toLowerCase()).toMatch(/signing|trade|waiver|release/)
  })
})

describe('toCitations', () => {
  /**
   * The shape xAI actually returns, captured from two live responses on
   * 2026-08-27: `title` is a verbatim copy of `url`, and both offsets are 0.
   * Fabricating a helpful `title` here would test a payload we never receive.
   */
  const live = (url: string) => ({ type: 'url_citation', url, title: url, start_index: 0, end_index: 0 })

  it('ignores a title that merely repeats the url', () => {
    // The regression this file exists to prevent. A copied title is truthy, so
    // it beat the `||` fallback and every citation rendered as a full
    // "https://x.com/i/status/2092371465660236156". Nothing threw and no test
    // failed — it took two live calls and a --raw dump to notice.
    const [c] = toCitations([live('https://x.com/i/status/2092371465660236156')])
    expect(c.label).toBe('x.com/i/status/2092371465660236156')
    expect(c.url).toBe('https://x.com/i/status/2092371465660236156')
  })

  it('keeps a title that carries information the url does not', () => {
    const [c] = toCitations([{ type: 'url_citation', url: 'https://x.com/i/status/1', title: 'Schefter on Jeanty' }])
    expect(c.label).toBe('Schefter on Jeanty')
  })

  it('falls back to the stripped url when the title is absent or blank', () => {
    expect(toCitations([{ type: 'url_citation', url: 'https://x.com/i/status/1' }])[0].label).toBe('x.com/i/status/1')
    expect(toCitations([{ url: 'https://x.com/i/status/2', title: '   ' }])[0].label).toBe('x.com/i/status/2')
  })

  it('dedupes by url, keeping first-seen order', () => {
    const cites = toCitations([live('https://x.com/a'), live('https://x.com/b'), live('https://x.com/a')])
    expect(cites.map((c) => c.url)).toEqual(['https://x.com/a', 'https://x.com/b'])
  })

  it('drops annotations with no usable url rather than emitting a blank label', () => {
    expect(toCitations([{ type: 'url_citation' }, { url: '   ' }])).toEqual([])
  })

  it('caps the fallback label without truncating the url itself', () => {
    // The label is display text; the href must stay whole or the link breaks.
    const long = `https://x.com/i/status/${'9'.repeat(200)}`
    const [c] = toCitations([{ url: long }])
    expect(c.label).toHaveLength(80)
    expect(c.url).toBe(long)
  })
})
