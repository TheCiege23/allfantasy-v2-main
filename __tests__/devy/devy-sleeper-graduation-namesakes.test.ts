import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Sleeper graduation must identify the PROSPECT, not just the name.
 *
 * 🛑 WHAT THIS GUARDS. `classifyDraftStatus` built a last-wins name map over
 * every Sleeper NFL player and graduated any college prospect whose name and
 * position hit it. Production rows with statusSource='sleeper' on 2026-10-12
 * (fixtures below are those rows, verbatim where it matters):
 *
 *   Michael Johnson Jr.  WR Baylor, class 3        -> 2754, Delaware, years_exp 10
 *   Devin Carter         WR Florida State, class 1 -> 12019, West Virginia
 *   Marquez Stevenson    WR Tulane, class 4        -> 7556, Houston
 *
 * and three matched to Sleeper rows with years_exp 0, no team and no college
 * (Smothers, Moss, Fletcher). Those pass a years_exp check, yet all three are
 * on CFBD's 2026 roster (lastRosterYear=2026). Off a roster such a match may
 * graduate; on one it may not.
 */

const findMany = vi.fn()
const update = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyPlayer: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))
vi.mock('@/lib/prisma-json', () => ({ toPrismaJsonInput: (v: unknown) => v }))
vi.mock('@/lib/cfbd-env', () => ({
  getCfbdApiKey: () => 'test-key-not-a-real-credential',
  hasCfbdApiKey: () => true,
  CFBD_ENV_VARS: ['CFBD_API_KEY'],
}))
vi.mock('@/lib/cfb-player-data', () => ({
  getCFBDraftPicksResult: vi.fn(async () => ({ ok: true, data: [] })),
  getCFBTeamRosterResult: vi.fn(async () => ({ ok: true, data: [] })),
}))

const CURRENT_YEAR = 2026

type Prospect = {
  name: string
  position: string
  school: string
  classYear: number | null
  draftYear: number | null
  draftEligibleYear: number | null
}

const MJ: Prospect = { name: 'Michael Johnson Jr.', position: 'WR', school: 'Baylor', classYear: 3, draftYear: null, draftEligibleYear: 2027 }
const CARTER: Prospect = { name: 'Devin Carter', position: 'WR', school: 'Florida State', classYear: 1, draftYear: null, draftEligibleYear: 2029 }
const STEVENSON: Prospect = { name: 'Marquez Stevenson', position: 'WR', school: 'Tulane', classYear: 4, draftYear: null, draftEligibleYear: 2026 }
const FLETCHER: Prospect = { name: 'Mark Fletcher Jr.', position: 'RB', school: 'Miami', classYear: 4, draftYear: null, draftEligibleYear: 2026 }
const SMOTHERS: Prospect = { name: 'Hollywood Smothers', position: 'RB', school: 'Texas', classYear: 3, draftYear: null, draftEligibleYear: 2027 }

const SLEEPER: Record<string, any> = {
  '2754': { first_name: 'Michael', last_name: 'Johnson', position: 'WR', team: null, status: 'Inactive', years_exp: 10, college: 'Delaware' },
  '12019': { first_name: 'Devin', last_name: 'Carter', position: 'WR', team: null, status: 'Active', years_exp: 1, college: 'West Virginia' },
  '7556': { first_name: 'Marquez', last_name: 'Stevenson', position: 'WR', team: null, status: 'Active', years_exp: 2, college: 'Houston' },
  '13271': { first_name: 'Mark', last_name: 'Fletcher', position: 'RB', team: null, status: 'Active', years_exp: 0, college: null },
  '13283': { first_name: 'Hollywood', last_name: 'Smothers', position: 'RB', team: null, status: 'Active', years_exp: 0 },
}

async function load() {
  return import('@/lib/devy-classification')
}

describe('resolveSleeperGraduation — the identity rule', () => {
  it('refuses the three production namesakes', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex(SLEEPER)
    for (const p of [MJ, CARTER, STEVENSON]) {
      const v = resolveSleeperGraduation(index, p, CURRENT_YEAR)
      expect(v.match, p.name).toBeNull()
      expect(v.reason, p.name).toBe('identity_mismatch')
    }
  })

  it('still graduates a rookie with no Sleeper college whose entry year fits', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex(SLEEPER)
    expect(resolveSleeperGraduation(index, FLETCHER, CURRENT_YEAR)).toMatchObject({
      match: { id: '13271' }, reason: 'years_exp_verified',
    })
    expect(resolveSleeperGraduation(index, SMOTHERS, CURRENT_YEAR)).toMatchObject({
      match: { id: '13283' }, reason: 'years_exp_verified',
    })
  })

  it("never graduates a player on this season's college roster (the 2026-04-26 placeholder rows)", async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex(SLEEPER)
    for (const p of [FLETCHER, SMOTHERS]) {
      expect(resolveSleeperGraduation(index, { ...p, onCurrentCollegeRoster: true }, CURRENT_YEAR).match, p.name).toBeNull()
    }
  })

  it('graduates on a college match, case and spacing aside', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex({
      '99': { first_name: 'Devin', last_name: 'Carter', position: 'WR', years_exp: 0, college: 'florida  state' },
    })
    expect(resolveSleeperGraduation(index, CARTER, CURRENT_YEAR)).toMatchObject({
      match: { id: '99' }, reason: 'college_verified',
    })
  })

  it('a stated college that disagrees is not rescued by a rookie years_exp', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex({
      '1': { first_name: 'Marquez', last_name: 'Stevenson', position: 'WR', years_exp: 0, college: 'Houston' },
    })
    expect(resolveSleeperGraduation(index, STEVENSON, CURRENT_YEAR).match).toBeNull()
  })

  it('without a college, a veteran years_exp is refused for a class-3 prospect', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex({
      '2754': { first_name: 'Michael', last_name: 'Johnson', position: 'WR', years_exp: 10 },
    })
    expect(resolveSleeperGraduation(index, MJ, CURRENT_YEAR)).toMatchObject({ match: null, reason: 'identity_mismatch' })
  })

  it('refuses when years_exp is unknown and there is no college', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex({ '1': { first_name: 'Mark', last_name: 'Fletcher', position: 'RB' } })
    expect(resolveSleeperGraduation(index, FLETCHER, CURRENT_YEAR).match).toBeNull()
  })

  it('refuses two verified namesakes instead of taking either (no last-wins)', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex({
      '1': { first_name: 'Mark', last_name: 'Fletcher', position: 'RB', years_exp: 0, college: 'Miami' },
      '2': { first_name: 'Mark', last_name: 'Fletcher', position: 'RB', years_exp: 0 },
    })
    const v = resolveSleeperGraduation(index, FLETCHER, CURRENT_YEAR)
    expect(v).toMatchObject({ match: null, reason: 'ambiguous', candidateCount: 2 })
  })

  it('a namesake that fails verification does not make a real one ambiguous', async () => {
    const { buildSleeperNflIndex, resolveSleeperGraduation } = await load()
    const index = buildSleeperNflIndex({
      '1': { first_name: 'Mark', last_name: 'Fletcher', position: 'RB', years_exp: 9, college: 'Oregon' },
      '2': { first_name: 'Mark', last_name: 'Fletcher', position: 'RB', years_exp: 0, college: 'Miami' },
    })
    expect(resolveSleeperGraduation(index, FLETCHER, CURRENT_YEAR).match?.id).toBe('2')
  })
})

describe('classifyDraftStatus — what the writer actually persists', () => {
  const realFetch = globalThis.fetch

  function row(p: Prospect, extra: Record<string, unknown> = {}) {
    return {
      id: `id-${p.name}`, normalizedName: null, draftStatus: 'college', nflTeam: null, sleeperId: null,
      nflDraftRound: null, nflDraftPick: null, devyEligible: true, graduatedToNFL: false, league: 'NCAA',
      statusSource: 'cfbd_roster', lastRosterYear: CURRENT_YEAR, ...p, ...extra,
    }
  }

  async function run(rows: unknown[], sleeper: Record<string, any> | null) {
    findMany.mockResolvedValue(rows)
    update.mockResolvedValue({})
    globalThis.fetch = vi.fn(async () =>
      sleeper ? ({ ok: true, json: async () => sleeper } as any) : ({ ok: false, status: 503, json: async () => ({}) } as any),
    ) as any
    const { classifyDraftStatus } = await load()
    const p = classifyDraftStatus(CURRENT_YEAR)
    await vi.runAllTimersAsync()
    await p
    return new Map(update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data]))
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    findMany.mockReset()
    update.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('leaves a namesake prospect devy-eligible, and graduates the verified rookie', async () => {
    const writes = await run([row(MJ), row(FLETCHER)], SLEEPER)
    expect(writes.get(`id-${MJ.name}`)).toMatchObject({
      graduatedToNFL: false, devyEligible: true, league: 'NCAA', sleeperId: null,
    })
    expect(writes.get(`id-${MJ.name}`)?.draftStatus).not.toBe('nfl_active')
    expect(writes.get(`id-${FLETCHER.name}`)).toMatchObject({
      draftStatus: 'nfl_active', statusSource: 'sleeper', graduatedToNFL: true, devyEligible: false, sleeperId: '13271',
    })
  })

  it('un-graduates a row an earlier unverified run stamped, and drops the stranger’s sleeperId', async () => {
    const stamped = row(MJ, {
      draftStatus: 'nfl_active', statusSource: 'sleeper', sleeperId: '2754', nflTeam: '',
      graduatedToNFL: true, devyEligible: false, league: 'NFL',
    })
    const writes = await run([stamped], SLEEPER)
    expect(writes.get(`id-${MJ.name}`)).toMatchObject({
      graduatedToNFL: false, devyEligible: true, league: 'NCAA', sleeperId: null, nflTeam: null,
    })
  })

  it('a stamped placeholder graduate on the current CFBD roster goes back to college', async () => {
    const cfb = await import('@/lib/cfb-player-data')
    vi.mocked(cfb.getCFBTeamRosterResult).mockImplementation(async (team: string) =>
      ({ ok: true, data: team === 'Miami' ? [{ fullName: 'Mark Fletcher Jr.', position: 'RB' }] : [] }) as any,
    )
    const stamped = row(FLETCHER, {
      normalizedName: 'mark fletcher', draftStatus: 'nfl_active', statusSource: 'sleeper', sleeperId: '13271',
      nflTeam: '', graduatedToNFL: true, devyEligible: false, league: 'NFL',
    })
    try {
      const writes = await run([stamped], SLEEPER)
      expect(writes.get(`id-${FLETCHER.name}`)).toMatchObject({
        statusSource: 'cfbd_roster', graduatedToNFL: false, devyEligible: true, league: 'NCAA', sleeperId: null,
      })
    } finally {
      vi.mocked(cfb.getCFBTeamRosterResult).mockImplementation(async () => ({ ok: true, data: [] }) as any)
    }
  })

  it('a Sleeper outage does not wipe a stamped sleeperId', async () => {
    const stamped = row(FLETCHER, {
      draftStatus: 'nfl_active', statusSource: 'sleeper', sleeperId: '13271', graduatedToNFL: true, devyEligible: false, league: 'NFL',
    })
    const writes = await run([stamped], null)
    expect(writes.get(`id-${FLETCHER.name}`)?.sleeperId).toBe('13271')
  })
})
