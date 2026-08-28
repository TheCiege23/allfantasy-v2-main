import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const COMPONENT = fs.readFileSync(
  path.join(process.cwd(), 'components', 'core-app', 'screens', 'Portfolio.tsx'),
  'utf8',
)
const LOADER = fs.readFileSync(
  path.join(process.cwd(), 'lib', 'core-app', 'portfolio.ts'),
  'utf8',
)
const CSS = fs.readFileSync(
  path.join(process.cwd(), 'components', 'core-app', 'af-portfolio.css'),
  'utf8',
)

/** Mirrors leagueMonogram in the component. */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w))
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? name).slice(0, 2).toUpperCase()
}

describe('league artwork reaches the card', () => {
  /*
   * ⚠ `logoUrl` IS NULL ON ALL 115 PRODUCTION LEAGUES and has never been
   * written; `avatarUrl` is populated on 48. Reading the empty column is why no
   * league art has ever appeared anywhere in the app.
   */
  it('selects avatarUrl, not the empty logoUrl', () => {
    expect(LOADER).toContain('avatarUrl: true')
    expect(LOADER).not.toContain('logoUrl: true')
  })

  it('carries it onto the row payload', () => {
    expect(LOADER).toMatch(/avatarUrl: t\.league\?\.avatarUrl \?\? null/)
    expect(LOADER).toMatch(/avatarUrl: string \| null/)
  })

  /* There was no artwork element at all — nothing would have drawn it. */
  it('renders an artwork element on the row', () => {
    expect(COMPONENT).toContain('af-pf-row-art')
    expect(COMPONENT).toContain('af-pf-art-img')
    expect(COMPONENT).toContain('l.avatarUrl')
  })
})

describe('the missing-avatar case is the common one', () => {
  /*
   * ⚠ 67 OF 115 LEAGUES HAVE NO AVATAR, so a broken-image glyph on more than
   * half the rows would read as the page being broken. The monogram is the base
   * layer and is always painted.
   */
  it('always paints a monogram beneath the image', () => {
    const artAt = COMPONENT.indexOf('af-pf-row-art')
    const block = COMPONENT.slice(artAt, artAt + 700)
    const markAt = block.indexOf('af-pf-art-mark')
    const imgAt = block.indexOf('af-pf-art-img')
    expect(markAt).toBeGreaterThan(-1)
    /* Mark first: the image is layered on top of it, not swapped for it. */
    expect(markAt).toBeLessThan(imgAt)
  })

  it('removes a broken image so the monogram shows through', () => {
    expect(COMPONENT).toMatch(/onError=\{\(e\) => \{\s*e\.currentTarget\.remove\(\)/)
  })

  it('marks the badge decorative for screen readers', () => {
    const artAt = COMPONENT.indexOf('af-pf-row-art')
    expect(COMPONENT.slice(artAt - 60, artAt + 40)).toContain('aria-hidden')
    expect(COMPONENT).toMatch(/className="af-pf-art-img"[\s\S]{0,120}alt=""/)
  })
})

describe('leagueMonogram', () => {
  it.each([
    ['Beta 1 Zombie League', 'BZ'],
    ['KBFL', 'KB'],
    ['World Football League', 'WF'],
    ['Four Horsemen All-Stars 2023', 'FH'],
  ])('reduces %s to %s', (name, expected) => {
    expect(monogram(name)).toBe(expected)
  })

  /* A digit is not an initial — "Beta 1 Zombie" must not become "B1". */
  it('skips numeric words when picking initials', () => {
    expect(monogram('Beta 1 Zombie League')).not.toContain('1')
  })
})

describe('layout', () => {
  /*
   * A fractional artwork column would let a long league name squeeze the badge
   * into an ellipse, and a round mark that is not round reads as broken.
   */
  it('gives the badge a fixed column', () => {
    expect(CSS).toMatch(/grid-template-columns:\s*32px/)
    expect(CSS).toMatch(/\.af-pf-row-art\s*\{[\s\S]*?width:\s*32px/)
  })

  it('crops the image rather than distorting it', () => {
    expect(CSS).toMatch(/\.af-pf-art-img\s*\{[\s\S]*?object-fit:\s*cover/)
  })
})
