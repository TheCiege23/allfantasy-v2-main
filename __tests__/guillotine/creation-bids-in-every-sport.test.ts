/**
 * A guillotine league bids for the chopped team's players, in every sport. Creation took the waiver
 * type from the sport alone, so an NBA guillotine was created on rolling priority with no budget.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'

type Obj = Record<string, any>

function buildTx() {
  let n = 0
  const ok = (id: string) => vi.fn().mockResolvedValue({ id })
  return {
    userProfile: { findUnique: vi.fn().mockResolvedValue({ displayName: 'C', xpLevel: 1, legacyCareerLevel: null }) },
    appUser: { findUnique: vi.fn().mockResolvedValue({ username: 'c', email: 'c@test.local' }) },
    league: { findFirst: vi.fn().mockResolvedValue(null), create: ok('league-1'), update: ok('league-1') },
    leagueSettings: { create: ok('ls') },
    leagueWaiverSettings: { create: ok('lws') },
    scoringSettingsSnapshot: { create: ok('ss') },
    guillotineLeagueConfig: { upsert: ok('g') },
    idpLeagueConfig: { upsert: ok('i') },
    dynastyLeagueConfig: { upsert: ok('d') },
    devyLeagueConfig: { upsert: ok('dv') },
    c2CLeagueConfig: { upsert: ok('c') },
    redraftLeagueExtendedSettings: { create: ok('e') },
    redraftLeagueDraftProfile: { create: ok('dp') },
    redraftLeagueHomepageState: { create: ok('h') },
    redraftLeagueSportIntegration: { create: ok('si') },
    redraftLeagueChatRoom: { create: ok('chat') },
    roster: { create: vi.fn().mockImplementation(async (args?: Obj) => ({ id: `roster-${++n}`, platformUserId: args?.data?.platformUserId ?? `p-${n}` })) },
    leagueTeam: { create: vi.fn().mockImplementation(async () => ({ id: `team-${++n}` })) },
    redraftLeagueMember: { create: ok('m') },
    leagueEntrySlot: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    draftSession: { create: ok('ds') },
    leagueInvite: { create: vi.fn().mockResolvedValue({ id: 'inv', token: 'T' }) },
    findLeagueListing: { upsert: ok('fl') },
  }
}

const PRESET: Record<string, string> = { NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points' }

async function create(concept: string, sport: string) {
  const tx = buildTx()
  const body = { concept, sport, teamCount: 8, draftType: 'snake', scoringPreset: PRESET[sport], leagueName: 'Bids', language: 'en', tradeReviewMode: 'commissioner' } as any
  await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
  return { league: tx.league.create.mock.calls[0][0].data as Obj, waivers: tx.leagueWaiverSettings.create.mock.calls[0][0].data as Obj }
}

describe('a guillotine league is created on FAAB bidding', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('%s: the engine row and the league row both say FAAB with a budget', async (sport) => {
    const { league, waivers } = await create('guillotine', sport)
    expect(waivers.waiverType).toBe('faab')
    expect(waivers.faabBudget).toBe(100)
    expect(waivers.tiebreakRule).toBe('faab_highest')
    expect(league.waiverType).toBe('faab')
    expect(league.waiverBudget).toBe(100)
  })

  it('an NBA redraft league already bids: guillotine was the format left out', async () => {
    const { waivers } = await create('redraft', 'NBA')
    expect(waivers.waiverType).toBe('faab')
  })
})
