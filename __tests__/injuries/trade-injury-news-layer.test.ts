import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/upstream-apis', () => ({ fetchNewsContext: async () => ({ items: newsItems }) }))

import { mergeInjuryNewsLayer } from '@/lib/news-injury-aggregation/mergeLayer'
import { resolvePlayerInjuryNewsBatch } from '@/lib/news-injury-aggregation/resolveBatch'
import type { InjuryNewsSourceRow } from '@/lib/news-injury-aggregation/types'

/*
 * The injury layer behind the trade analyzer (`runTradeConsoleAnalysis` → profile enrichment), which
 * sets each player's status and the multiplier on his projection.
 *
 * 🛑 IT USED TO KEEP THE WORST STATUS IN THREE WEEKS OF ROWS (2026-10-11). Last week's "Out" beat
 * this morning's "Active", a news headline read by regex counted as a designation ("returns from IR"
 * → IR), and a cleared starter's projection was cut to 5%. These pin: the newest feed claim wins,
 * Active included; headlines never designate; dead rows are not read; namesakes on another club
 * stay out of the summary.
 */

let newsItems: Array<Record<string, unknown>> = []

const HOUR = 3_600_000
const ago = (h: number) => new Date(Date.now() - h * HOUR)

function row(over: Partial<InjuryNewsSourceRow>): InjuryNewsSourceRow {
  return {
    kind: 'sports_injury',
    label: 'espn',
    statusRaw: 'Out',
    atIso: ago(1).toISOString(),
    confidence: 0.85,
    ...over,
  }
}

const merge = (sources: InjuryNewsSourceRow[], extraNewsHeadlines: string[] = []) =>
  mergeInjuryNewsLayer({ sport: 'NFL', playerName: 'Puka Nacua', playerId: null, teamAbbrev: 'LAR', sources, extraNewsHeadlines })

describe('mergeInjuryNewsLayer — the current designation', () => {
  it("🛑 this morning's Active beats last week's Out", () => {
    const layer = merge([
      row({ statusRaw: 'Out', atIso: ago(24 * 6).toISOString(), label: 'rolling_insights' }),
      row({ statusRaw: 'Active', atIso: ago(3).toISOString() }),
    ])
    expect(layer.canonicalStatus).toBe('active')
    expect(layer.projectionMultiplier).toBe(1)
    expect(layer.primarySource).toBe('espn')
  })

  it('a newer Out beats an older Active', () => {
    const layer = merge([
      row({ statusRaw: 'Active', atIso: ago(30).toISOString() }),
      row({ statusRaw: 'Out', atIso: ago(2).toISOString(), label: 'rolling_insights' }),
    ])
    expect(layer.canonicalStatus).toBe('out')
    expect(layer.projectionMultiplier).toBe(0.05)
  })

  it('claims made at the same moment resolve to the worse one', () => {
    const at = ago(2).toISOString()
    const layer = merge([row({ statusRaw: 'Questionable', atIso: at }), row({ statusRaw: 'Doubtful', atIso: at })])
    expect(layer.canonicalStatus).toBe('doubtful')
  })

  it("🛑 a news blurb is not a designation — \"returns from IR\" does not put him on IR", () => {
    const layer = merge([
      row({ statusRaw: 'Active', atIso: ago(5).toISOString() }),
      row({ kind: 'news_context', label: 'news', statusRaw: 'Nacua returns from IR, will start', atIso: ago(1).toISOString(), confidence: 0.55 }),
    ])
    expect(layer.canonicalStatus).toBe('active')
  })

  it('takes the game designation from the winning claim, not the first row listed', () => {
    const layer = merge([
      row({ kind: 'injury_report_record', statusRaw: 'Out', gameStatus: 'Out', atIso: ago(30).toISOString() }),
      row({ statusRaw: 'Questionable', atIso: ago(2).toISOString() }),
    ])
    expect(layer.gameDesignation).toBe('Questionable')
  })

  it('with no feed claim at all the status is unknown and the projection untouched', () => {
    const layer = merge([], ['Nacua out of walking boot'])
    expect(layer.canonicalStatus).toBe('unknown')
    expect(layer.projectionMultiplier).toBe(1)
    expect(layer.playerNewsSummary).toBe('Nacua out of walking boot')
  })
})

describe('resolvePlayerInjuryNewsBatch — what the layer is built from', () => {
  type Calls = Record<string, Array<Record<string, any>>>
  function fakePrisma(data: {
    sportsInjuries?: Array<Record<string, unknown>>
    reports?: Array<Record<string, unknown>>
    news?: Array<Record<string, unknown>>
  }) {
    const calls: Calls = { sportsInjury: [], injuryReportRecord: [], playerStatusEvent: [] }
    const prisma = {
      injuryReportRecord: { findMany: async (a: any) => (calls.injuryReportRecord.push(a), data.reports ?? []) },
      sportsInjury: { findMany: async (a: any) => (calls.sportsInjury.push(a), data.sportsInjuries ?? []) },
      playerNewsRecord: { findMany: async () => data.news ?? [] },
      playerStatusEvent: { findMany: async (a: any) => (calls.playerStatusEvent.push(a), []) },
    } as never
    return { prisma, calls }
  }
  const si = (over: Record<string, unknown>) => ({
    playerName: 'Puka Nacua', playerId: '1', team: 'LAR', position: 'WR', status: 'Out', description: null,
    source: 'rolling_insights', date: ago(24 * 5), fetchedAt: ago(0.1), ...over,
  })
  const run = (prisma: never, teamAbbrev = 'LAR', skipNewsContext = true) =>
    resolvePlayerInjuryNewsBatch({ prisma, sport: 'NFL', skipNewsContext, players: [{ playerName: 'Puka Nacua', teamAbbrev }] })

  it('reads only live feed rows, and bounds the two log tables to the stale window', async () => {
    const { prisma, calls } = fakePrisma({})
    await resolvePlayerInjuryNewsBatch({ prisma, sport: 'NFL', skipNewsContext: true, players: [{ playerName: 'Puka Nacua', playerId: '9' }] })
    expect(calls.sportsInjury[0].where.expiresAt?.gt).toBeInstanceOf(Date)
    const reportSince = calls.injuryReportRecord[0].where.reportDate.gte.getTime()
    const eventSince = calls.playerStatusEvent[0].where.detectedAt.gte.getTime()
    for (const since of [reportSince, eventSince]) {
      expect(Date.now() - since).toBeLessThanOrEqual(36 * HOUR + 60_000)
    }
  })

  it("🛑 ranks feed rows by when they were SAID: Rolling Insights re-pulling Friday's Out does not beat ESPN's Active", async () => {
    const { prisma } = fakePrisma({
      sportsInjuries: [
        si({ status: 'Out', source: 'rolling_insights', date: ago(48), fetchedAt: ago(0.05) }),
        si({ status: 'Active', source: 'espn', date: ago(3), fetchedAt: ago(0.4) }),
      ],
    })
    const layer = (await run(prisma)).get('puka nacua')
    expect(layer?.canonicalStatus).toBe('active')
  })

  it("🛑 a namesake on another club is neither his status nor his summary", async () => {
    newsItems = [
      { id: 'n1', title: 'Puka Nacua (NYG) — Out: Knee', source: 'injury_report', url: null, team: 'NYG', publishedAt: ago(1).toISOString(), isInjury: true, injuryStatus: 'Out', playerName: 'Puka Nacua', relevance: 'direct' },
    ]
    const { prisma } = fakePrisma({
      sportsInjuries: [si({ team: 'New York Giants', status: 'Out' })],
      news: [{ playerName: 'Puka Nacua', playerId: null, team: 'NYG', headline: 'Giants place Nacua on IR', body: '', fantasyRelevant: true, source: 'x', publishedAt: ago(2) }],
    })
    const layer = (await run(prisma, 'LAR', false)).get('puka nacua')
    newsItems = []
    expect(layer ?? null).toBeNull()
  })

  it('his own headline still reaches the summary, without becoming a designation', async () => {
    const { prisma } = fakePrisma({
      sportsInjuries: [si({ status: 'Active', source: 'espn', date: ago(3), fetchedAt: ago(0.2) })],
      news: [{ playerName: 'Puka Nacua', playerId: null, team: 'LAR', headline: 'Nacua returns from IR, will start', body: '', fantasyRelevant: true, source: 'x', publishedAt: ago(2) }],
    })
    const layer = (await run(prisma)).get('puka nacua')
    expect(layer?.playerNewsSummary).toContain('returns from IR')
    expect(layer?.canonicalStatus).toBe('active')
  })
})
