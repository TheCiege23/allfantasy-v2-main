/**
 * Chop Watch (lib/guillotine/chopWatch.ts): the member chop line is this week's live one, by the chop's
 * own rules — not last week's season totals with one team always in the zone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/guillotine/chopPreviewLoad', () => ({ loadChopPreview: vi.fn() }))

import { chopWatchFromPreview } from '@/lib/guillotine/chopWatch'
import { CHOP_WATCH_TTL_MS, clearChopWatchCache, loadChopWatch } from '@/lib/guillotine/chopWatchLoad'
import { buildChopLine } from '@/components/guillotine/guillotineHomeModel'
import type { ChopPreview, ChopPreviewRow } from '@/lib/guillotine/chopPreview'

const row = (rosterId: string, points: number, status: ChopPreviewRow['status'], margin: number | null): ChopPreviewRow =>
  ({ rosterId, name: `Team ${rosterId}`, points, status, margin, faabChange: status === 'chopped' ? -40 : 20 })

function preview(overrides: Partial<ChopPreview> = {}): ChopPreview {
  return {
    week: 6, weekState: 'live', outcome: 'chop', headline: 'Week 6: 2 teams chopped.', chopCount: 2, chopLine: 71.4, tiebreak: null,
    faab: { mode: 'split', pool: 80, note: 'secret split' }, release: { players: 26, when: 'At the next waiver run' },
    announcement: 'Week 6 — Chopped: A, B.', notes: [], blockers: ['A team cannot be matched'],
    rows: [
      row('top', 131.2, 'immune', 59.8),
      row('mid', 104, 'safe', 32.6),
      row('close', 76.9, 'danger', 5.5),
      row('b', 71.4, 'chopped', 0),
      row('a', 60.1, 'chopped', -11.3),
    ],
    ...overrides,
  }
}

describe('chopWatchFromPreview', () => {
  it('follows the chop: a double chop puts two teams in the zone, immunity is marked, margins are from the line', () => {
    const watch = chopWatchFromPreview(preview(), 6)!
    expect(watch.dangerTiers.map((t) => [t.rosterId, t.tier, t.pointsFromChopZone, t.immune ?? false])).toEqual([
      ['top', 'safe', 59.8, true],
      ['mid', 'safe', 32.6, false],
      ['close', 'danger', 5.5, false],
      ['b', 'chop_zone', 0, false],
      ['a', 'chop_zone', -11.3, false],
    ])
    expect(watch.scores).toEqual({ top: 131.2, mid: 104, close: 76.9, b: 71.4, a: 60.1 })
    expect(watch).toMatchObject({ week: 6, chopCount: 2, chopLine: 71.4 })
  })

  it('🛑 carries none of the commissioner-only parts: the FAAB split, the chat post, roster blockers', () => {
    const json = JSON.stringify(chopWatchFromPreview(preview(), 6))
    for (const secret of ['secret split', 'faab', 'Chopped: A, B', 'cannot be matched', 'announcement', 'blockers']) {
      expect(json).not.toContain(secret)
    }
  })

  it('stands aside when it is about another week, there is no chop, or nobody has scored', () => {
    expect(chopWatchFromPreview(preview(), 7)).toBeNull()
    expect(chopWatchFromPreview(preview({ outcome: 'no_chop_week' }), 6)).toBeNull()
    expect(chopWatchFromPreview(preview({ rows: [row('x', 0, 'safe', 0), row('y', 0, 'chopped', 0)] }), 6)).toBeNull()
  })

  it('the home chop line draws it as the chop would: highest score first, the cut above the highest chopped team', () => {
    const watch = chopWatchFromPreview(preview(), 6)!
    const line = buildChopLine(watch.dangerTiers, 'close', watch.scores)
    expect(line.rows.map((r) => [r.rosterId, r.tier, r.immune, r.cutAbove])).toEqual([
      ['top', 'safe', true, false],
      ['mid', 'safe', false, false],
      ['close', 'danger', false, false],
      ['b', 'chop_zone', false, true],
      ['a', 'chop_zone', false, false],
    ])
    expect(line.cutScore).toBe(71.4)
    expect(line.me).toMatchObject({ rosterId: 'close', margin: 5.5 })
  })
})

describe('loadChopWatch', () => {
  beforeEach(() => clearChopWatchCache())

  it('one build serves the league for a minute; members arriving together share it', async () => {
    let t = 1_000_000
    const loadPreview = vi.fn(async () => preview())
    const deps = { loadPreview, now: () => t }
    const [a, b] = await Promise.all([loadChopWatch('lg1', 6, deps), loadChopWatch('lg1', 6, deps)])
    expect(a).toEqual(b)
    expect(loadPreview).toHaveBeenCalledTimes(1)
    t += CHOP_WATCH_TTL_MS - 1
    await loadChopWatch('lg1', 6, deps)
    expect(loadPreview).toHaveBeenCalledTimes(1)
    t += 1
    await loadChopWatch('lg1', 6, deps)
    expect(loadPreview).toHaveBeenCalledTimes(2)
    // Another league is its own build.
    await loadChopWatch('lg2', 6, deps)
    expect(loadPreview).toHaveBeenCalledTimes(3)
  })

  it('never throws: a failed or refused build is no watch, and the chop line keeps its old source', async () => {
    expect(await loadChopWatch('lg1', 6, { loadPreview: async () => { throw new Error('db down') } })).toBeNull()
    clearChopWatchCache()
    expect(await loadChopWatch('lg1', 6, { loadPreview: async () => ({ error: 'Not a Guilly league.' }) })).toBeNull()
  })
})
