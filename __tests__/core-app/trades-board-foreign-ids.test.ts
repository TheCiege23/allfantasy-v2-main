// @vitest-environment node
/**
 * The Trades board names, prices and grades by Sleeper id. An ESPN trade printed "Player 4432620"
 * (production audit 2026-09-28), so foreign ids are translated to Sleeper ids first — and one that
 * does not translate is namespaced, never left bare where it could collide with a real Sleeper id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ identities: [] as Array<Record<string, unknown>> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findMany: vi.fn(async (args: { where: Record<string, { in?: string[] } | string> }) => {
        const [column, cond] = Object.entries(args.where).find(([k]) => k !== 'sport')!
        const ids = (cond as { in: string[] }).in
        return h.identities.filter((r) => ids.includes(String(r[column])) && r.sport === args.where.sport)
      }),
    },
  },
}))

import { translateForeignTrades } from '@/lib/core-app/tradesBoard'
import { translateProviderIdsToSleeper } from '@/lib/player-identity/providerToSleeperIds'

beforeEach(() => {
  h.identities = [
    { espnId: '4432620', sleeperId: '11604', canonicalName: 'Brock Bowers', position: 'TE', currentTeam: 'LV', sport: 'NFL' },
    { espnId: '5000', sleeperId: null, canonicalName: 'Practice Squad Guy', position: 'WR', currentTeam: 'DEN', sport: 'NFL' },
    // One ESPN id claimed by two identities: must stay unresolved.
    { espnId: '777', sleeperId: '1', canonicalName: 'Josh Allen', position: 'QB', currentTeam: 'BUF', sport: 'NFL' },
    { espnId: '777', sleeperId: '2', canonicalName: 'Josh Allen', position: 'LB', currentTeam: 'JAX', sport: 'NFL' },
  ]
})

describe('translateProviderIdsToSleeper', () => {
  it('maps a platform id to its Sleeper id, keeps the name when there is none, refuses a double match', async () => {
    const out = await translateProviderIdsToSleeper('espn', ['4432620', '5000', '777', 'nope'], 'nfl')
    expect(out.get('4432620')).toMatchObject({ sleeperId: '11604', name: 'Brock Bowers' })
    expect(out.get('5000')).toMatchObject({ sleeperId: null, name: 'Practice Squad Guy' })
    expect(out.has('777')).toBe(false)
    expect(out.has('nope')).toBe(false)
  })

  it('does nothing for Sleeper, whose ids are already the board’s id space', async () => {
    expect((await translateProviderIdsToSleeper('sleeper', ['4432620'], 'nfl')).size).toBe(0)
  })
})

describe('translateForeignTrades', () => {
  const trade = (platform: string, given: string[], received: string[]) => ({ platform, sport: 'nfl', playersGiven: given, playersReceived: received })

  it('puts an ESPN trade into Sleeper ids, and namespaces what does not translate', async () => {
    const { trades, foreignLabel } = await translateForeignTrades([trade('espn', ['4432620', '5000'], ['777', '999'])])
    expect(trades[0].playersGiven).toEqual(['11604', 'foreign:espn:5000'])
    expect(trades[0].playersReceived).toEqual(['foreign:espn:777', 'foreign:espn:999'])
    expect(foreignLabel.get('foreign:espn:5000')).toMatchObject({ name: 'Practice Squad Guy', position: 'WR' })
    expect(foreignLabel.get('foreign:espn:999')?.name).toBe('Unrecognised ESPN player')
    // The ambiguous id is not guessed between the two Josh Allens.
    expect(foreignLabel.get('foreign:espn:777')?.name).toBe('Unrecognised ESPN player')
  })

  it('never leaves a foreign id bare, where it could be read as a real Sleeper id', async () => {
    const { trades } = await translateForeignTrades([trade('espn', ['1'], ['2'])])
    // "1" and "2" ARE Sleeper ids in this fixture — as ESPN ids they translate to nothing.
    expect(trades[0].playersGiven).toEqual(['foreign:espn:1'])
    expect(trades[0].playersReceived).toEqual(['foreign:espn:2'])
  })

  it('leaves Sleeper trades untouched', async () => {
    const sleeper = trade('sleeper', ['4432620'], ['1'])
    const { trades } = await translateForeignTrades([sleeper])
    expect(trades[0]).toBe(sleeper)
  })
})
