/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's roster ids must never be read as Sleeper ids by the waiver assistant.
 *
 * A Fleaflicker / MFL / Fantrax / Yahoo roster holds that provider's own ids — short numbers that
 * collide with real Sleeper ids (51 of 248 on the one production Fleaflicker league). Read as Sleeper
 * ids, the roster's needs were computed from a stranger's position and a colliding id hid a real free
 * agent, while the league's actual players were never subtracted — so "available in this league" was
 * a guess. Such a league now gets no recommendations and a gap that says why. The control shows the
 * same id IS read, and subtracted, in a Sleeper league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { platform: 'fleaflicker', idsAsked: [] as string[][] }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ id: 'L1', sport: 'NFL', platform: state.platform })) },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'r1', platformUserId: 'u1', playerData: { players: ['6038'], starters: ['6038'] }, faabRemaining: 100 },
      ]),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ sleeperId?: { in: string[] } }> } }) => {
        const asked = where.OR.find((c) => c.sleeperId)?.sleeperId?.in ?? []
        state.idsAsked.push(asked)
        return asked.includes('6038') ? [{ position: 'TE' }] : []
      }),
    },
  },
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: vi.fn(async () => ({ normalizedWaiverType: 'faab', faabBudget: 100 })),
}))
vi.mock('@/lib/ai/waivers/waiverPreferenceService', () => ({ getWaiverPreferenceHints: vi.fn(async () => []) }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: vi.fn(async () => [
    { player_id: 'sp-6038', external_source_id: '6038', full_name: 'Wrong Player', position: 'TE' },
    { player_id: 'sp-7000', external_source_id: '7000', full_name: 'Free Guy', position: 'WR' },
  ]),
}))

import { generateWaiverRecommendations } from '@/lib/ai/waivers/waiverRecommendationService'

const INPUT = { userId: 'u1', leagueId: 'L1', mode: 'quick' as const }
const askedFor6038 = () => state.idsAsked.some((ids) => ids.includes('6038'))

beforeEach(() => {
  state.platform = 'fleaflicker'
  state.idsAsked = []
})

describe('generateWaiverRecommendations — a foreign league’s roster ids', () => {
  it('🛑 a Fleaflicker roster id that equals a Sleeper id is never looked up, and nothing is called available', async () => {
    const out = await generateWaiverRecommendations(INPUT)
    expect(askedFor6038()).toBe(false)
    expect(out.rosterNeeds).toEqual([])
    expect(out.recommendations).toEqual([])
    expect(out.meta?.dataGaps).toContain('roster_ids_not_readable_for_platform')
  })

  it('CONTROL: in a Sleeper league the same id IS looked up, subtracted, and the rest recommended', async () => {
    state.platform = 'sleeper'
    const out = await generateWaiverRecommendations(INPUT)
    expect(askedFor6038()).toBe(true)
    expect(out.recommendations.map((r) => r.addPlayerName)).toEqual(['Free Guy'])
    expect(out.meta?.dataGaps).not.toContain('roster_ids_not_readable_for_platform')
  })
})
