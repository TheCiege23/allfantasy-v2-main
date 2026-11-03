import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'Survivor',
  zombie: { id: 'z', sport: 'NFL', status: 'active', season: 2026, currentWeek: 4, totalWeeks: 8,
    correctionHoldFromWeek: null as number | null, experienceMode: 'enhanced' },
  teams: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  zombieLeague: { findUnique: async () => h.zombie },
  zombieWeeklyResolution: { findUnique: async () => null },
  league: { findUnique: async () => ({ id: 'league', settings: {}, sport: 'NFL', leagueSize: 20 }) },
  zombieLeagueTeam: { findMany: async () => h.teams },
  roster: { findMany: async () => [] },
} }))
vi.mock('@/lib/zombie/beta2025ItemTrades', () => ({
  zombieItemId: (asset: { metadata?: { zombieItemId?: string } }) => {
    if (!asset.metadata?.zombieItemId) throw new Error('Missing item')
    return asset.metadata.zombieItemId
  },
}))
vi.mock('@/lib/decision-os/trade/guillotineContext', () => ({ loadZombiePlayerContext: async () => ({ ok: false, reason: 'No player context' }) }))

import { createZombieNativeItemGrader } from '@/lib/decision-os/trade/zombieNativeItemGrader'

const owned = (id: string, itemType: string) => ({
  id, itemType, zombieLeagueId: 'z', isUsed: false, isExpired: false, activationState: 'ready', activatesAtWeek: null,
})
const proposal = () => ({
  proposerRosterId: 'rp', receiverRosterId: 'rr', status: 'pending', assets: [
    { assetType: 'zombie_item', fromRosterId: 'rp', toRosterId: 'rr', metadata: { zombieItemId: 'serum' } },
    { assetType: 'zombie_item', fromRosterId: 'rr', toRosterId: 'rp', metadata: { zombieItemId: 'bow' } },
  ],
})

beforeEach(() => {
  h.role = 'Survivor'
  h.zombie.correctionHoldFromWeek = null
  h.teams = [
    { id: 'tp', rosterId: 'lp', redraftRosterId: 'rp', status: h.role, items: [owned('serum', 'serum')] },
    { id: 'tr', rosterId: 'lr', redraftRosterId: 'rr', status: 'Survivor', items: [owned('bow', 'weapon_bow')] },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `tz${i}`, rosterId: `lz${i}`, redraftRosterId: `rz${i}`, status: 'Zombie', items: [] })),
  ]
})

describe('native Zombie item proposal grading', () => {
  it('uses each team’s actual items and gives the partners different letters', async () => {
    const grader = await createZombieNativeItemGrader('league')
    const grade = await grader.grade(proposal())
    expect(grade.graded).toBe(true)
    if (!grade.graded) return
    expect(grade.action).toBe('review')
    expect(grade.letter).toBe('A')
    expect(grade.partnerLetter).toBe('F')
    expect(grade.lines.filter(line => line.valueSource === 'zombie_item')).toHaveLength(2)
    expect(grade.basis).toContain('Infection, revival, loot, cash payouts')
  })

  it('withholds when either current participant is infected', async () => {
    h.teams[0]!.status = 'Zombie'
    const grader = await createZombieNativeItemGrader('league')
    const grade = await grader.grade(proposal())
    expect(grade.graded).toBe(false)
    if (!grade.graded) expect(grade.reason).toContain('Zombie cannot trade')
  })

  it('withholds when inventory is no longer held or a correction holds trades', async () => {
    h.teams[0]!.items = []
    const grader = await createZombieNativeItemGrader('league')
    expect((await grader.grade(proposal())).graded).toBe(false)
    h.zombie.correctionHoldFromWeek = 4
    const held = await createZombieNativeItemGrader('league')
    const grade = await held.grade(proposal())
    expect(grade.graded).toBe(false)
    if (!grade.graded) expect(grade.reason).toContain('correction')
  })
})
