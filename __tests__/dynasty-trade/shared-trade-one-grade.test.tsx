/**
 * 🛑 A shared trade (/trade/[id]) shows THE grade or no verdict at all (2026-09-29).
 *
 * The page printed a share's stored `winner`, `valueDelta` ("Side A total=…, delta=…"), `confidence`,
 * `dynastyVerdict` and `vetoRisk` — the dual-brain engine's private scale. New shares store the one
 * grade; an old share without it shows no winner, delta or confidence.
 *
 * Prisma is mocked (never a real DB).
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { tradeShare: { findUnique: h.findUnique, create: h.create } } }))
vi.mock('@/lib/preferences/ServerRenderPreferenceResolver', () => ({
  resolveServerRenderPreferences: vi.fn(async () => ({ timezone: 'UTC', language: 'en' })),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'viewer-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import TradeSharePage from '@/app/trade/[id]/page'
import { POST as sharePost } from '@/app/api/trade/share/route'
import { readSharedTrade, shareableLeagueGrade } from '@/components/dynasty-trade/sharedTrade'

const assets = {
  sideA: [{ id: 'a1', name: 'Bijan Robinson (RB)', type: 'player' }],
  sideB: [{ id: 'b1', name: 'Josh Allen (QB)', type: 'player' }],
}

/** A share as the analyzer stored it before 2026-09-29: the dual-brain engine's own verdict. */
const OLD_ANALYSIS = {
  winner: 'Side A',
  valueDelta: 'Side A total=8123, Side B total=6010, delta=2113 (26%)',
  factors: ['Side A has a 26% value edge: 8,123 (A) vs 6,010 (B)'],
  confidence: 73,
  dynastyVerdict: 'Side A wins this trade',
  vetoRisk: 'High',
  agingConcerns: ['Josh Allen is at age cliff (age 31) — value likely to decline sharply'],
  recommendations: ['Ask for a 2027 2nd back'],
  teamAName: 'Hoovi',
  teamBName: 'Nicolodeon',
  leagueContext: '12-team SF dynasty',
}

const GRADE = { grade: 'D', partnerGrade: 'B', gradeLabel: 'Slightly favors opponent', gradeWithheld: null, giveValue: 6400, getValue: 5900 }

const PRIVATE = [/Side A total=/, /delta=2113/, /73%/, /Confidence/, /Dynasty Verdict/, /Side A wins this trade/, /Veto Risk/, /26% value edge/]

async function renderShare(analysis: unknown) {
  h.findUnique.mockResolvedValue({ id: 's1', ...assets, analysis, createdAt: new Date('2026-09-01T12:00:00Z'), expiresAt: null })
  render(await TradeSharePage({ params: { id: 's1' } }))
  return document.body.textContent ?? ''
}

describe('/trade/[id] — the stored one grade, or no verdict', () => {
  beforeEach(() => {
    h.findUnique.mockReset()
    document.body.innerHTML = ''
  })

  it('🛑 an OLD share prints none of the dual-brain verdict: no winner, delta, confidence, verdict or veto risk', async () => {
    const text = await renderShare(OLD_ANALYSIS)
    for (const p of PRIVATE) expect(text).not.toMatch(p)
    expect(text).not.toMatch(/Winner:/)
    expect(screen.getByTestId('shared-trade-no-grade').textContent).toMatch(/carries no grade/)
    // The deal itself and the facts beside it stay.
    expect(text).toContain('Bijan Robinson (RB)')
    expect(text).toContain('Josh Allen is at age cliff')
    expect(text).toContain('Ask for a 2027 2nd back')
  })

  it('a NEW share prints the stored letters and the winner read off Team A’s letter — even beside a stale `winner`', async () => {
    const text = await renderShare({ ...OLD_ANALYSIS, winner: 'Side A', leagueGrade: GRADE, factors: ['Bijan is the younger asset'] })
    expect(screen.getByTestId('dynasty-grade').textContent).toContain('Slightly favors opponent')
    expect(screen.getByTestId('shared-trade-winner').textContent).toBe('Winner:Slight edge to Nicolodeon')
    expect(text).toContain('Bijan is the younger asset')
    for (const p of PRIVATE) expect(text).not.toMatch(p)
  })

  it('a stored WITHHELD grade says why and names no winner', async () => {
    await renderShare({ ...OLD_ANALYSIS, leagueGrade: { ...GRADE, grade: null, partnerGrade: null, gradeLabel: null, giveValue: null, getValue: null, gradeWithheld: 'No league is selected.' } })
    expect(screen.getByTestId('dynasty-grade-withheld').textContent).toBe('Not graded: No league is selected.')
    expect(screen.queryByTestId('shared-trade-winner')).toBeNull()
  })
})

describe('readSharedTrade / shareableLeagueGrade', () => {
  it('reads nothing of the stored verdict fields', () => {
    const view = readSharedTrade(OLD_ANALYSIS)
    expect(view.winner).toBeNull()
    expect(view.leagueGrade).toBeNull()
    expect(view.factors).toEqual([])
    expect(JSON.stringify(view)).not.toMatch(/Side A total=|Side A wins|"confidence"|"vetoRisk"|"High"/)
  })

  it('stores exactly the six grade fields DynastyLeagueGrade draws', () => {
    expect(shareableLeagueGrade({ ...GRADE, percentDiff: 8, evaluationReceiptId: 'r1' } as never)).toEqual(GRADE)
    expect(shareableLeagueGrade(null)).toBeNull()
  })

  it('garbage in a share is not a grade', () => {
    expect(readSharedTrade(null).leagueGrade).toBeNull()
    expect(readSharedTrade({ leagueGrade: 'A' }).leagueGrade).toBeNull()
    expect(readSharedTrade({ leagueGrade: { grade: 7 } }).winner).toBeNull()
  })
})

describe('POST /api/trade/share', () => {
  beforeEach(() => {
    h.create.mockReset().mockResolvedValue({ id: 'new-share' })
  })

  const post = (analysis: Record<string, unknown>) =>
    sharePost(new Request('http://localhost/api/trade/share', { method: 'POST', body: JSON.stringify({ ...assets, analysis }) }))

  it('🛑 stores the grade, and none of the dual-brain fields a stale client still sends', async () => {
    const res = await post({ ...OLD_ANALYSIS, leagueGrade: GRADE })
    expect(res.status).toBe(200)
    const stored = h.create.mock.calls[0]![0].data.analysis
    expect(stored.leagueGrade).toEqual(GRADE)
    for (const key of ['winner', 'valueDelta', 'confidence', 'dynastyVerdict', 'vetoRisk']) expect(stored).not.toHaveProperty(key)
  })

  it('accepts a share with no winner, delta or confidence at all (what the form sends now)', async () => {
    const res = await post({ leagueGrade: null, factors: [], teamAName: 'A', teamBName: 'B' })
    expect(res.status).toBe(200)
  })
})

describe('the form shares the grade', () => {
  it('builds the share from the grade and the explanatory lists, never by spreading the analysis', () => {
    const form = fs.readFileSync(path.join(process.cwd(), 'components/DynastyTradeForm.tsx'), 'utf8')
    expect(form).toMatch(/leagueGrade: shareableLeagueGrade\(tradeGrade\),/)
    expect(form).not.toMatch(/analysis: \{ \.\.\.result/)
  })

  it('positive control: the forbidden shape matches the line the form sent', () => {
    expect(/analysis: \{ \.\.\.result/.test('analysis: { ...result, teamAName, teamBName, leagueContext },')).toBe(true)
  })
})
