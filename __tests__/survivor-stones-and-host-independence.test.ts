/**
 * The stones draw is reproducible and order-independent; an "independent host" exists only when the
 * commissioner does not play. Together they keep an exactly-tied council from stalling a league.
 */
import { describe, expect, it, vi } from 'vitest'

import { drawSurvivorStones } from '@/lib/survivor/survivorStones'
import { hasIndependentSurvivorHost } from '@/lib/survivor/survivorHostIndependence'

describe('drawSurvivorStones', () => {
  it('draws the same stone for the same council whatever order the candidates arrive in', () => {
    const a = drawSurvivorStones(['u-c', 'u-a', 'u-b'], 'survivor-stones:L:C:7')
    const b = drawSurvivorStones(['u-b', 'u-c', 'u-a'], 'survivor-stones:L:C:7')
    expect(a.eliminatedUserId).toBe(b.eliminatedUserId)
    expect(a.candidates).toEqual(['u-a', 'u-b', 'u-c'])
    expect(a.candidates).toContain(a.eliminatedUserId)
  })

  it('a different council draws independently', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `survivor-stones:L:C${i}:7`)
    const picks = new Set(seeds.map(seed => drawSurvivorStones(['u-a', 'u-b', 'u-c'], seed).eliminatedUserId))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('refuses an empty draw', () => {
    expect(() => drawSurvivorStones([], 'x')).toThrow()
  })
})

function db(opts: { mode: string; player?: boolean; roster?: boolean; owner?: string | null }) {
  return {
    league: { findUnique: vi.fn(async () => ({ userId: opts.owner === undefined ? 'owner-1' : opts.owner, settings: { commissionerParticipationMode: opts.mode } })) },
    survivorPlayer: { findFirst: vi.fn(async () => (opts.player ? { id: 'p' } : null)) },
    roster: { findFirst: vi.fn(async () => (opts.roster ? { id: 'r' } : null)) },
  }
}

describe('hasIndependentSurvivorHost', () => {
  it('is true for a non-playing commissioner host', async () => {
    expect(await hasIndependentSurvivorHost('L', db({ mode: 'non_participating_host' }) as never)).toBe(true)
  })
  it('is false when the commissioner is configured as a player', async () => {
    expect(await hasIndependentSurvivorHost('L', db({ mode: 'participating_player' }) as never)).toBe(false)
  })
  it('is false when a "host" actually holds a cast seat or a roster', async () => {
    expect(await hasIndependentSurvivorHost('L', db({ mode: 'non_participating_host', player: true }) as never)).toBe(false)
    expect(await hasIndependentSurvivorHost('L', db({ mode: 'non_participating_host', roster: true }) as never)).toBe(false)
  })
  it('is false without a league owner', async () => {
    expect(await hasIndependentSurvivorHost('L', db({ mode: 'non_participating_host', owner: null }) as never)).toBe(false)
  })
})
