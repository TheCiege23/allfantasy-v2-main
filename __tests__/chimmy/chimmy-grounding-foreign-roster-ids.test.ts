/**
 * @vitest-environment node
 *
 * 🛑 Chimmy's roster groundings must never hand a foreign league's roster ids to `resolveNames`.
 *
 * `resolveNames` looks ids up as SLEEPER ids. Fleaflicker / MFL / Fantrax / Yahoo rosters hold that
 * provider's own ids — short numbers in Sleeper's range (51 of 248 on the one production Fleaflicker
 * league are real Sleeper ids) — so a raw id there names a stranger. The trade scenario, start/sit,
 * waiver scenario and both lineup optimizers take their ids from the canonical world's rosters and
 * nowhere else; the strip lives once, in the world port's `loadRosters`. These drive each builder's
 * REAL default `resolveWorld` (the real port and assembler, only the database stubbed) and capture the
 * ids that reach the name read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { platform: 'fleaflicker', sport: 'NFL', starters: ['QB', 'WR', 'BN'] as string[] }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L1',
        sport: state.sport,
        season: 2026,
        scoring: null,
        scoringPresetId: null,
        leagueType: 'redraft',
        isDynasty: false,
        rosterSize: null,
        starters: state.starters,
        irSlots: null,
        taxiSlots: null,
        waiverType: null,
        waiverBudget: null,
        waiverMinBid: null,
        waiverHours: null,
        tradeReviewHours: null,
        tradeDeadlineWeek: null,
        draftPickTrading: null,
        settings: null,
        lastSyncedAt: null,
        syncStatus: null,
        platform: state.platform,
        platformLeagueId: 'P1',
      })),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 't1', externalId: 'x1', ownerName: 'Me', teamName: 'Mine', platformUserId: 'u1', claimedByUserId: 'viewer-1' },
        { id: 't2', externalId: 'x2', ownerName: 'Rival', teamName: 'Rival', platformUserId: 'u2', claimedByUserId: null },
      ]),
    },
    roster: {
      findMany: vi.fn(async () => [
        // '6038' and '4046' are this provider's ids — and, in the fake name table below, real Sleeper ids.
        { id: 'r1', platformUserId: 'u1', playerData: { players: ['6038', '5000'], starters: ['6038'] }, faabRemaining: null, waiverPriority: null, settings: null, league: { platform: state.platform } },
        { id: 'r2', platformUserId: 'u2', playerData: { players: ['4046'], starters: ['4046'] }, faabRemaining: null, waiverPriority: null, settings: null, league: { platform: state.platform } },
      ]),
    },
    redraftRoster: { findMany: vi.fn(async () => []) },
    teamPerformance: { findMany: vi.fn(async () => []) },
  },
}))

import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { buildTradeScenario, type TradeScenarioDeps } from '@/lib/chimmy/tradeScenarioGrounding'
import { buildStartSitScenario, type LineupScenarioDeps } from '@/lib/chimmy/lineupScenarioGrounding'
import { buildBaselineLineupContext, type BaselineOptimizerDeps } from '@/lib/chimmy/lineupOptimizerOtherSports'

/** The Sleeper-keyed name table `resolveNames` would consult: every id here is somebody real. */
const SLEEPER_NAMES: Record<string, { name: string; position: string }> = {
  '6038': { name: 'Wrong Player', position: 'WR' },
  '4046': { name: 'Stranger Two', position: 'QB' },
  '5000': { name: 'Stranger Three', position: 'WR' },
}

function nameLoader() {
  const asked: string[] = []
  const load = async (_sport: string, ids: string[]) => {
    asked.push(...ids)
    return new Map(ids.filter((id) => SLEEPER_NAMES[id]).map((id) => [id, { ...SLEEPER_NAMES[id]!, team: null, injury: null }]))
  }
  return { asked, load }
}

async function tradeAsked(platform: string) {
  state.platform = platform
  const { asked, load } = nameLoader()
  const deps = {
    resolveWorld: (id: string) => resolveCanonicalWorld(id),
    loadPlayerNames: load,
    evaluate: vi.fn(async () => { throw new Error('not reached') }),
  } as unknown as TradeScenarioDeps
  // Past the name read the evaluator is not stubbed; only what reached the name read matters here.
  const scenario = await buildTradeScenario({ message: 'Trade Wrong Player for Stranger Two?', leagueId: 'L1', userId: 'viewer-1' }, deps).catch(() => null)
  return { asked, scenario }
}

async function startSitAsked(platform: string) {
  state.platform = platform
  const { asked, load } = nameLoader()
  const deps = { resolveWorld: (id: string) => resolveCanonicalWorld(id), loadPlayerNames: load } as unknown as LineupScenarioDeps
  await buildStartSitScenario({ message: 'Should I start Wrong Player or Stranger Three?', leagueId: 'L1', userId: 'viewer-1' }, deps).catch(() => null)
  return asked
}

async function baselineAsked(platform: string) {
  state.platform = platform
  state.sport = 'NBA'
  state.starters = ['PG', 'BN']
  const { asked, load } = nameLoader()
  const deps: BaselineOptimizerDeps = {
    resolveWorld: (id: string) => resolveCanonicalWorld(id),
    loadPlayers: load,
    baseline: async () => ({ sport: 'NBA', season: 2026, byName: new Map() }) as never,
  }
  const text = await buildBaselineLineupContext({ leagueId: 'L1', userId: 'viewer-1' }, deps)
  return { asked, text }
}

beforeEach(() => {
  state.platform = 'fleaflicker'
  state.sport = 'NFL'
  state.starters = ['QB', 'WR', 'BN']
})

describe('Chimmy groundings — a foreign league’s roster ids never reach resolveNames', () => {
  it('🛑 trade scenario: no Fleaflicker/MFL/Fantrax/Yahoo roster id is looked up, and no stranger is traded', async () => {
    for (const platform of ['fleaflicker', 'mfl', 'fantrax', 'yahoo']) {
      const { asked, scenario } = await tradeAsked(platform)
      expect(asked, platform).toEqual([])
      expect(JSON.stringify(scenario ?? null), platform).not.toContain('6038')
    }
  })

  it('🛑 start/sit scenario: no foreign roster id is looked up', async () => {
    expect(await startSitAsked('fleaflicker')).toEqual([])
  })

  it('🛑 other-sports lineup optimizer: no foreign roster id is looked up, and no stranger is named', async () => {
    const { asked, text } = await baselineAsked('fleaflicker')
    expect(asked).toEqual([])
    expect(text).not.toContain('Wrong Player')
  })

  it('CONTROL: the same ids in a Sleeper league DO reach the name read on every path', async () => {
    const trade = await tradeAsked('sleeper')
    expect(trade.asked).toEqual(expect.arrayContaining(['6038', '4046']))
    expect(await startSitAsked('sleeper')).toEqual(expect.arrayContaining(['6038', '5000']))
    expect((await baselineAsked('sleeper')).asked).toEqual(expect.arrayContaining(['6038', '5000']))
  })
})
