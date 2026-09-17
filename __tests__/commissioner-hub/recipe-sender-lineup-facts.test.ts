// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The lineup-reminder recipe finds empty slots in lineups AS STORED.
 *
 * 🛑 WHAT WAS BROKEN. The sender counted Sleeper's "0" marker, which every importer drops before
 * storing. On production no stored roster holds a "0" (0 of 4,027, measured 2026-09-17), so the
 * reminder could never name anyone. An empty slot survives only as a starters list shorter than the
 * league's rules require, and that is what this now counts.
 *
 * Driven through `readRecipeFacts`, the function the daily job calls.
 */

const db = vi.hoisted(() => ({ answers: {} as Record<string, (args: unknown) => unknown> }))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) => (method === 'count' ? 0 : method === 'findMany' ? [] : null)
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${name}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy({}, { get: (_t, key: string) => (key === 'then' ? undefined : model(key)) })
  return { prisma, default: prisma }
})

vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: vi.fn() }))
vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({
  readManagerActivity: vi.fn(async () => []),
  readActivityWindow: vi.fn(async () => ({ lastActivityAt: null, tradeCount: 0, waiverCount: 0, eventCount: 0 })),
}))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: vi.fn(async () => null) }))

import { readRecipeFacts } from '@/lib/automation/jobs/commissioner/runCommissionerRecipesJob'

const NOW = new Date('2026-09-20T08:40:00Z')

function league(settings: Record<string, unknown>) {
  db.answers['league.findUnique'] = () => ({
    id: 'lg-1',
    name: 'Kings',
    userId: 'owner-1',
    platform: 'sleeper',
    sport: 'NFL',
    status: 'in_season',
    season: 2026,
    settings,
    starters: null,
    lastSyncedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  })
  db.answers['leagueTeam.findMany'] = () => [
    { teamName: 'Short', ownerName: 'a', platformUserId: 'p1', claimedByUserId: null, isOrphan: false, wins: 1, losses: 1, ties: 0, pointsFor: 200 },
    { teamName: 'Full', ownerName: 'b', platformUserId: 'p2', claimedByUserId: null, isOrphan: false, wins: 2, losses: 0, ties: 0, pointsFor: 250 },
  ]
  // As the importer stores them: the "0" markers are already gone.
  db.answers['roster.findMany'] = () => [
    { platformUserId: 'p1', playerData: { starters: ['4046', '6794'], players: ['4046', '6794', '1'] } },
    { platformUserId: 'p2', playerData: { starters: ['1', '2', '3', '4'], players: ['1', '2', '3', '4'] } },
  ]
}

beforeEach(() => {
  db.answers = {}
})

describe('lineup facts for the reminder', () => {
  it('names a stored lineup that is shorter than the league requires', async () => {
    league({ roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'IR'] })

    const loaded = await readRecipeFacts('lg-1', NOW)

    expect(loaded?.facts.emptyLineups).toEqual([{ name: 'Short', empty: 2 }])
  })

  it('names nobody when the rules cannot be read and nothing is marked empty', async () => {
    league({})

    const loaded = await readRecipeFacts('lg-1', NOW)

    expect(loaded?.facts.emptyLineups).toEqual([])
  })
})
