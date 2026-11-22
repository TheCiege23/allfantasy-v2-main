import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  zombieLeagueConfig: { findUnique: vi.fn() },
  zombieLeague: { findUnique: vi.fn() },
  league: { findUnique: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { isZombieLeague } from '@/lib/zombie/ZombieLeagueConfig'

beforeEach(() => {
  vi.clearAllMocks()
  db.zombieLeagueConfig.findUnique.mockResolvedValue(null)
  db.zombieLeague.findUnique.mockResolvedValue(null)
  db.league.findUnique.mockResolvedValue({ leagueVariant: null })
})

describe('Zombie league detection', () => {
  it('recognizes a native Zombie row before its config row exists', async () => {
    db.zombieLeague.findUnique.mockResolvedValue({ id: 'zombie-1' })
    await expect(isZombieLeague('league-1')).resolves.toBe(true)
    expect(db.league.findUnique).not.toHaveBeenCalled()
  })

  it('recognizes a config-backed Zombie league', async () => {
    db.zombieLeagueConfig.findUnique.mockResolvedValue({ id: 'config-1' })
    await expect(isZombieLeague('league-1')).resolves.toBe(true)
    expect(db.zombieLeague.findUnique).not.toHaveBeenCalled()
  })

  it('does not classify an unrelated league as Zombie', async () => {
    await expect(isZombieLeague('league-1')).resolves.toBe(false)
  })
})
