// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ sport: 'NFL', count: 3 as number | null }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: vi.fn(async () => ({ leagueVariant: 'zombie', leagueSize: 12, userId: 'host', season: 2026, sport: h.sport, zombieLeague: { whispererIsPublic: true } })) },
  leagueTeam: { count: vi.fn(async () => 1) },
  userProfile: { findFirst: vi.fn(async () => ({ displayName: 'Host' })) },
  leagueSettings: { findUnique: vi.fn(async () => null) },
} }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: vi.fn(async () => ({ bashingThreshold: h.sport === 'NFL' ? 60 : 128, maulingThreshold: h.sport === 'NFL' ? 60 : 211, reviveThreshold: 3 })) }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: vi.fn(async () => h.count == null ? null : ({ serumReviveCount: h.count, infectionLossToZombie: true })) }))
vi.mock('@/lib/zombie/zombieHomeSummary', () => ({ zombieThemeForLeague: () => 'quarantine-zone' }))
import { getZombieJoinPreview } from '@/lib/zombie/zombieJoinPreview'
beforeEach(() => { h.sport = 'NFL'; h.count = 3 })
describe('invite rules agree with the effective league policy', () => {
  it('shows the fixed two-serum NFL revival even with a legacy stored count', async () => {
    expect(await getZombieJoinPreview('L')).toMatchObject({ reviveSerums: 2, bashingMargin: 60, maulingMargin: 60 })
  })
  it('uses another sport’s saved revival count and its own combat margins', async () => {
    h.sport = 'NBA'; h.count = 4
    expect(await getZombieJoinPreview('L')).toMatchObject({ reviveSerums: 4, bashingMargin: 128, maulingMargin: 211 })
  })
  it('keeps the sport rules fallback if configuration is unavailable', async () => {
    h.sport = 'NHL'; h.count = null
    expect(await getZombieJoinPreview('L')).toMatchObject({ reviveSerums: 3 })
  })
})
