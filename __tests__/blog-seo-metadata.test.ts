/**
 * buildBlogSEO — search titles and descriptions for blog articles.
 *
 * Measured on production 2026-11-15, the day the first posts went live: the builder ignored each
 * article's stored seoTitle/seoDescription and cut with `.slice`, so the basketball post's title read
 * "…Pick a Fantasy Basketball Forma | AllFantasy Blog" and the CFP description lost its last words.
 * The two real strings are the fixtures here.
 */
import { describe, expect, it } from 'vitest'
import { buildBlogSEO, fitToWords } from '@/lib/automated-blog/BlogSEOMetadataBuilder'

const BASKETBALL_TITLE = 'Points or Categories? How to Pick a Fantasy Basketball Format' // 61 chars
const CFP_EXCERPT =
  "Twelve teams, eleven games, and one bracket that locks before the first kickoff. Here's how the College Football Playoff bracket works and how to fill yours out." // 161 chars

const base = { excerpt: null, body: '', sport: 'NBA', category: 'weekly_strategy', slug: 'x' }

describe('fitToWords', () => {
  it('leaves text that fits alone, and cuts longer text at a word with an ellipsis', () => {
    expect(fitToWords('Short title', 60)).toBe('Short title')
    expect(fitToWords('a'.repeat(60), 60)).toBe('a'.repeat(60))
    const cut = fitToWords(BASKETBALL_TITLE, 60)
    expect(cut.length).toBeLessThanOrEqual(60)
    expect(cut).toBe('Points or Categories? How to Pick a Fantasy Basketball…')
    expect(cut).not.toMatch(/Forma/)
  })

  it('drops a trailing comma or dash before the ellipsis', () => {
    expect(fitToWords('one two three, four five six seven', 20)).toBe('one two three…')
  })
})

describe('buildBlogSEO', () => {
  it('uses the stored SEO title and description as written', () => {
    const seo = buildBlogSEO({
      ...base,
      title: BASKETBALL_TITLE,
      seoTitle: 'Fantasy Basketball: Points vs. Categories Explained | AllFantasy',
      seoDescription: 'Points, 9-cat, 8-cat or rotisserie? How each format works.',
    })
    expect(seo.title).toBe('Fantasy Basketball: Points vs. Categories Explained | AllFantasy')
    expect(seo.description).toBe('Points, 9-cat, 8-cat or rotisserie? How each format works.')
    // The social card keeps the article's own headline, uncut.
    expect(seo.ogTitle).toBe(BASKETBALL_TITLE)
  })

  it('without a stored title, cuts the article title at a word — never "Forma"', () => {
    const seo = buildBlogSEO({ ...base, title: BASKETBALL_TITLE })
    expect(seo.title).toBe('Points or Categories? How to Pick a Fantasy Basketball… | AllFantasy Blog')
  })

  it('without a stored description, cuts the excerpt at a word', () => {
    const seo = buildBlogSEO({ ...base, title: 't', excerpt: CFP_EXCERPT })
    expect(seo.description.length).toBeLessThanOrEqual(160)
    expect(seo.description.endsWith('…')).toBe(true)
    expect(seo.description).toMatch(/ how to fill yours…$/)
  })

  it('falls back to the body as plain text, with no markdown left in it', () => {
    const seo = buildBlogSEO({
      ...base,
      title: 't',
      body: '## Set it up\n\nStart from the [bracket hub](/brackets) and **share the code**.\n\n- one\n- two',
    })
    expect(seo.description).toBe('Set it up Start from the bracket hub and share the code. one two')
  })

  it('canonical is the www article URL', () => {
    expect(buildBlogSEO({ ...base, title: 't', slug: 'guillotine-league-strategy' }).canonical).toBe(
      'https://www.allfantasy.ai/blog/guillotine-league-strategy',
    )
  })
})
