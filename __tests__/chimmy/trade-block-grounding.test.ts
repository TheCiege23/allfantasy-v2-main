// @vitest-environment node
/**
 * What Chimmy is told about a league's trade block.
 *
 * 🛑 An empty list must never read as "nobody is available": Sleeper does not share its own block
 * (measured 2026-09-17), so the only listings are the ones managers marked in AllFantasy, and the
 * text has to say so every time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readTradeBlock = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/trade-block/importedTradeBlock', async (orig) => ({
  ...(await orig<typeof import('@/lib/trade-block/importedTradeBlock')>()),
  readTradeBlock: (...a: unknown[]) => readTradeBlock(...a),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildTradeBlockContext, renderTradeBlockContext } from '@/lib/chimmy/tradeBlockGrounding'
import { tradeBlockSupport } from '@/lib/trade-block/importedTradeBlock'

const SLEEPER = tradeBlockSupport('sleeper')

const listing = (over: Record<string, unknown> = {}) => ({
  sleeperId: '10229',
  playerName: 'Rashee Rice',
  position: 'WR',
  nflTeam: 'KC',
  rosterId: 7,
  teamName: 'Gridiron Vultures',
  ownerName: 'Jordan',
  since: '2026-09-15T12:00:00.000Z',
  ...over,
})

/* A block body: `mockReset()` returns the mock, and a function returned from beforeEach runs as teardown. */
beforeEach(() => {
  readTradeBlock.mockReset()
})

describe('renderTradeBlockContext', () => {
  it('lists each player with who listed him and when, then the Sleeper caveat', () => {
    const text = renderTradeBlockContext({
      support: SLEEPER,
      listings: [listing(), listing({ playerName: 'Kyren Williams', position: 'RB', nflTeam: 'LAR', teamName: null })],
    })
    expect(text.split('\n')).toEqual([
      'Trade block (marked in AllFantasy), 2 players:',
      '- Rashee Rice (WR, KC) — listed by Gridiron Vultures, 2026-09-15',
      '- Kyren Williams (RB, LAR) — listed by Jordan, 2026-09-15',
      SLEEPER.note,
    ])
  })

  it('one listing is singular, and a player with no position or team shows no empty brackets', () => {
    const text = renderTradeBlockContext({
      support: SLEEPER,
      listings: [listing({ position: null, nflTeam: null, teamName: null, ownerName: null })],
    })
    expect(text).toContain('1 player:')
    expect(text).toContain('- Rashee Rice — listed by a manager in this league, 2026-09-15')
  })

  it('🛑 empty says what it cannot see, and forbids "nobody is available"', () => {
    const text = renderTradeBlockContext({ support: SLEEPER, listings: [] })
    expect(text).toContain('No players are marked on the trade block in AllFantasy for this league.')
    expect(text).toContain(SLEEPER.note)
    expect(text).toContain('Do not say nobody is available')
  })

  it('an unsupported platform says so and asks for no guessing', () => {
    const espn = tradeBlockSupport('espn')
    expect(renderTradeBlockContext({ support: espn, listings: [] })).toBe(
      `${espn.note} Say so plainly; do not guess who is on the trade block.`,
    )
  })

  it('an unreadable league is unknown, not empty', () => {
    expect(renderTradeBlockContext(null)).toMatch(/could not be read.*do not guess/)
  })
})

describe('buildTradeBlockContext', () => {
  it('reads the given league', async () => {
    readTradeBlock.mockResolvedValue({ support: SLEEPER, listings: [listing()] })
    const text = await buildTradeBlockContext('lg-1')
    expect(readTradeBlock).toHaveBeenCalledWith('lg-1')
    expect(text).toContain('Rashee Rice')
  })

  it('a read that throws is the unreadable sentence, not an error', async () => {
    readTradeBlock.mockRejectedValue(new Error('down'))
    expect(await buildTradeBlockContext('lg-1')).toMatch(/could not be read/)
  })
})
