import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Dynasty-only commissioner health signals: pick balance and taxi squads over their limit, and how
 * they reach the health snapshot (whose `alerts` the commissioner health decision — and through it
 * Chimmy's commissioner grounding — reads).
 *
 * The rule under test everywhere: a measured signal carries real counts; an unmeasured one says
 * why; and a league that is not dynasty gets EXACTLY the snapshot it got before.
 */

const leagueFindMany = vi.fn()
const leagueTeamFindMany = vi.fn()
const rosterFindMany = vi.fn()
const loadCapital = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (args: unknown) => leagueFindMany(args) },
    leagueTeam: { findMany: (args: unknown) => leagueTeamFindMany(args) },
    roster: { findMany: (args: unknown) => rosterFindMany(args) },
    decisionOsImportedActivity: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/dynasty-war-room/dynastyPickCapital', () => ({
  loadDynastyPickCapital: (args: unknown) => loadCapital(args),
}))

const {
  computePickBalance,
  computeTaxiOverLimit,
  dynastyAlertLines,
  HEAVY_PICKS_MULTIPLE,
} = await import('@/lib/commissioner-hub/dynastyHealthSignals')
const { readTaxiLimit, loadDynastySignalsByLeague } = await import('@/lib/commissioner-hub/dynastyHealthReads')
const { getCommissionerHubHealthForUser, withDynastyAlerts } = await import('@/lib/commissioner-hub/commissionerHubHealth')

const picks = (...seasons: number[]) => seasons.map((season) => ({ season }))
const team = (rosterId: string, teamName: string | null, isViewer = false) => ({ rosterId, teamName, isViewer })

describe('pick balance', () => {
  const teams = [team('r1', 'Wolves', true), team('r2', 'Owls'), team('r3', 'Comets'), team('r4', 'Hawks')]

  it('counts each team’s picks across the next three drafts, and the next draft on its own', () => {
    const out = computePickBalance({
      state: 'available',
      picksByRosterId: new Map([
        ['r1', picks(2027, 2027, 2028, 2029, 2030)],
        ['r2', picks(2027, 2028, 2029)],
        ['r3', picks(2028)],
        ['r4', picks(2027, 2028, 2029)],
      ]),
      teams,
    })
    expect(out.measured).toBe(true)
    if (!out.measured) return
    expect(out.seasons).toEqual([2027, 2028, 2029])
    const byId = Object.fromEntries(out.rows.map((r) => [r.rosterId, r]))
    // 2030 is outside the window.
    expect(byId.r1).toMatchObject({ total: 4, inNextDraft: 2, isViewer: true, flag: null })
    expect(byId.r3).toMatchObject({ total: 1, inNextDraft: 0, flag: 'none_next' })
    expect(out.average).toBe(2.8)
    // Most picks first.
    expect(out.rows[0].rosterId).toBe('r1')
  })

  it('flags a team holding far more than average — more than double AND at least three over', () => {
    const many = picks(...Array.from({ length: 12 }, (_, i) => 2027 + (i % 3)))
    const out = computePickBalance({
      state: 'available',
      picksByRosterId: new Map([
        ['r1', many],
        ['r2', picks(2027, 2028)],
        ['r3', picks(2027, 2028)],
        ['r4', picks(2027, 2028)],
      ]),
      teams,
    })
    if (!out.measured) throw new Error('expected measured')
    expect(out.average).toBe(4.5)
    expect(12 > out.average * HEAVY_PICKS_MULTIPLE).toBe(true)
    expect(out.rows.find((r) => r.rosterId === 'r1')?.flag).toBe('heavy')
    expect(out.rows.filter((r) => r.flag === 'heavy')).toHaveLength(1)
  })

  it('does not flag three picks in a league averaging one: double, but not three over', () => {
    const out = computePickBalance({
      state: 'available',
      picksByRosterId: new Map([
        ['r1', picks(2027, 2027, 2027)],
        ['r2', picks(2027)],
        ['r3', picks(2027)],
        ['r4', picks(2027)],
      ]),
      teams,
      drafts: 1,
    })
    if (!out.measured) throw new Error('expected measured')
    expect(out.rows.every((r) => r.flag === null)).toBe(true)
  })

  it('a team with no rows at all is a team holding no picks — when the league’s picks ARE on file', () => {
    const out = computePickBalance({
      state: 'available',
      picksByRosterId: new Map([['r1', picks(2027)]]),
      teams: [team('r1', 'Wolves'), team('r2', 'Owls')],
    })
    if (!out.measured) throw new Error('expected measured')
    expect(out.rows.find((r) => r.rosterId === 'r2')).toMatchObject({ total: 0, flag: 'none_next' })
  })

  it('treats a stale read as the league’s picks', () => {
    const out = computePickBalance({ state: 'stale', picksByRosterId: new Map([['r1', picks(2027)]]), teams: [team('r1', 'W')] })
    expect(out.measured).toBe(true)
  })

  it.each([
    ['missing', 'missing'],
    ['partial', 'partial'],
    ['available_empty', 'empty'],
  ] as const)('🛑 refuses to draw bars for a %s read (reason %s) rather than call every team pickless', (state, reason) => {
    expect(computePickBalance({ state, picksByRosterId: new Map([['r1', picks(2027)]]), teams })).toEqual({ measured: false, reason })
  })

  it('an "available" read with no picks for any team here is empty, not every team at zero', () => {
    expect(computePickBalance({ state: 'available', picksByRosterId: new Map([['other', picks(2027)]]), teams })).toEqual({
      measured: false,
      reason: 'empty',
    })
  })

  it('no teams is its own reason', () => {
    expect(computePickBalance({ state: 'available', picksByRosterId: new Map(), teams: [] })).toEqual({ measured: false, reason: 'no_teams' })
  })
})

describe('taxi over limit', () => {
  it('names the teams holding more taxi players than the limit, most first', () => {
    const out = computeTaxiOverLimit({
      limit: 3,
      rosters: [
        { rosterId: 'a', teamName: 'Owls', taxiCount: 4 },
        { rosterId: 'b', teamName: 'Hawks', taxiCount: 3 },
        { rosterId: 'c', teamName: 'Comets', taxiCount: 6 },
      ],
    })
    expect(out).toEqual({
      measured: true,
      limit: 3,
      teams: [
        { rosterId: 'c', teamName: 'Comets', held: 6 },
        { rosterId: 'a', teamName: 'Owls', held: 4 },
      ],
    })
  })

  it('an unknown limit is unmeasured, never "nobody is over"', () => {
    expect(computeTaxiOverLimit({ limit: null, rosters: [{ rosterId: 'a', teamName: 'x', taxiCount: 9 }] })).toEqual({ measured: false, reason: 'no_limit' })
  })

  it('no rosters is unmeasured', () => {
    expect(computeTaxiOverLimit({ limit: 3, rosters: [] })).toEqual({ measured: false, reason: 'no_rosters' })
  })

  it('reads the native column, and an import’s own taxi_slots — never an import’s schema default', () => {
    expect(readTaxiLimit({ platform: 'allfantasy', taxiSlots: 4, settings: { taxi_slots: 9 } })).toBe(4)
    expect(readTaxiLimit({ platform: 'sleeper', taxiSlots: 0, settings: { taxi_slots: 3 } })).toBe(3)
    expect(readTaxiLimit({ platform: 'sleeper', taxiSlots: 0, settings: {} })).toBeNull()
    expect(readTaxiLimit({ platform: 'mfl', taxiSlots: 4, settings: null })).toBeNull()
  })
})

describe('alert lines (what Chimmy’s grounding reads)', () => {
  it('states only measured findings, with their real counts', () => {
    const lines = dynastyAlertLines({
      picks: {
        measured: true,
        seasons: [2027, 2028, 2029],
        average: 9,
        rows: [
          { rosterId: 'a', teamName: 'Wolves', isViewer: false, total: 21, inNextDraft: 7, flag: 'heavy' },
          { rosterId: 'b', teamName: 'Comets', isViewer: false, total: 3, inNextDraft: 0, flag: 'none_next' },
          { rosterId: 'c', teamName: 'Owls', isViewer: false, total: 9, inNextDraft: 3, flag: null },
        ],
      },
      taxi: { measured: true, limit: 3, teams: [{ rosterId: 'd', teamName: 'Hawks', held: 5 }] },
    })
    expect(lines).toEqual([
      'Dynasty picks: Comets holds no pick in the 2027 draft.',
      'Dynasty picks: Wolves holds 21 picks across the next 3 drafts, against a league average of 9.',
      'Taxi squads over the 3-slot limit: Hawks (5).',
    ])
  })

  it('adds nothing for an unmeasured or healthy league', () => {
    expect(dynastyAlertLines({ picks: { measured: false, reason: 'partial' }, taxi: { measured: false, reason: 'no_limit' } })).toEqual([])
    expect(dynastyAlertLines({ picks: { measured: true, seasons: [2027], average: 3, rows: [] }, taxi: { measured: true, limit: 3, teams: [] } })).toEqual([])
  })

  it('keeps the engine’s two most urgent alerts first and the cap of four', () => {
    const signals = { picks: { measured: false as const, reason: 'missing' as const }, taxi: { measured: true as const, limit: 2, teams: [{ rosterId: 'x', teamName: 'Owls', held: 3 }] } }
    expect(withDynastyAlerts(['a', 'b', 'c', 'd'], signals)).toEqual(['a', 'b', 'Taxi squads over the 2-slot limit: Owls (3).', 'c'])
    expect(withDynastyAlerts(['a'], { ...signals, taxi: { measured: true, limit: 2, teams: [] } })).toEqual(['a'])
  })
})

// ── The loader ──────────────────────────────────────────────────────────────

const LEAGUES: Record<string, Record<string, unknown>> = {
  dyn: { id: 'dyn', name: 'Dynasty Dragons', sport: 'NBA', platform: 'allfantasy', season: 2026, settings: {}, taxiSlots: 2, isDynasty: true, leagueType: 'dynasty', leagueVariant: null, guillotineMode: false, rosters: [] },
  red: { id: 'red', name: 'Redraft Rally', sport: 'NBA', platform: 'allfantasy', season: 2026, settings: {}, taxiSlots: 0, isDynasty: false, leagueType: 'redraft', leagueVariant: null, guillotineMode: false, rosters: [] },
  gui: { id: 'gui', name: 'Guillotine', sport: 'NBA', platform: 'allfantasy', season: 2026, settings: {}, taxiSlots: 3, isDynasty: true, leagueType: 'dynasty', leagueVariant: null, guillotineMode: true, rosters: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T12:00:00.000Z'))
  leagueFindMany.mockImplementation(async (args: any) => (args.where.id.in as string[]).map((id) => LEAGUES[id]).filter(Boolean))
  leagueTeamFindMany.mockResolvedValue([
    { id: 't1', externalId: '1', platformUserId: 'u1', claimedByUserId: 'viewer', teamName: 'Wolves', ownerName: null },
    { id: 't2', externalId: '2', platformUserId: 'u2', claimedByUserId: null, teamName: null, ownerName: 'owl_owner' },
  ])
  rosterFindMany.mockResolvedValue([
    { id: 'r1', platformUserId: 'u1', playerData: { taxi: ['p1', 'p2', 'p3'] } },
    { id: 'r2', platformUserId: 'u2', playerData: { taxi: ['p4'] } },
    // A leftover row with no team behind it is no franchise.
    { id: 'r9', platformUserId: 'ghost', playerData: { taxi: ['x', 'y', 'z', 'w'] } },
  ])
  loadCapital.mockResolvedValue({
    state: 'available',
    note: null,
    picksByRosterId: new Map([
      ['r1', picks(2027, 2028)],
      ['r2', picks(2028)],
    ]),
  })
})
afterEach(() => vi.useRealTimers())

describe('loadDynastySignalsByLeague', () => {
  it('reads only the dynasty leagues — not redraft, not guillotine', async () => {
    const out = await loadDynastySignalsByLeague(['dyn', 'red', 'gui'], 'viewer')
    expect([...out.keys()]).toEqual(['dyn'])
    expect(leagueTeamFindMany).toHaveBeenCalledTimes(1)
    expect(leagueTeamFindMany.mock.calls[0][0].where).toEqual({ leagueId: 'dyn' })
  })

  it('builds the signals from the rows: viewer, names, taxi counts against the slot limit', async () => {
    const out = (await loadDynastySignalsByLeague(['dyn'], 'viewer')).get('dyn')!
    expect(out.taxi).toEqual({ measured: true, limit: 2, teams: [{ rosterId: 'r1', teamName: 'Wolves', held: 3 }] })
    if (!out.picks.measured) throw new Error('expected measured')
    expect(out.picks.rows.map((r) => [r.teamName, r.isViewer, r.total, r.flag])).toEqual([
      ['Wolves', true, 2, null],
      ['owl_owner', false, 1, 'none_next'],
    ])
  })

  it('a failed read leaves the league out rather than guessing', async () => {
    rosterFindMany.mockRejectedValue(new Error('db down'))
    expect((await loadDynastySignalsByLeague(['dyn'], 'viewer')).size).toBe(0)
  })

  it('makes no read for no leagues', async () => {
    await loadDynastySignalsByLeague([], 'viewer')
    expect(leagueFindMany).not.toHaveBeenCalled()
  })
})

describe('the health snapshot', () => {
  const asLeagues = (...ids: string[]) => ids.map((id) => ({ id, name: String(LEAGUES[id].name), sport: 'NBA', isCommissioner: true }) as any)

  it('🛑 a non-dynasty league’s snapshot is identical with the option on and off', async () => {
    const off = await getCommissionerHubHealthForUser('viewer', asLeagues('red'))
    const on = await getCommissionerHubHealthForUser('viewer', asLeagues('red'), { dynastySignals: true })
    expect(on).toEqual(off)
    expect(Object.keys(on[0])).not.toContain('dynasty')
    expect(leagueTeamFindMany).not.toHaveBeenCalled()
  })

  it('without the option, even a dynasty league is untouched and nothing extra is read', async () => {
    const [snap] = await getCommissionerHubHealthForUser('viewer', asLeagues('dyn'))
    expect(snap).not.toHaveProperty('dynasty')
    expect(leagueTeamFindMany).not.toHaveBeenCalled()
    expect(loadCapital).not.toHaveBeenCalled()
  })

  it('with it, a dynasty league carries the signals and its findings reach the alerts', async () => {
    const [plain] = await getCommissionerHubHealthForUser('viewer', asLeagues('dyn'))
    const [snap] = await getCommissionerHubHealthForUser('viewer', asLeagues('dyn'), { dynastySignals: true })
    expect(snap.dynasty?.taxi).toMatchObject({ measured: true, limit: 2 })
    expect(snap.alerts).toContain('Dynasty picks: owl_owner holds no pick in the 2027 draft.')
    expect(snap.alerts).toContain('Taxi squads over the 2-slot limit: Wolves (3).')
    // The score is the engine's, untouched: these signals carry none.
    expect(snap.healthScore).toBe(plain.healthScore)
    const { dynasty: _d, alerts: _a, ...rest } = snap
    const { alerts: _pa, ...plainRest } = plain
    expect(rest).toEqual(plainRest)
  })
})
