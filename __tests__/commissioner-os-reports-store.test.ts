import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Commissioner Reports: what the catalog builds, and what the store does with it.
 *
 * 🛑 THE CLAIM THIS MODULE HAD TO EARN is that `generatedAt`, `status`, `format` and `sizeLabel`
 * are MEASUREMENTS rather than inventions — that was the module's own stated reason for shipping
 * unwired. So the assertions here are aimed at exactly that: the size is the real byte length of
 * the real artifact, a failure is recorded rather than swallowed, and the artifact is stored rather
 * than rebuilt.
 *
 * Every one of these has been watched to fail under a deliberate mutation.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  readWarehouseAnalytics: vi.fn(),
  readAnalyticsDataWindow: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commissionerReportRun: {
      create: mocks.create,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
    },
  },
}))

vi.mock('@/lib/commissioner-ui/analytics/warehouseReads', () => ({
  readWarehouseAnalytics: mocks.readWarehouseAnalytics,
}))
vi.mock('@/lib/commissioner-ui/analytics/dataWindow', () => ({
  readAnalyticsDataWindow: mocks.readAnalyticsDataWindow,
}))

import { REPORT_TEMPLATES, findTemplate } from '@/lib/commissioner-reports/reportCatalog'
import { countSubstantiveRows, generateReport, readReportContent, templatesDue } from '@/lib/commissioner-reports/reportStore'

const NOW = new Date('2026-09-08T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

const SNAPSHOT = {
  seasonLabel: '2025',
  pointsForAgainst: [{ teamName: 'Ada', pointsFor: 1412.63, pointsAgainst: 1203.41 }],
  scoringDistribution: [],
  competitiveBalance: [],
  seasonComparison: [{ seasonLabel: '2025', value: 118.44 }],
  transactionsByWeek: [{ weekLabel: 'Wk 6', tradeCount: 2, waiverClaimCount: 9 }],
  managerActivity: [{ managerName: 'Ada', actionsPerWeek: 12, priorActionsPerWeek: 7 }],
  activityMix: [{ label: 'Waiver', count: 31 }],
  managerFingerprints: [{ managerName: 'Ada', aggression: 41, activity: 36, tradeFrequency: 88, riskTolerance: 54, labels: [] }],
  fingerprintAxisMax: { aggression: 45, activity: 38, tradeFrequency: 100, riskTolerance: 63 },
  allTimeRecords: [{ teamName: 'Ada', wins: 63, losses: 20, seasons: 6, titles: 2 }],
}

const WINDOW = {
  lookbackDays: 90,
  inactiveAfterDays: 14,
  lastActivityAt: '2026-09-07T00:00:00.000Z',
  daysSinceLastActivity: 1,
  allTime: { tradeCount: 7, waiverCount: 31, eventCount: 400 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readWarehouseAnalytics.mockResolvedValue(SNAPSHOT)
  mocks.readAnalyticsDataWindow.mockResolvedValue(WINDOW)
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `row-${data.templateId}` }))
  mocks.groupBy.mockResolvedValue([])
})

describe('the catalog', () => {
  it('🛑 EVERY TEMPLATE BUILDS — the catalog cannot advertise what the code cannot make', () => {
    expect(REPORT_TEMPLATES.length).toBeGreaterThan(0)
    for (const t of REPORT_TEMPLATES) {
      const csv = t.build(SNAPSHOT as never, WINDOW as never)
      expect(csv.split('\n').length, `${t.id} produced no rows`).toBeGreaterThan(1)
      expect(csv.startsWith('Section,Label,Value'), `${t.id} has no header`).toBe(true)
    }
  })

  it('leads every artifact with provenance, because a file outlives the screen it came from', () => {
    for (const t of REPORT_TEMPLATES) {
      const csv = t.build(SNAPSHOT as never, WINDOW as never)
      expect(csv, t.id).toContain('Scoring season')
      expect(csv, t.id).toContain('Days since newest activity')
    }
  })

  it('still builds when the data window is unknown rather than omitting the whole report', () => {
    for (const t of REPORT_TEMPLATES) {
      const csv = t.build(SNAPSHOT as never, null)
      expect(csv.split('\n').length, t.id).toBeGreaterThan(1)
    }
  })

  it('produces genuinely DIFFERENT cuts — four templates, not one under four names', () => {
    const outputs = REPORT_TEMPLATES.map((t) => t.build(SNAPSHOT as never, WINDOW as never))
    expect(new Set(outputs).size).toBe(REPORT_TEMPLATES.length)
  })
})

describe('generateReport', () => {
  it('⚠ stores the REAL byte length, not the string length', async () => {
    // A multi-byte team name is the case that separates the two, and it is routine in real leagues.
    mocks.readWarehouseAnalytics.mockResolvedValue({
      ...SNAPSHOT,
      allTimeRecords: [{ teamName: 'Ünïcödé Fürÿ', wins: 1, losses: 1, seasons: 1, titles: 0 }],
    })

    const result = await generateReport('lg-1', 'season-recap', 'You', NOW)

    const written = mocks.create.mock.calls[0][0].data
    expect(written.sizeBytes).toBe(Buffer.byteLength(written.content as string, 'utf8'))
    expect(written.sizeBytes).toBeGreaterThan((written.content as string).length)
    expect(result.status).toBe('ready')
  })

  it('stores the artifact itself, so a later read cannot silently rebuild a different file', async () => {
    await generateReport('lg-1', 'season-recap', 'Scheduled', NOW)
    const written = mocks.create.mock.calls[0][0].data
    expect(typeof written.content).toBe('string')
    expect(written.content).toContain('All-time record')
    expect(written.generatedAt).toEqual(NOW)
    expect(written.format).toBe('csv')
  })

  it('🛑 RECORDS A FAILURE INSTEAD OF SWALLOWING IT', async () => {
    mocks.readWarehouseAnalytics.mockRejectedValue(new Error('warehouse exploded'))

    const result = await generateReport('lg-1', 'season-recap', 'You', NOW)

    expect(result.status).toBe('failed')
    const written = mocks.create.mock.calls[0][0].data
    expect(written.status).toBe('failed')
    expect(written.failureReason).toContain('warehouse exploded')
    // Nothing to keep, and no size claimed for a file that does not exist.
    expect(written.content).toBeNull()
    expect(written.sizeBytes).toBe(0)
  })

  it('never claims a share it cannot honour', async () => {
    await generateReport('lg-1', 'season-recap', 'You', NOW)
    expect(mocks.create.mock.calls[0][0].data.shareStatus).toBe('private')
  })

  it('refuses a template that does not exist rather than writing an empty row', async () => {
    await expect(generateReport('lg-1', 'not-a-template', 'You', NOW)).rejects.toThrow(/unknown report template/)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('readReportContent', () => {
  it('⚠ scopes by LEAGUE as well as id — an unguessable id is not an authorization model', async () => {
    mocks.findFirst.mockResolvedValue({ content: 'a,b,c', templateId: 'season-recap' })
    await readReportContent('lg-1', 'rep-1')
    const where = mocks.findFirst.mock.calls[0][0].where
    expect(where.leagueId).toBe('lg-1')
    expect(where.id).toBe('rep-1')
    // A failed run has no artifact; serving one would be serving nothing as something.
    expect(where.status).toBe('ready')
  })

  it('returns null for a row with no stored artifact', async () => {
    mocks.findFirst.mockResolvedValue({ content: null, templateId: 'season-recap' })
    await expect(readReportContent('lg-1', 'rep-1')).resolves.toBeNull()
  })
})

describe('templatesDue', () => {
  it('never schedules a manual template', () => {
    const due = templatesDue(new Map(), NOW)
    expect(due.every((t) => t.frequency !== 'manual')).toBe(true)
    expect(findTemplate('season-recap')?.frequency).toBe('manual')
  })

  it('is due when never run, and not again until the period elapses', () => {
    const weekly = REPORT_TEMPLATES.find((t) => t.frequency === 'weekly')!

    expect(templatesDue(new Map(), NOW).map((t) => t.id)).toContain(weekly.id)
    expect(templatesDue(new Map([[weekly.id, daysAgo(3)]]), NOW).map((t) => t.id)).not.toContain(weekly.id)
    expect(templatesDue(new Map([[weekly.id, daysAgo(8)]]), NOW).map((t) => t.id)).toContain(weekly.id)
  })

  it('holds a monthly template for a month, not a week', () => {
    const monthly = REPORT_TEMPLATES.find((t) => t.frequency === 'monthly')!
    expect(templatesDue(new Map([[monthly.id, daysAgo(10)]]), NOW).map((t) => t.id)).not.toContain(monthly.id)
    expect(templatesDue(new Map([[monthly.id, daysAgo(31)]]), NOW).map((t) => t.id)).toContain(monthly.id)
  })
})

describe('the empty-report gate', () => {
  /*
   * The league that produced the smallest artifact on production: activity exists (so this is not
   * the "never imported" case), but there are no transaction weeks and only one activity type, so
   * the transaction summary carries a header, provenance, and one line.
   */
  const QUIET = { ...SNAPSHOT, transactionsByWeek: [], activityMix: [] }

  it('counts only rows that say something about the league', () => {
    const t = findTemplate('transaction-summary')!
    const empty = t.build(QUIET as never, WINDOW as never)
    expect(countSubstantiveRows(empty)).toBe(0)
    // The file is not blank — it still carries its header and provenance, which is why byte size
    // cannot be the measure.
    expect(empty.length).toBeGreaterThan(100)

    const full = t.build(SNAPSHOT as never, WINDOW as never)
    expect(countSubstantiveRows(full)).toBeGreaterThan(0)
  })

  it('🛑 A SCHEDULED RUN STORES NOTHING when the report would have no findings', async () => {
    mocks.readWarehouseAnalytics.mockResolvedValue(QUIET)

    const result = await generateReport('lg-1', 'transaction-summary', 'Scheduled', NOW, true)

    expect(result.status).toBe('empty')
    expect(result.id).toBe('')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('⚠ BUT AN ON-DEMAND RUN STILL PRODUCES IT — the person asked a direct question', async () => {
    mocks.readWarehouseAnalytics.mockResolvedValue(QUIET)

    // skipWhenEmpty defaults to false, which is the on-demand path.
    const result = await generateReport('lg-1', 'transaction-summary', 'You', NOW)

    expect(result.status).toBe('ready')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0].data.status).toBe('ready')
  })

  it('never suppresses a report that HAS findings, even on the scheduled path', async () => {
    mocks.readWarehouseAnalytics.mockResolvedValue(SNAPSHOT)

    const result = await generateReport('lg-1', 'transaction-summary', 'Scheduled', NOW, true)

    expect(result.status).toBe('ready')
    expect(result.substantiveRows).toBeGreaterThan(0)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
