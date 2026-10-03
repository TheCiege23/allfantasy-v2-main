import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  autoCoachSkipReason,
  parseAutoCoachUserPreferences,
} from '@/lib/autocoach/autoCoachPreferences'

/**
 * AutoCoach honours the user's "leave him alone" preferences — and ONLY those.
 *
 * Until 2026-10-02 the engine parsed `autoCoachPreferences` and read nothing from it but
 * `learnTendencies` (for a log flag). Exclusions and position switches were saved by Settings-era
 * code and never consulted, so a user who said "never touch my QB" got their QB benched.
 *
 * These run the REAL `runAutoCoachForLeague` loop over a two-slot lineup with the data layer
 * mocked, so what is asserted is which swap the engine actually executes.
 */

const mocks = vi.hoisted(() => ({
  prefs: {} as Record<string, unknown>,
  statuses: {} as Record<string, string>,
  playerData: null as unknown,
  swapLogs: [] as Array<{ playerOutId: string; playerInId: string }>,
  pickCalls: [] as Array<{ playerOut: string; bench: string[] }>,
}))

const POSITIONS: Record<string, string> = { qb1: 'QB', qb2: 'QB', rb1: 'RB', rb2: 'RB' }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L1',
        name: 'Test League',
        sport: 'NFL',
        season: 2026,
        settings: {},
        leagueVariant: null,
        bestBallMode: false,
        autoCoachEnabled: true,
        starters: ['QB', 'RB'],
      })),
    },
    autoCoachSetting: {
      findMany: vi.fn(async () => [{ userId: 'U1', leagueId: 'L1', enabled: true, blockedByCommissioner: false }]),
      update: vi.fn(async () => ({})),
    },
    userProfile: {
      findUnique: vi.fn(async () => ({ autoCoachGlobalEnabled: true, autoCoachPreferences: mocks.prefs })),
    },
    roster: {
      findFirst: vi.fn(async () => ({ id: 'R1', playerData: mocks.playerData })),
      findUnique: vi.fn(async () => ({ id: 'R1', leagueId: 'L1', playerData: mocks.playerData })),
      update: vi.fn(async ({ data }: { data: { playerData: unknown } }) => {
        mocks.playerData = data.playerData
        return {}
      }),
    },
    autoCoachSwapLog: {
      create: vi.fn(async ({ data }: { data: { playerOutId: string; playerInId: string } }) => {
        mocks.swapLogs.push({ playerOutId: data.playerOutId, playerInId: data.playerInId })
        return { id: `log-${mocks.swapLogs.length}` }
      }),
    },
  },
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    async resolveForUser() {
      return { hasAccess: true }
    }
  },
}))
vi.mock('@/lib/queues/bullmq', () => ({ getNotificationsQueue: () => null }))
vi.mock('@/lib/autocoach/playerGameLock', () => ({
  getPlayerGameLockStateForAutoCoach: async () => ({
    lockedBecauseGameStarted: false,
    nextKickoffUtc: null,
    scheduleKnown: true,
    reason: 'pregame',
  }),
}))
vi.mock('@/lib/autocoach/pickBestBenchReplacement', () => ({
  pickBestBenchReplacementForAutoCoach: async (args: {
    playerOut: { id: string }
    benchCandidates: Array<{ id: string; name: string; position: string }>
  }) => {
    mocks.pickCalls.push({ playerOut: args.playerOut.id, bench: args.benchCandidates.map((b) => b.id) })
    const pick = args.benchCandidates[0] ?? null
    return { pick, expectedPointsDelta: 5, confidence: 80, decisionNotes: '' }
  },
}))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId', () => {
  const row = (id: string) => ({
    name: id,
    position: POSITIONS[id] ?? 'UNK',
    team: 'KC',
    status: mocks.statuses[id] ?? 'ACTIVE',
    updatedAt: new Date('2026-10-02T12:00:00Z'),
  })
  return {
    findSportsPlayersByLeagueIds: async (_sport: string, ids: string[]) => new Map(ids.map((id) => [id, row(id)])),
    findSportsPlayerByLeagueId: async (_sport: string, id: string) => row(id),
  }
})

import { runAutoCoachForLeague } from '@/lib/autocoach/AutoCoachEngine'

function lineup() {
  return {
    lineup_sections: {
      starters: [
        { id: 'qb1', position: 'QB' },
        { id: 'rb1', position: 'RB' },
      ],
      bench: [
        { id: 'qb2', position: 'QB' },
        { id: 'rb2', position: 'RB' },
      ],
      ir: [],
      taxi: [],
      devy: [],
    },
  }
}

beforeEach(() => {
  mocks.prefs = {}
  mocks.statuses = { qb1: 'OUT', rb1: 'OUT' }
  mocks.playerData = lineup()
  mocks.swapLogs = []
  mocks.pickCalls = []
})

describe('autoCoachSkipReason (pure)', () => {
  it('names an excluded player, a disabled position, or nothing', () => {
    const prefs = parseAutoCoachUserPreferences({ excludedPlayerIds: ['p1'], positionOverrides: { QB: { disabled: true } } })
    expect(autoCoachSkipReason({ id: 'p1', position: 'RB' }, prefs)).toBe('excluded')
    expect(autoCoachSkipReason({ id: 'p2', position: 'qb' }, prefs)).toBe('position_off')
    expect(autoCoachSkipReason({ id: 'p2', position: 'RB' }, prefs)).toBeNull()
    expect(autoCoachSkipReason({ id: 'p2' }, prefs)).toBeNull()
  })
})

describe('runAutoCoachForLeague', () => {
  it('CONTROL: with no preferences it swaps out BOTH ruled-out starters', async () => {
    await runAutoCoachForLeague('L1')
    expect(mocks.swapLogs).toEqual([
      { playerOutId: 'qb1', playerInId: 'qb2' },
      { playerOutId: 'rb1', playerInId: 'rb2' },
    ])
  })

  it('leaves an EXCLUDED starter in place, and still fixes the other slot', async () => {
    mocks.prefs = { excludedPlayerIds: ['qb1'] }
    await runAutoCoachForLeague('L1')
    expect(mocks.swapLogs).toEqual([{ playerOutId: 'rb1', playerInId: 'rb2' }])
  })

  it('leaves a starter alone when his POSITION is switched off', async () => {
    mocks.prefs = { positionOverrides: { QB: { disabled: true } } }
    await runAutoCoachForLeague('L1')
    expect(mocks.swapLogs).toEqual([{ playerOutId: 'rb1', playerInId: 'rb2' }])
  })

  it('never moves an EXCLUDED bench player INTO the lineup', async () => {
    mocks.prefs = { excludedPlayerIds: ['qb2'] }
    await runAutoCoachForLeague('L1')
    // qb1 is out, but the only QB replacement is managed by the user — no QB swap at all.
    expect(mocks.swapLogs).toEqual([{ playerOutId: 'rb1', playerInId: 'rb2' }])
    expect(mocks.pickCalls.find((c) => c.playerOut === 'qb1')).toBeUndefined()
  })

  it('does NOT let the margin knobs block a swap of a ruled-out starter', async () => {
    /*
     * The fields Settings deliberately does not show. A conservative profile with a sky-high
     * threshold must not leave a guaranteed zero in the lineup.
     */
    mocks.prefs = { aggressiveness: 'conservative', confidenceThreshold: 100, minProjectionDelta: 50 }
    await runAutoCoachForLeague('L1')
    expect(mocks.swapLogs).toHaveLength(2)
  })
})
