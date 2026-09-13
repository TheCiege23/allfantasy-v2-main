import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `validateRedraftTradeProposalAtCreation` — what the Trade Center's proposal path now refuses up front.
 *
 * The NFL branch runs the REAL `resolveNflRedraftTradeRuntime` + `validateNflRedraftTradeProposal` against a
 * prisma fixture, so what is asserted is the canonical validator's answer on these rosters, not a restatement
 * of it. The fallback branch runs against the same fixture with the season switched to a non-NFL sport.
 *
 * Every fixture row is stored unlocked; the lock case comes from a kickoff that has already passed.
 */

const h = vi.hoisted(() => {
  const state = {
    sport: 'NFL',
    kickoff: null as Date | null,
  }
  const rosters = [
    { id: 'alpha', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Alpha', ownerName: 'A', ownerId: 'user-a', faabBalance: 100, waiverPriority: 1, playoffSeed: 1 },
    { id: 'beta', leagueId: 'league-1', seasonId: 'season-1', teamName: 'Beta', ownerName: 'B', ownerId: 'user-b', faabBalance: 100, waiverPriority: 2, playoffSeed: 2 },
  ]
  const player = (rosterId: string, playerId: string, position: string, slotType: string, team: string) => ({
    id: `rp-${playerId}`,
    rosterId,
    playerId,
    playerName: playerId,
    position,
    team,
    sport: 'NFL',
    slotType,
    isLocked: false,
    injuryStatus: null,
    byeWeek: null,
    acquisitionType: 'draft',
    addedAt: new Date('2026-08-20T00:00:00.000Z'),
    droppedAt: null,
  })
  const rosterPlayers = [player('alpha', 'alpha-rb', 'RB', 'RB', 'BUF'), player('beta', 'beta-wr', 'WR', 'BENCH', 'MIA')]

  const rules = {
    version: 1,
    leagueId: 'league-1',
    generatedAtIso: '2026-09-01T00:00:00.000Z',
    source: { commissionerSettings: 'League', draftSettings: 'LeagueSettings', effectiveResolvers: [], settingsSnapshotVersion: 1, presetKey: 'af:v2|concept=redraft|sport=NFL' },
    general: { name: 'Validation League', sport: 'NFL', season: 2026, format: 'redraft', variant: null, teamCount: 2, rosterSize: 4, lifecycleState: 'active', status: 'active', locked: false, emergencyPaused: false, timezone: 'America/New_York', language: 'en' },
    draft: {},
    scoring: { templateId: 'nfl_half_ppr', presetId: 'nfl_half_ppr', formatType: 'redraft', sport: 'NFL', activeRuleCount: 0, overriddenRuleCount: 0, activeRules: [] },
    roster: { size: 4, starters: ['QB', 'RB'], irSlots: 0, eligibleReserveStatuses: [], allowPreDraftMoves: true, preventBenchDrops: false, lockAllMoves: false },
    waivers: {},
    trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
    playoffs: {},
    schedule: {},
    permissions: { settingsEditableByRoles: ['commissioner'], memberMovesLocked: false, inviteLinksDisabled: false, inviteCapacityOverride: false },
    intelligence: {},
  }

  type Where = { id?: { in?: string[] }; rosterId?: { in?: string[] }; playerId?: { in?: string[] } }
  const prisma = {
    redraftSeason: {
      findFirst: async () => ({ id: 'season-1', leagueId: 'league-1', sport: state.sport, season: 2026, currentWeek: 2, status: 'in_season' }),
    },
    league: { findUnique: async () => ({ settings: {} }) },
    redraftRoster: {
      findMany: async (args?: { where?: Where }) => {
        const ids = args?.where?.id?.in
        return ids ? rosters.filter((r) => ids.includes(r.id)) : rosters
      },
    },
    redraftRosterPlayer: {
      findMany: async (args?: { where?: Where }) => {
        const rosterIds = args?.where?.rosterId?.in
        const playerIds = args?.where?.playerId?.in
        return rosterPlayers
          .filter((p) => !rosterIds || rosterIds.includes(p.rosterId))
          .filter((p) => !playerIds || playerIds.includes(p.playerId))
          .map((p) => ({ ...p }))
      },
    },
    sportsGame: {
      findMany: async () => (state.kickoff ? [{ homeTeam: 'BUF', awayTeam: 'NYJ', startTime: state.kickoff }] : []),
    },
    redraftTradeProposal: { findMany: async () => [] },
    redraftLeagueTransaction: { findMany: async () => [] },
  }

  return { state, rules, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () => h.rules),
}))

import { validateRedraftTradeProposalAtCreation } from '@/lib/redraft/tradeProposalValidation'

type Asset = Parameters<typeof validateRedraftTradeProposalAtCreation>[0]['assets'][number]
const player = (playerId: string, from: string, to: string): Asset => ({ fromRosterId: from, toRosterId: to, assetType: 'player', playerId, playerName: playerId })
const faab = (amount: number, from: string, to: string): Asset => ({ fromRosterId: from, toRosterId: to, assetType: 'faab', metadata: { amount } })

const validate = (assets: Asset[]) =>
  validateRedraftTradeProposalAtCreation({ leagueId: 'league-1', seasonId: 'season-1', proposerRosterId: 'alpha', receiverRosterId: 'beta', assets })

beforeEach(() => {
  h.state.sport = 'NFL'
  h.state.kickoff = null
})

describe('NFL redraft: the canonical runtime validator decides', () => {
  it('allows a valid player-for-player trade', async () => {
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('beta-wr', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: true,
      source: 'nfl_runtime',
    })
  })

  it("🛑 refuses a player the sending roster does not own", async () => {
    await expect(validate([player('beta-wr', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'PLAYER_NOT_OWNED',
      source: 'nfl_runtime',
    })
  })

  it('🛑 refuses FAAB the sending roster does not have (the Trade Center sends it as metadata.amount)', async () => {
    await expect(validate([faab(150, 'alpha', 'beta')])).resolves.toMatchObject({ ok: false, code: 'INSUFFICIENT_FAAB' })
  })

  it('refuses the same player offered twice', async () => {
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'DUPLICATE_ASSET',
    })
  })

  it("refuses a player whose game has kicked off, derived from the schedule", async () => {
    h.state.kickoff = new Date(Date.now() - 60 * 60 * 1000)
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({ ok: false, code: 'LOCKED_PLAYER' })
  })
})

describe('non-NFL redraft: the sport-agnostic fallback decides', () => {
  beforeEach(() => {
    h.state.sport = 'NCAAF'
  })

  it('allows a valid trade', async () => {
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), faab(40, 'alpha', 'beta')])).resolves.toMatchObject({
      ok: true,
      source: 'ownership_fallback',
    })
  })

  it('🛑 refuses a player the sending roster does not own', async () => {
    await expect(validate([player('beta-wr', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'PLAYER_NOT_OWNED',
      source: 'ownership_fallback',
    })
  })

  it('🛑 refuses FAAB beyond the balance, net of FAAB coming back in the same trade', async () => {
    await expect(validate([faab(150, 'alpha', 'beta')])).resolves.toMatchObject({ ok: false, code: 'INSUFFICIENT_FAAB' })
    // 150 out, 60 back: net 90 against a 100 balance is affordable.
    await expect(validate([faab(150, 'alpha', 'beta'), faab(60, 'beta', 'alpha')])).resolves.toMatchObject({ ok: true })
  })

  it('refuses the same player offered twice', async () => {
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'DUPLICATE_ASSET',
    })
  })
})
