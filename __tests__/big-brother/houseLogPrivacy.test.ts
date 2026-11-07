/**
 * Big Brother History: the house log a member sees is readable and does not leak the vote tally (2026-11-07, Big
 * Brother audit item 1). The audit route returned every audit row's raw `metadata` to any member and the History
 * tab printed it as JSON — so `eviction.voteCount`, which leagues hide by default (`publicVoteTotalsVisibility:
 * 'evicted_only'`), plus `commissionerTieBreak`, a `roster_archived` row's user id and roster snapshot, and admin
 * `rerun_vote_tally` totals were all one tab away from every houseguest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { houseLogLine, publicHouseLog, publicHouseLogEntry } from '@/lib/big-brother/publicHouseLog'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  isBB: vi.fn(),
  config: vi.fn(),
  log: vi.fn(),
  commissioner: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: mocks.access }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ isBigBrotherLeague: mocks.isBB, getBigBrotherConfig: mocks.config }))
vi.mock('@/lib/big-brother/BigBrotherAuditLog', () => ({ getBigBrotherAuditLog: mocks.log }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: mocks.commissioner }))
vi.mock('@/lib/prisma', () => ({ prisma: null }))

import { GET } from '@/app/api/leagues/[leagueId]/big-brother/audit/route'

const T = new Date('2026-10-20T03:00:00Z')
const ROWS = [
  {
    eventType: 'eviction',
    metadata: { cycleId: 'c4', week: 4, evictedRosterId: 'r-floater', voteCount: { 'r-floater': 7, 'r-pawn': 2 }, tied: false, commissionerTieBreak: false, juryEnrolled: true, releasedPlayerCount: 15 },
    createdAt: T,
  },
  { eventType: 'roster_archived', metadata: { rosterId: 'r-floater', userId: 'user-secret-id', week: 4, playerDataSnapshot: { players: ['p1'] } }, createdAt: T },
  { eventType: 'phase_transition', metadata: { adminAction: 'rerun_vote_tally', cycleId: 'c4', votesByTarget: { 'r-floater': 7, 'r-pawn': 2 } }, createdAt: T },
  { eventType: 'jury_enrolled', metadata: { rosterId: 'r-floater', evictedWeek: 4 }, createdAt: T },
  { eventType: 'phase_transition', metadata: { cycleId: 'c4', week: 4, fromPhase: 'REPLACEMENT_NOMINATION_OPEN', toPhase: 'VOTING_OPEN', automation: true }, createdAt: T },
  { eventType: 'phase_transition', metadata: { cycleId: 'c4', week: 4, fromPhase: 'VOTING_OPEN', toPhase: 'VOTING_LOCKED' }, createdAt: T },
  { eventType: 'hoh_assigned', metadata: { cycleId: 'c4', week: 4, winnerId: 'r-hoh', challengeMode: 'manual', eligibleCount: 9 }, createdAt: T },
]

const request = () =>
  GET(new NextRequest('https://allfantasy.ai/api/leagues/l/big-brother/audit?limit=80'), { params: Promise.resolve({ leagueId: 'l' }) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'member' } })
  mocks.access.mockResolvedValue(true)
  mocks.isBB.mockResolvedValue(true)
  mocks.config.mockResolvedValue({ configId: 'cfg', publicVoteTotalsVisibility: 'evicted_only' })
  mocks.log.mockResolvedValue(ROWS)
  mocks.commissioner.mockResolvedValue(false)
})

describe('audit route, as a houseguest', () => {
  it('returns readable public entries and never the raw log', async () => {
    const res = await request()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.log, 'raw audit rows reached a non-commissioner').toBeUndefined()
    expect(Array.isArray(body.entries)).toBe(true)
    expect(body.entries.map((e: { kind: string }) => e.kind)).toEqual(['eviction', 'jury', 'phase', 'phase', 'hoh'])
  })

  it('carries no vote totals, tie-break flag, user id or roster snapshot when the league hides totals', async () => {
    const text = JSON.stringify(await (await request()).json())
    for (const leak of ['voteCount', 'votesByTarget', 'commissionerTieBreak', 'user-secret-id', 'playerDataSnapshot', 'rerun_vote_tally', '"votesByNominee":{']) {
      expect(text, `leaked ${leak}`).not.toContain(leak)
    }
  })

  it('shows the counts only when the league chose exact totals', async () => {
    mocks.config.mockResolvedValue({ configId: 'cfg', publicVoteTotalsVisibility: 'exact' })
    const body = await (await request()).json()
    expect(body.entries[0].votesByNominee).toEqual({ 'r-floater': 7, 'r-pawn': 2 })
  })
})

describe('audit route, as the commissioner', () => {
  it('still gets the raw log for the admin panel', async () => {
    mocks.commissioner.mockResolvedValue(true)
    const body = await (await request()).json()
    expect(body.log).toHaveLength(ROWS.length)
    expect(body.entries).toHaveLength(5)
  })
})

describe('house log lines', () => {
  const names: Record<string, string> = { 'r-floater': 'Floater Nation', 'r-pawn': 'Pawn Stars', 'r-hoh': 'Comp Beast' }
  const line = (row: (typeof ROWS)[number], vis = 'evicted_only') => {
    const e = publicHouseLogEntry(row, vis)
    return e ? houseLogLine(e, (id) => names[id]) : null
  }

  it('reads as sentences, not event names', () => {
    expect(line(ROWS[0])).toBe('Floater Nation was evicted')
    expect(line(ROWS[0], 'exact')).toBe('Floater Nation was evicted, 7–2')
    expect(line(ROWS[3])).toBe('Floater Nation joined the jury')
    expect(line(ROWS[4])).toBe('Eviction voting opened')
    expect(line(ROWS[6])).toBe('Comp Beast won Head of Household')
  })

  it('drops engine-only rows outright', () => {
    expect(publicHouseLog([ROWS[1], ROWS[2]], 'exact')).toEqual([])
    expect(publicHouseLogEntry({ eventType: 'something_new', metadata: { voteCount: 3 }, createdAt: T }, 'exact')).toBeNull()
  })
})

describe('the History panel stays client-safe', () => {
  it('imports the sentence helper, never the Prisma-backed builder', async () => {
    const { readFileSync } = await import('node:fs')
    const panel = readFileSync('components/big-brother/BigBrotherHistoryPanel.tsx', 'utf8')
    const line = readFileSync('lib/big-brother/houseLogLine.ts', 'utf8')
    expect(panel).toMatch(/from '@\/lib\/big-brother\/houseLogLine'/)
    for (const src of [panel, line]) {
      expect(src).not.toMatch(/from '[^']*(publicHouseLog|bigBrotherHome|\/prisma)'/)
    }
    expect(line).not.toMatch(/^import /m)
  })
})
