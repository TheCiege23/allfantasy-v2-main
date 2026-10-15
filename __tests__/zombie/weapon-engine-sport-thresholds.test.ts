import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `checkAndAwardWeapons` on a real-sized NBA week versus an NFL week.
 *
 * 🛑 With NFL lines (Knife 100, Bow 120, Axe for a 20-point win) every NBA team earned a Knife and a Bow
 * every week, and an Axe on 92% of wins. NBA now awards at the rates NFL does: Knife 900, Bow 1,050,
 * Axe for a win by 90.
 */

const h = vi.hoisted(() => ({
  zombieLeague: { findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  redraftRoster: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn(), findUnique: vi.fn() },
  zombieLeagueTeam: { findUnique: vi.fn(), findMany: vi.fn() },
  zombieTeamItem: { create: vi.fn() },
  zombieRulesTemplate: { findUnique: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h }))
vi.mock('@/lib/zombie/ambushEngine', () => ({ validateAmbushTiming: vi.fn() }))
vi.mock('@/lib/zombie/commissionerNotificationService', () => ({ notifyCommissioner: vi.fn(), notifyZombiePlayer: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/animationEngine', () => ({ queueAnimation: vi.fn() }))
vi.mock('@/lib/zombie/ZombieAuditLog', () => ({ appendZombieAudit: vi.fn() }))

import { checkAndAwardWeapons } from '@/lib/zombie/weaponEngine'

/** Which weapon types each owner received. */
const awarded = () => {
  const out: Record<string, string[]> = {}
  for (const [args] of h.zombieTeamItem.create.mock.calls as Array<[{ data: { userId: string; itemType: string } }]>) {
    ;(out[args.data.userId] ??= []).push(args.data.itemType)
  }
  for (const k of Object.keys(out)) out[k].sort()
  return out
}

function arrange(sport: string, homeScore: number, awayScore: number) {
  h.zombieLeague.findUnique.mockResolvedValue({ id: 'z1', sport, season: 2026 })
  h.redraftSeason.findFirst.mockResolvedValue({ id: 's1' })
  h.redraftMatchup.findMany.mockResolvedValue([{ homeRosterId: 'rr-home', awayRosterId: 'rr-away', homeScore, awayScore }])
  h.redraftRoster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ ownerId: where.id === 'rr-home' ? 'u-home' : 'u-away' }))
  h.roster.findFirst.mockImplementation(async ({ where }: { where: { platformUserId: string } }) => ({ id: `roster-${where.platformUserId}` }))
  h.zombieLeagueTeam.findUnique.mockResolvedValue({ id: 'team', items: [] })
  h.zombieLeagueTeam.findMany.mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.zombieRulesTemplate.findUnique.mockResolvedValue(null)
  h.zombieTeamItem.create.mockResolvedValue({})
})

describe('weapons on an NBA week', () => {
  it('a typical week (1,000 beats 880) earns the winner a Knife and an Axe — no Bow, nothing for the loser', async () => {
    arrange('NBA', 1000, 880)
    await checkAndAwardWeapons('L1', 3, 'z1')
    expect(awarded()).toEqual({ 'u-home': ['weapon_axe', 'weapon_knife'] })
  })

  it('a big week (1,100) earns a Bow too', async () => {
    arrange('NBA', 1100, 1060)
    await checkAndAwardWeapons('L1', 3, 'z1')
    expect(awarded()).toEqual({ 'u-home': ['weapon_bow', 'weapon_knife'], 'u-away': ['weapon_bow', 'weapon_knife'] })
  })

  it('a close win (by 60) earns no Axe', async () => {
    arrange('NBA', 960, 900)
    await checkAndAwardWeapons('L1', 3, 'z1')
    expect(awarded()).toEqual({ 'u-home': ['weapon_knife'], 'u-away': ['weapon_knife'] })
  })

  it('a quiet week (500 v 400) earns no Knife or Bow — under NFL lines both teams got both', async () => {
    arrange('NBA', 500, 400)
    await checkAndAwardWeapons('L1', 3, 'z1')
    expect(awarded()).toEqual({ 'u-home': ['weapon_axe'] })
  })
})

describe('[control] weapons on an NFL week are unchanged', () => {
  it('130 beats 105: winner gets Knife, Bow and Axe; loser a Knife', async () => {
    arrange('NFL', 130, 105)
    await checkAndAwardWeapons('L1', 3, 'z1')
    expect(awarded()).toEqual({ 'u-home': ['weapon_axe', 'weapon_bow', 'weapon_knife'], 'u-away': ['weapon_knife'] })
  })
})
