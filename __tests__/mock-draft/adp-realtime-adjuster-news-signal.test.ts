/**
 * 🛑 The mock-draft ADP adjuster's injury pattern had no word boundaries, so "their", "first",
 * "Kirk", "without" and "retirement" each added +10 ADP labelled "Negative injury/availability
 * signal" (production 2026-10-12: 26 named NFL news rows hit in the 7-day window, 8 for real). And
 * news bound to a player by NAME alone, so a story about one Justin Jefferson moved the other's ADP.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { bindNewsToEntries, computeNewsDelta } from '@/lib/mock-draft/adp-realtime-adjuster'

const INJURY = 'Negative injury/availability signal'
const SHORT = 'Short-term risk signal'

describe('computeNewsDelta — risk words are whole words', () => {
  it.each([
    'Kirk Cousins makes his first start of the season',
    'Their offense looked sharp without the starter',
    'Retirement talk follows the veteran into camp',
    'Rookie breakout continues in Week 5',
    'Coach praises unlimited upside after setbacks earlier',
  ])('no risk signal: %s', (text) => {
    const { reasons } = computeNewsDelta(text)
    expect(reasons).not.toContain(INJURY)
    expect(reasons).not.toContain(SHORT)
  })

  it.each([
    ['Jones ruled out for Sunday', INJURY],
    ['Placed on IR with an ankle sprain', INJURY],
    ['Season-ending knee injury confirmed', INJURY],
    ['Listed as questionable with a hamstring', SHORT],
    ['Limited in practice Wednesday', SHORT],
  ])('risk signal: %s', (text, reason) => {
    expect(computeNewsDelta(text).reasons).toContain(reason)
  })
})

describe('bindNewsToEntries — a name is not an identity', () => {
  const injury = { title: 'Justin Jefferson ruled out', content: '' }

  it('two namesakes in the pool: the row binds to the one its team names', () => {
    const entries = [
      { name: 'Justin Jefferson', team: 'MIN' },
      { name: 'Justin Jefferson', team: 'CLE' },
    ]
    const out = bindNewsToEntries([{ ...injury, playerName: 'Justin Jefferson', team: 'CLE', teams: ['CLE', 'PIT'] }], entries)
    expect([...out.keys()]).toEqual([1])
  })

  it('two namesakes and no team on the row: refused', () => {
    const entries = [
      { name: 'Justin Jefferson', team: 'MIN' },
      { name: 'Justin Jefferson', team: 'CLE' },
    ]
    expect(bindNewsToEntries([{ ...injury, playerName: 'Justin Jefferson' }], entries).size).toBe(0)
  })

  it("the pool's only Justin Jefferson is not moved by a story naming another team", () => {
    const entries = [{ name: 'Justin Jefferson', team: 'MIN' }]
    expect(bindNewsToEntries([{ ...injury, playerName: 'Justin Jefferson', team: 'CLE', teams: ['CLE'] }], entries).size).toBe(0)
  })

  it('team aliases fold (WSH = WAS)', () => {
    const entries = [{ name: 'Terry McLaurin', team: 'WSH' }]
    const out = bindNewsToEntries([{ title: 'McLaurin out', playerName: 'Terry McLaurin', team: 'WAS', teams: [] }], entries)
    expect(out.get(0)?.reasons).toContain(INJURY)
  })

  it('unique name, no team on the row: binds by name as before', () => {
    const entries = [{ name: 'Puka Nacua', team: 'LAR' }]
    const out = bindNewsToEntries([{ title: 'Nacua ruled out', playerName: 'Puka Nacua' }], entries)
    expect(out.get(0)?.delta).toBe(10)
  })
})
