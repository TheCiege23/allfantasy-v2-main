/**
 * The Salary Cap banner carries no money figures (2026-11-07, Salary Cap audit item 1). The artwork had a cap reading
 * baked into it — "231.6 / 250" on the dial and a ticker strip of "CAP 250.0 · SPACE +18.4 · DEAD -6.0 · TAG 41.2 ·
 * ROLL +12.0 · EXT 3Y · FA BID 9.5" — drawn directly behind every league's real cap space. On a screen whose job is
 * money, invented numbers next to real ones are worse than none. The banner is illustration only; the hero and the
 * cards carry the league's actual figures.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const svg = readFileSync('public/specialty/salary/banner.svg', 'utf8')

describe('salary banner artwork', () => {
  it('has no text elements at all', () => {
    expect(svg.match(/<text\b[^>]*>[^<]*<\/text>/g) ?? []).toEqual([])
  })
  it('spells no number that could read as a cap figure', () => {
    const stripped = svg.replace(/<[^>]*>/g, ' ')
    expect(stripped).not.toMatch(/\d+\.\d|\b(CAP|SPACE|DEAD|TAG|ROLL|EXT|FA BID)\b/)
  })
  it('is still a well-formed SVG', () => {
    expect(svg.trim().startsWith('<svg')).toBe(true)
    expect(svg.trim().endsWith('</svg>')).toBe(true)
    expect((svg.match(/<g\b/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length)
  })
})
