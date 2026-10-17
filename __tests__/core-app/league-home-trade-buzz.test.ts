// @vitest-environment node
/**
 * The league home's League buzz: a trade shows each team's grade (2026-09-27).
 *
 * 🛑 TWO BUGS, ONE SYMPTOM. The buzz row for a trade carried no grade at all — and the page's own live
 * Sleeper scan REPLACED the loader's graded copy of a trade with an ungraded one ("League-specific
 * grade is still being prepared"), so even a graded trade lost its letter here. The graded copy now
 * wins; a live-only trade is built by the loader's own `liveCompletedTrade` and graded the same way.
 *
 * Harness from `league-home-commissioner-activity.test.ts`: a permissive Prisma double, the trade
 * loader's reads mocked, `liveCompletedTrade` REAL so the shape the page builds is the loader's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecentTrade } from '@/lib/core-app/recentTrades'

const db = vi.hoisted(() => ({ answers: {} as Record<string, (args: unknown) => unknown> }))
const reads = vi.hoisted(() => ({
  recentTrades: vi.fn(),
  gradeProvider: vi.fn(),
  scan: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

vi.mock('@/lib/core-app/recentTrades', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRecentTrades: reads.recentTrades,
  gradeProviderRecentTrade: reads.gradeProvider,
}))
vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({ scanPendingSleeperTrades: reads.scan }))

import { getLeagueHomeData } from '@/lib/core-app/leagueHome'

const L = 'league-1'
const U = 'user-1'
const HOUR = 3_600_000

const asset = (id: string, name: string, headshotUrl: string | null = null) => ({
  kind: 'player' as const, playerId: id, name, position: 'WR', team: 'LAR', headshotUrl, teamLogoUrl: null,
})

/** A trade the loader already graded — THE grade on both sides, Ada favoured. */
const GRADED: RecentTrade = {
  id: 'pl-1:tx-1', leagueId: L, leagueName: 'Kings', leagueAvatarUrl: null, platformLeagueId: 'pl-1',
  acceptedAt: new Date(Date.now() - HOUR).toISOString(), partial: false,
  sides: [
    { rosterId: 1, managerName: 'Ada-owner', teamName: 'Ada', avatarUrl: null, received: [asset('p1', 'Puka Nacua', 'https://img.example/p1.png')], grade: 'B', gradeBasis: 'League', gradeReason: 'Got 5,000 for 4,000 on this league’s values today.' },
    { rosterId: 2, managerName: 'Bea-owner', teamName: 'Bea', avatarUrl: null, received: [asset('p2', 'Bijan Robinson')], grade: 'D', gradeBasis: 'League', gradeReason: 'Got 4,000 for 5,000 on this league’s values today.' },
  ],
  verdict: { verdict: 'Slightly favors A', fairness: null, confidence: 0, favoursRosterId: 1 },
}

const liveTrade = (transactionId: string, hoursAgo: number) => ({
  transactionId, proposedBy: 'Cy', proposedByViewer: false, proposedAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
  assetsGiven: [{ playerId: 'p3', playerName: 'Sent Guy', position: 'RB', team: 'NYJ' }],
  assetsReceived: [{ playerId: 'p4', playerName: 'Got Guy', position: 'WR', team: 'BUF' }],
  readOnly: true, provider: 'sleeper', lifecycleStatus: 'complete',
  viewerRosterExternalId: '1', counterpartyRosterExternalId: '3',
})

type BuzzRow = { id: string; grades?: Array<{ team: string; letter: string }>; gradeLine?: string | null; players?: Array<{ imageUrl: string | null; name: string | null }> }

async function buzz(): Promise<BuzzRow[]> {
  const ctx = {
    leagueId: L,
    userId: U,
    league: vi.fn(async () => ({
      id: L, name: 'Kings', platform: 'sleeper', platformLeagueId: 'pl-1', sport: 'NFL', season: 2026,
      status: 'in_season', settings: {}, leagueSize: 4, lastSyncedAt: new Date(),
    })),
    claimedTeam: vi.fn(async () => ({ externalId: '1', teamName: 'Ada' })),
    claimedTeams: vi.fn(async () => [{ externalId: '1' }]),
  }
  const home = await getLeagueHomeData(L, U, null, ctx as never)
  const b = (home as unknown as { buzz: { available: boolean; data?: BuzzRow[] } }).buzz
  return b.available ? b.data ?? [] : []
}

beforeEach(() => {
  db.answers = {}
  vi.clearAllMocks()
  db.answers['userProfile.findUnique'] = () => ({ sleeperUserId: 's-1' })
  reads.recentTrades.mockResolvedValue([structuredClone(GRADED)])
  reads.scan.mockResolvedValue({ trades: [], completedTrades: [], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0 })
  reads.gradeProvider.mockImplementation(async (t: RecentTrade) => {
    t.sides[0]!.grade = 'A'; t.sides[0]!.gradeBasis = 'League'
    t.sides[1]!.grade = 'F'; t.sides[1]!.gradeBasis = 'League'
    t.verdict = { verdict: 'Strongly favors A', fairness: null, confidence: 0, favoursRosterId: t.sides[0]!.rosterId }
  })
})

describe('League buzz — a trade carries its grade', () => {
  it('shows each team’s letter, who it favours, and the faces of who moved', async () => {
    const row = (await buzz()).find((r) => r.id === 'pl-1:tx-1')!
    expect(row.grades).toEqual([{ team: 'Ada', letter: 'B' }, { team: 'Bea', letter: 'D' }])
    expect(row.gradeLine).toBe('Slightly favours Ada on this league’s values today')
    expect(row.players?.map((p) => [p.name, p.imageUrl])).toEqual([
      ['Puka Nacua', 'https://img.example/p1.png'],
      ['Bijan Robinson', null],
    ])
  })

  it('🛑 keeps the GRADED copy when the live scan sees the same trade — never the ungraded one', async () => {
    reads.scan.mockResolvedValue({ trades: [], completedTrades: [liveTrade('tx-1', 1)], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0 })
    const rows = await buzz()
    const trades = rows.filter((r) => r.id.endsWith('tx-1'))
    expect(trades).toHaveLength(1)
    expect(trades[0]!.grades).toEqual([{ team: 'Ada', letter: 'B' }, { team: 'Bea', letter: 'D' }])
    expect(reads.gradeProvider).not.toHaveBeenCalled()
  })

  it('grades a trade only the live scan has, the same way the dashboard does', async () => {
    reads.scan.mockResolvedValue({ trades: [], completedTrades: [liveTrade('tx-2', 2)], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0 })
    const row = (await buzz()).find((r) => r.id === 'tx-2')!
    expect(reads.gradeProvider).toHaveBeenCalledTimes(1)
    expect(reads.gradeProvider.mock.calls[0]![0].id).toBe('tx-2')
    expect(row.grades).toEqual([{ team: 'You', letter: 'A' }, { team: 'Cy', letter: 'F' }])
    expect(row.gradeLine).toBe('Clearly favours You on this league’s values today')
  })

  it('a withheld grade says why and draws no letter', async () => {
    reads.scan.mockResolvedValue({ trades: [], completedTrades: [liveTrade('tx-3', 2)], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0 })
    reads.gradeProvider.mockImplementation(async (t: RecentTrade) => {
      for (const s of t.sides) s.gradeReason = 'League grade withheld: 1 asset has no value on this league’s chart'
    })
    const row = (await buzz()).find((r) => r.id === 'tx-3')!
    expect(row.grades).toBeUndefined()
    expect(row.gradeLine).toBe('League grade withheld: 1 asset has no value on this league’s chart')
  })

  it('never mixes the one grade with a Realized or Market letter on a row', async () => {
    const mixed = structuredClone(GRADED)
    mixed.sides[1]!.gradeBasis = 'Realized'
    reads.recentTrades.mockResolvedValue([mixed])
    const row = (await buzz()).find((r) => r.id === 'pl-1:tx-1')!
    expect(row.grades).toBeUndefined()
  })
})
