// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
const readSnapshot = vi.fn()
vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: (...a: unknown[]) => readSnapshot(...a) }))
const recordFor = vi.fn()
vi.mock('@/lib/chimmy-outcomes/ledgerRecord', async (orig) => ({ ...(await orig<typeof import('@/lib/chimmy-outcomes/ledgerRecord')>()), ledgerRecordFor: (...a: unknown[]) => recordFor(...a) }))

import TrackRecordPage from '@/app/track-record/page'
import { publicTrackRecord } from '@/lib/chimmy-outcomes/publicTrackRecord'
import type { LedgerRecordView } from '@/lib/chimmy-outcomes/ledgerRecord'

afterEach(() => { cleanup(); vi.clearAllMocks() })

/** The public track record (owner's call, 2026-11-22): every graded call, misses included, no number under the sample rule. */

const view = (over: Partial<LedgerRecordView> = {}): LedgerRecordView => ({
  season: 2026,
  bench: { you: null, everyone: { right: 620, wrong: 380, same: 14, ratePct: 62, gainPerCall: 2.1 } },
  pickups: { you: null, everyone: { graded: 200, startable: 90, ratePct: 45, vsDrop: 0, beatDrop: 0 } },
  trades: [
    { letter: 'A', n: 40, netPerWeek: 2.4, aheadPct: 61 },
    { letter: 'B', n: 25, netPerWeek: -1.3, aheadPct: 36 },
    { letter: 'C', n: 30, netPerWeek: 0.2, aheadPct: 50 },
    { letter: 'D', n: 19, netPerWeek: -3, aheadPct: 20 },
  ],
  ...over,
} as LedgerRecordView)

describe('publicTrackRecord', () => {
  it('states each record with what it rests on', () => {
    const r = publicTrackRecord(view())
    expect(r.season).toBe(2026)
    expect(r.lines.find((l) => l.key === 'bench')).toMatchObject({ headline: 'Right 62% of the time', tone: 'held' })
    expect(r.lines.find((l) => l.key === 'bench')!.detail).toMatch(/^620 right, 380 wrong, 14 tied\./)
    expect(r.lines.find((l) => l.key === 'pickups')).toMatchObject({ headline: '45% became startable', tone: 'even' })
    expect(r.lines.find((l) => l.key === 'pickups')!.detail).toMatch(/^90 of 200 averaged 10 or more points/)
  })

  it('🛑 a letter that has NOT held up is listed, and says so — the misses are not left out', () => {
    const b = publicTrackRecord(view()).lines.find((l) => l.key === 'trade-B')!
    expect(b.tone).toBe('not_held')
    expect(b.headline).toBe('1.3 points a week less than they gave up')
    expect(b.detail).toBe('Across 25 graded trades, the graded side came out ahead in 36%. This letter has not held up so far.')
    const a = publicTrackRecord(view()).lines.find((l) => l.key === 'trade-A')!
    expect(a).toMatchObject({ tone: 'held', headline: '2.4 points a week more than they gave up' })
    expect(publicTrackRecord(view()).lines.find((l) => l.key === 'trade-C')!.tone).toBe('even')
  })

  it('no number under the sample rule: a thin letter is not listed, a thin rate is a count', () => {
    const r = publicTrackRecord(view({ bench: { you: null, everyone: { right: 5, wrong: 3, same: 0, ratePct: null, gainPerCall: null } } }))
    expect(r.lines.some((l) => l.key === 'trade-D')).toBe(false)
    expect(r.lines.find((l) => l.key === 'bench')).toMatchObject({ headline: '8 graded so far', tone: 'pending' })
  })

  it('a bench record under 50% is marked as not holding up; nothing graded is an empty list', () => {
    const r = publicTrackRecord(view({ bench: { you: null, everyone: { right: 40, wrong: 60, same: 0, ratePct: 40, gainPerCall: -1 } } }))
    expect(r.lines.find((l) => l.key === 'bench')!.tone).toBe('not_held')
    expect(publicTrackRecord(null).lines).toEqual([])
    expect(publicTrackRecord(null).measured).toMatch(/each league’s own scoring/)
  })
})

describe('/track-record', () => {
  it('shows every line, the misses in the same list, and what was measured; no per-user data is asked for', async () => {
    readSnapshot.mockResolvedValue({ ledger: { users: { u1: { b: [9, 9, 9] } }, bench: {} } })
    recordFor.mockReturnValue(view())
    render(await TrackRecordPage())
    expect(recordFor.mock.calls[0]![0].users).toEqual({})
    expect(recordFor.mock.calls[0]![1]).toBeNull()
    expect(screen.getByTestId('track-record-trade-B').getAttribute('data-tone')).toBe('not_held')
    expect(screen.getByTestId('track-record-trade-B').textContent).toContain('Has not held up')
    expect(screen.getByTestId('track-record-bench').textContent).toContain('Right 62% of the time')
    expect(screen.getByTestId('track-record-measured').textContent).toMatch(/standard PPR/)
  })

  it('nothing graded, or the store down: says so, never a number', async () => {
    readSnapshot.mockRejectedValue(new Error('down'))
    render(await TrackRecordPage())
    expect(screen.getByTestId('track-record-empty')).toBeTruthy()
    expect(recordFor).not.toHaveBeenCalled()
  })
})
