import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `validateRedraftTradeProposalAtCreation` — what the Trade Center's proposal path now refuses up front.
 *
 * The NFL branch runs the REAL `resolveNflRedraftTradeRuntime` + `validateNflRedraftTradeProposal` against a
 * prisma fixture, so what is asserted is the canonical validator's answer on these rosters, not a restatement
 * of it. Every other sport and format — dynasty included — now runs the same validator through the REAL
 * `resolveRedraftTradeRuntime`; the ownership fallback is left for a league with no rules to build it from.
 *
 * Every fixture row is stored unlocked; the lock case comes from a kickoff that has already passed. The deadline
 * cases read the REAL deadline window: `League.tradeDeadlineWeek` against the season row's week.
 */

const h = vi.hoisted(() => {
  const state = {
    sport: 'NFL',
    format: 'redraft',
    kickoff: null as Date | null,
    rulesMissing: false,
    deadlineWeek: null as number | null,
    lifecycleState: 'in_season',
    seasonStatus: 'in_season',
    week: 2,
    leagueSettings: {} as Record<string, unknown>,
    lockAllMoves: false,
    extraPlayers: [] as Array<Record<string, unknown>>,
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
      findFirst: async () => ({ id: 'season-1', leagueId: 'league-1', sport: state.sport, season: 2026, currentWeek: state.week, status: state.seasonStatus }),
    },
    league: {
      findUnique: async () => ({
        id: 'league-1',
        settings: state.leagueSettings,
        platform: 'allfantasy',
        tradeDeadlineWeek: state.deadlineWeek,
        lifecycleState: state.lifecycleState,
        lockAllMoves: state.lockAllMoves,
      }),
    },
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
        return [...rosterPlayers, ...(state.extraPlayers as typeof rosterPlayers)]
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

  return { state, rules, prisma, player }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-runtime')>()),
  resolveCanonicalLeagueRules: vi.fn(async () =>
    h.state.rulesMissing
      ? null
      : {
          ...h.rules,
          general: { ...h.rules.general, sport: h.state.sport, format: h.state.format },
          roster: { ...h.rules.roster, lockAllMoves: h.state.lockAllMoves },
          trades: { ...h.rules.trades, deadlineWeek: h.state.deadlineWeek },
        },
  ),
}))

import { validateRedraftTradeProposalAtCreation } from '@/lib/redraft/tradeProposalValidation'

type Asset = Parameters<typeof validateRedraftTradeProposalAtCreation>[0]['assets'][number]
const player = (playerId: string, from: string, to: string): Asset => ({ fromRosterId: from, toRosterId: to, assetType: 'player', playerId, playerName: playerId })
const faab = (amount: number, from: string, to: string): Asset => ({ fromRosterId: from, toRosterId: to, assetType: 'faab', metadata: { amount } })
const pick = (from: string, to: string): Asset => ({ fromRosterId: from, toRosterId: to, assetType: 'draft_pick', pickSeason: 2027, pickRound: 1 })

const validate = (assets: Asset[]) =>
  validateRedraftTradeProposalAtCreation({ leagueId: 'league-1', seasonId: 'season-1', proposerRosterId: 'alpha', receiverRosterId: 'beta', assets })

beforeEach(() => {
  Object.assign(h.state, {
    sport: 'NFL',
    format: 'redraft',
    kickoff: null,
    rulesMissing: false,
    deadlineWeek: null,
    lifecycleState: 'in_season',
    seasonStatus: 'in_season',
    week: 2,
    leagueSettings: {},
    lockAllMoves: false,
    extraPlayers: [],
  })
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

  it('🛑 refuses a draft pick: settlement has nothing to move it with (pick trading is ON in this league)', async () => {
    await expect(
      validate([player('alpha-rb', 'alpha', 'beta'), pick('beta', 'alpha')]),
    ).resolves.toMatchObject({ ok: false, code: 'DRAFT_PICK_NOT_SETTLED', source: 'nfl_runtime' })
  })

  it("refuses a player whose game has kicked off, derived from the schedule", async () => {
    h.state.kickoff = new Date(Date.now() - 60 * 60 * 1000)
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({ ok: false, code: 'LOCKED_PLAYER' })
  })
})

describe('non-NFL redraft: the league-wide runtime decides (it used to be the ownership fallback)', () => {
  beforeEach(() => {
    h.state.sport = 'NCAAF'
  })

  it('allows a valid trade', async () => {
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), faab(40, 'alpha', 'beta')])).resolves.toMatchObject({
      ok: true,
      source: 'league_runtime',
    })
  })

  it('🛑 refuses a player the sending roster does not own', async () => {
    await expect(validate([player('beta-wr', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'PLAYER_NOT_OWNED',
      source: 'league_runtime',
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

  it('🛑 refuses a draft pick — the path a native dynasty league reaches, which checked nothing about picks', async () => {
    await expect(
      validate([player('alpha-rb', 'alpha', 'beta'), pick('beta', 'alpha')]),
    ).resolves.toMatchObject({ ok: false, code: 'DRAFT_PICK_NOT_SETTLED', source: 'league_runtime' })
  })
})

describe('no league rules to build a runtime from: the ownership fallback still decides', () => {
  beforeEach(() => {
    h.state.sport = 'NCAAF'
    h.state.rulesMissing = true
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

  it('🛑 refuses a draft pick', async () => {
    await expect(
      validate([player('alpha-rb', 'alpha', 'beta'), pick('beta', 'alpha')]),
    ).resolves.toMatchObject({ ok: false, code: 'DRAFT_PICK_NOT_SETTLED', source: 'ownership_fallback' })
  })

  it('🛑 still answers to the deadline', async () => {
    Object.assign(h.state, { deadlineWeek: 11, week: 12 })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'TRADE_DEADLINE_PASSED',
      source: 'ownership_fallback',
    })
  })
})

/*
 * A roster layout small enough to fill: QB + RB starters, no bench, one TAXI slot. maxRosterSize 3, and the
 * active limit the runtime computes is 3 - 0 IR - 1 taxi = 2.
 */
const TIGHT_ROSTER = { roster: { config: { sections: [{ slots: { QB: 1, RB: 1, BN: 0, TAXI: 1 } }] } } }

describe('🛑 NFL DYNASTY: the same checks NFL redraft gets (it used to be ownership-only)', () => {
  beforeEach(() => {
    h.state.format = 'dynasty'
  })

  it('takes the league-wide runtime, not the fallback', async () => {
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('beta-wr', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: true,
      source: 'league_runtime',
    })
  })

  it('🛑 refuses a player whose game has kicked off this week (lineup lock)', async () => {
    h.state.kickoff = new Date(Date.now() - 60 * 60 * 1000)
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'LOCKED_PLAYER',
      source: 'league_runtime',
    })
  })

  it('🛑 refuses a trade that leaves a roster over the limit', async () => {
    h.state.leagueSettings = TIGHT_ROSTER
    h.state.extraPlayers = [h.player('beta', 'beta-te', 'TE', 'BENCH', 'MIA')]
    // alpha has 1 active player and receives 2: 3 against a limit of 2.
    await expect(
      validate([player('beta-wr', 'beta', 'alpha'), player('beta-te', 'beta', 'alpha')]),
    ).resolves.toMatchObject({ ok: false, code: 'ROSTER_LIMIT', source: 'league_runtime' })
  })

  it('a taxi-squad player does not count against the active limit', async () => {
    h.state.leagueSettings = TIGHT_ROSTER
    // beta: two active players (at the limit) plus one on the taxi squad. A 1-for-1 keeps beta at 2.
    h.state.extraPlayers = [
      h.player('beta', 'beta-te', 'TE', 'BENCH', 'MIA'),
      h.player('beta', 'beta-taxi', 'WR', 'TAXI', 'MIA'),
    ]
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('beta-wr', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: true,
      source: 'league_runtime',
    })
  })

  it('🛑 refuses after the deadline (week 12, deadline 11), measured on the server', async () => {
    Object.assign(h.state, { deadlineWeek: 11, week: 12 })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({
      ok: false,
      code: 'TRADE_DEADLINE_PASSED',
      message: 'Trade deadline passed after Week 11.',
      source: 'league_runtime',
    })
  })

  it('allows the deadline week itself (week 11, deadline 11)', async () => {
    Object.assign(h.state, { deadlineWeek: 11, week: 11 })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({ ok: true })
  })

  it("🛑 OFFSEASON: last season's week 17 is not past this season's deadline, and nothing is locked", async () => {
    // The completed season's last slate kicked off long ago: read as "this week", every player would be locked.
    Object.assign(h.state, { deadlineWeek: 11, week: 17, seasonStatus: 'complete', lifecycleState: 'offseason' })
    h.state.kickoff = new Date(Date.now() - 60 * 60 * 1000)
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('beta-wr', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: true,
      source: 'league_runtime',
    })
  })
})

describe('NFL redraft keeps its own deadline check, and also answers to the server week', () => {
  it("refuses after the deadline exactly as before (the runtime's own check, first)", async () => {
    Object.assign(h.state, { deadlineWeek: 10, week: 12 })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toEqual({
      ok: false,
      code: 'TRADE_DEADLINE_PASSED',
      message: 'Trade deadline passed after Week 10.',
      source: 'nfl_runtime',
    })
  })

  it('allows before the deadline', async () => {
    Object.assign(h.state, { deadlineWeek: 10, week: 9 })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({ ok: true, source: 'nfl_runtime' })
  })

  it('UNCHANGED: NFL redraft still counts a reserve-slot player against the limit (the exemption is dynasty-path only)', async () => {
    h.state.leagueSettings = TIGHT_ROSTER
    h.state.extraPlayers = [
      h.player('beta', 'beta-te', 'TE', 'BENCH', 'MIA'),
      h.player('beta', 'beta-taxi', 'WR', 'TAXI', 'MIA'),
    ]
    // The same 1-for-1 the dynasty path allows: here beta counts 3 against the limit of 2, as it always has.
    await expect(validate([player('alpha-rb', 'alpha', 'beta'), player('beta-wr', 'beta', 'alpha')])).resolves.toMatchObject({
      ok: false,
      code: 'ROSTER_LIMIT',
      source: 'nfl_runtime',
    })
  })
})

describe('lock all moves (`League.lockAllMoves`)', () => {
  it("UNCHANGED: NFL redraft is refused once, by the runtime's own check, with its own code and message", async () => {
    h.state.lockAllMoves = true
    // Deadline also passed: the lock is still the one refusal, as it always was (the runtime checks it first).
    Object.assign(h.state, { deadlineWeek: 10, week: 12 })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toEqual({
      ok: false,
      code: 'MOVE_LOCKED',
      message: 'Roster moves are locked by league settings.',
      source: 'nfl_runtime',
    })
  })

  it('🛑 refuses the ownership-fallback path too (no league rules), which used to check only the deadline', async () => {
    Object.assign(h.state, { sport: 'NCAAF', rulesMissing: true, lockAllMoves: true })
    await expect(validate([player('alpha-rb', 'alpha', 'beta')])).resolves.toMatchObject({ ok: false, code: 'MOVE_LOCKED' })
  })
})
