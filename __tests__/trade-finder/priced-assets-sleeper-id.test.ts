/**
 * `/api/trade-finder` prices every rostered skill player from FantasyCalc. It holds the Sleeper id
 * and FantasyCalc rows carry one, yet it matched on the bare name — so a rostered namesake took a
 * star's value (FantasyCalc's normalizer keys "Kenneth Walker III" and "Kenneth Walker" alike),
 * and a renamed player matched nothing at all.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))

import { buildPricedAssetsByRoster } from '@/app/api/trade-finder/route'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

const fc = (name: string, position: string, sleeperId: string, value: number, team = 'KC') =>
  ({
    player: { id: 1, name, mflId: '', sleeperId, position, maybeTeam: team, maybeAge: 26 },
    value,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 0,
  }) as unknown as FantasyCalcPlayer

describe('trade-finder buildPricedAssetsByRoster — FantasyCalc binding', () => {
  it('binds by Sleeper id, and refuses a namesake at another position', async () => {
    const allPlayers = {
      '4634': { full_name: 'Kenneth Walker', position: 'WR', team: null },
      '8151': { full_name: 'Kenneth Walker III', position: 'RB', team: 'KC' },
      '5848': { full_name: 'Hollywood Brown', position: 'WR', team: 'KC' },
    }
    const fcPlayers = [
      fc('Kenneth Walker III', 'RB', '8151', 6000),
      // Same Sleeper id under the name FantasyCalc uses: only the id can find him.
      fc('Marquise Brown', 'WR', '5848', 2500),
    ]
    const out = await buildPricedAssetsByRoster(
      [{ roster_id: 1, players: ['4634', '8151', '5848'], starters: [] }],
      allPlayers,
      fcPlayers,
      false,
    )
    expect(out['1']!.map((a) => [a.assetId, a.value])).toEqual([
      ['8151', 6000],
      ['5848', 2500],
    ])
  })
})
