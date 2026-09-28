import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn() }))

import { sendChimmyMessage } from '@/lib/chimmy-chat/ChimmyChatService'
import { resetChimmyActionCardsForTest, subscribeChimmyActionCards, type ChimmyActionCard } from '@/lib/chimmy-chat/actionCards'

/**
 * How a confirm card gets from an answer to the page: `sendChimmyMessage` reads it off `meta`,
 * keeps it on the returned meta, and publishes it to the in-page store the tray renders from.
 * Publishing SHOWS a card; nothing here confirms anything.
 */

const CARD = {
  actionId: 'a1',
  kind: 'trade',
  token: 'signed.token-value',
  title: 'Trade offer to Jordan',
  league: { id: 'L1', name: 'KBFL', sport: 'NFL' },
  week: 4,
  season: 2026,
  expiresAt: '2099-01-01T00:00:00.000Z',
  trade: { partnerTeamName: 'Jordan', youGive: [{ name: 'A B', position: 'WR', team: 'KC' }], youGet: [{ name: 'C D', position: 'RB', team: 'SF' }], reviewNote: null },
  warnings: [],
}

beforeEach(() => {
  resetChimmyActionCardsForTest()
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ result: 'Card is below.', meta: { toolsUsed: ['propose_trade'], actionCards: [CARD, { junk: true }] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch
})

describe('sendChimmyMessage and action cards', () => {
  it('keeps valid cards on the meta and publishes them to the page — and makes exactly one request', async () => {
    const seen: ChimmyActionCard[][] = []
    subscribeChimmyActionCards((cards) => seen.push(cards))
    const result = await sendChimmyMessage({ message: 'send the trade', promptForTokenSpend: false })
    expect(result.meta?.actionCards).toEqual([CARD])
    expect(seen.at(-1)).toEqual([CARD])
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe('/api/chimmy')
  })
})
