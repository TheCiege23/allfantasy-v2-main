import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Imported leagues' trades and waivers reach the commissioner hub.
 *
 * Before this, the hub counted only the native redraft tables, so every Sleeper / ESPN / Yahoo /
 * MFL / Fleaflicker league read 0 trades and 0 waivers however active it was. Imported activity
 * lives in `decision_os_imported_activity`, whose rows name their league three different ways —
 * each arm has a test below, because dropping any one of them is silent: the count just reads low.
 */

const leagueFindMany = vi.fn()
const activityFindMany = vi.fn()

/**
 * The fixture table, and a findMany that actually EVALUATES the where clause against it.
 * A mock that returned the rows regardless would pass with any OR arm deleted — measured: two
 * arm-deletion mutations survived exactly that way before this filter existed.
 */
let table: Array<Record<string, any>> = []
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  if (where.occurredAt?.gte && !(row.occurredAt >= where.occurredAt.gte)) return false
  if (where.activityType?.in && !where.activityType.in.includes(row.activityType)) return false
  if (!Array.isArray(where.OR)) return true
  return where.OR.some((arm: Record<string, any>) =>
    Object.entries(arm).every(([k, v]) =>
      v && typeof v === 'object' && Array.isArray((v as any).in) ? (v as any).in.includes(row[k]) : row[k] === v,
    ),
  )
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (args: unknown) => leagueFindMany(args) },
    decisionOsImportedActivity: { findMany: (args: unknown) => activityFindMany(args) },
  },
}))

const { loadImportedActivityByLeague, getCommissionerHubHealthForUser } = await import('@/lib/commissioner-hub/commissionerHubHealth')

const SINCE = new Date('2026-09-18T00:00:00.000Z')

function act(over: Record<string, unknown>) {
  return {
    occurredAt: new Date('2026-09-20T00:00:00.000Z'),
    id: `row-${Math.random()}`,
    provider: 'sleeper',
    providerLeagueId: 'p-1',
    afLeagueId: null,
    activityType: 'trade',
    providerEventId: 'evt-1',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  table = []
  activityFindMany.mockImplementation(async (args: any) => table.filter((row) => matches(row, args.where)))
  leagueFindMany.mockResolvedValue([
    { id: 'af-1', platform: 'sleeper', platformLeagueId: 'p-1' },
    { id: 'af-2', platform: 'yahoo', platformLeagueId: 'y-9' },
    { id: 'native-1', platform: 'allfantasy', platformLeagueId: 'n-1' },
  ])
})

describe('which rows count for which league', () => {
  it('counts a row keyed by afLeagueId', async () => {
    // No provider identity on the league, so afLeagueId is the ONLY arm that can find this row.
    leagueFindMany.mockResolvedValue([{ id: 'af-1', platform: 'sleeper', platformLeagueId: null }])
    table = [act({ afLeagueId: 'af-1', providerLeagueId: 'p-1' })]
    const { trades } = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(trades.get('af-1')).toBe(1)
  })

  it('counts an old row that holds OUR id in providerLeagueId', async () => {
    table = [act({ providerLeagueId: 'af-1', afLeagueId: null })]
    const { trades } = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(trades.get('af-1')).toBe(1)
  })

  it('🛑 counts a shared provider league whose rows attached to ANOTHER importer', async () => {
    // externalSourceKey is globally unique, so this event is stored under the other user's league.
    table = [act({ afLeagueId: 'someone-elses-af-league', providerLeagueId: 'p-1' })]
    const { trades } = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(trades.get('af-1')).toBe(1)
  })

  it('does not let a Sleeper id match a different provider carrying the same digits', async () => {
    table = [act({ provider: 'espn', providerLeagueId: 'p-1' })]
    const { trades } = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(trades.get('af-1')).toBeUndefined()
  })

  it('builds no identity arm for a native league', async () => {
    table = []
    await loadImportedActivityByLeague(['native-1'], SINCE)
    const or = activityFindMany.mock.calls[0][0].where.OR as Array<Record<string, unknown>>
    expect(or.some((arm) => arm.provider === 'allfantasy')).toBe(false)
  })
})

describe('what counts as what', () => {
  it('🛑 counts Yahoo roster_move adds as waiver activity, not zero', async () => {
    table = [
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'roster_move', providerEventId: 'a' }),
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'roster_move', providerEventId: 'b' }),
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'waiver', providerEventId: 'c' }),
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'trade', providerEventId: 'd' }),
    ]
    const { trades, waivers } = await loadImportedActivityByLeague(['af-2'], SINCE)
    expect(waivers.get('af-2')).toBe(3)
    expect(trades.get('af-2')).toBe(1)
  })

  it('asks only for the last-seven-days trade/waiver/roster_move window', async () => {
    table = []
    await loadImportedActivityByLeague(['af-1'], SINCE)
    const where = activityFindMany.mock.calls[0][0].where
    expect(where.occurredAt).toEqual({ gte: SINCE })
    expect([...where.activityType.in].sort()).toEqual(['roster_move', 'trade', 'waiver'])
  })

  it('🛑 counts one event once even when it exists in both id spaces', async () => {
    table = [
      act({ id: 'old', providerLeagueId: 'af-1', afLeagueId: null, providerEventId: 'evt-7' }),
      act({ id: 'new', providerLeagueId: 'p-1', afLeagueId: 'af-1', providerEventId: 'evt-7' }),
    ]
    const { trades } = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(trades.get('af-1')).toBe(1)
  })
})

describe('the window', () => {
  it('ignores activity older than the window', async () => {
    table = [act({ afLeagueId: 'af-1', occurredAt: new Date('2026-09-01T00:00:00.000Z') })]
    const { trades } = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(trades.get('af-1')).toBeUndefined()
  })

  it('ignores draft picks', async () => {
    table = [act({ afLeagueId: 'af-1', activityType: 'draft_pick' })]
    const out = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(out.trades.size + out.waivers.size).toBe(0)
  })
})

describe('failure', () => {
  it('returns empty maps rather than throwing, so the hub keeps its native counts', async () => {
    activityFindMany.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await loadImportedActivityByLeague(['af-1'], SINCE)
    expect(out.trades.size).toBe(0)
    expect(out.waivers.size).toBe(0)
    warn.mockRestore()
  })

  it('makes no query for an empty league list', async () => {
    await loadImportedActivityByLeague([], SINCE)
    expect(leagueFindMany).not.toHaveBeenCalled()
    expect(activityFindMany).not.toHaveBeenCalled()
  })
})

describe('the hub snapshot', () => {
  it('🛑 adds imported trades and waivers to the metrics the hub shows', async () => {
    // Every native table is absent from the prisma mock, so the native counts are 0: whatever the
    // snapshot reports can only have come from the imported activity.
    leagueFindMany.mockResolvedValue([
      { id: 'af-2', platform: 'yahoo', platformLeagueId: 'y-9', name: 'Yahoo League', sport: 'NBA', rosters: [] },
    ])
    const recent = new Date(Date.now() - 60 * 60 * 1000)
    table = [
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'trade', providerEventId: 't1', occurredAt: recent }),
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'roster_move', providerEventId: 'r1', occurredAt: recent }),
      act({ provider: 'yahoo', providerLeagueId: 'y-9', afLeagueId: 'af-2', activityType: 'roster_move', providerEventId: 'r2', occurredAt: recent }),
    ]
    const [snap] = await getCommissionerHubHealthForUser('user-1', [
      { id: 'af-2', name: 'Yahoo League', sport: 'NBA', isCommissioner: true } as any,
    ])
    expect(snap.source).toBe('database')
    expect(snap.metrics.tradeActivity).toBe(1)
    expect(snap.metrics.waiverActivity).toBe(2)
    // Completed imported events never become PENDING work: those actions act on native tables.
    expect(snap.metrics.pendingTrades).toBe(0)
    expect(snap.metrics.pendingWaiverClaims).toBe(0)
  })
})
