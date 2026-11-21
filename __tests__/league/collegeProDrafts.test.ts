import { describe, expect, it } from 'vitest'
import { fantraxDraftCard, sleeperDraftCards } from '@/lib/league/collegePro/drafts'

describe('sleeperDraftCards', () => {
  it('keeps the newest two seasons, newest first, with rounds, type and date', () => {
    const cards = sleeperDraftCards([
      { status: 'complete', season: '2025', type: 'snake', settings: { rounds: 30 } },
      { status: 'complete', season: '2026', type: 'linear', settings: { rounds: 4 } },
      { status: 'pre_draft', season: '2027', type: 'linear', settings: { rounds: 4 }, start_time: Date.UTC(2027, 4, 2, 0) },
    ])
    expect(cards.map((c) => [c.season, c.phase, c.status])).toEqual([
      [2027, 'upcoming', 'Not started'],
      [2026, 'done', 'Done'],
    ])
    expect(cards[0]).toMatchObject({ role: 'pro', detail: '4 rounds · linear', startsAt: '2027-05-02T00:00:00.000Z' })
  })

  it('says "1 round", not "1 rounds"', () => {
    expect(sleeperDraftCards([{ status: 'complete', season: '2026', type: 'linear', settings: { rounds: 1 } }])[0]?.detail).toBe('1 round · linear')
  })

  it('says live while drafting, and passes an unknown status through instead of guessing', () => {
    expect(sleeperDraftCards([{ status: 'drafting', season: '2027' }])[0]).toMatchObject({ phase: 'live', status: 'Live now', detail: null })
    expect(sleeperDraftCards([{ status: 'weird_state', season: '2027' }])[0]).toMatchObject({ phase: 'unknown', status: 'weird_state' })
  })
})

describe('fantraxDraftCard', () => {
  it("reports Cream Bowl's real board: completed with 156 of 192 slots used", () => {
    const card = fantraxDraftCard({ draftState: 'completed', slots: 192, picks: new Array(156).fill({}) }, 2026)
    expect(card).toEqual({ role: 'college', platform: 'fantrax', season: 2026, phase: 'done', status: 'Done', detail: '156 of 192 picks made', startsAt: null })
  })

  it('a board with no picks yet is upcoming, one mid-draft is live', () => {
    expect(fantraxDraftCard({ draftState: null, slots: 48, picks: [] }, 2027)?.phase).toBe('upcoming')
    expect(fantraxDraftCard({ draftState: 'in_progress', slots: 48, picks: [{}] }, 2027)?.phase).toBe('live')
  })

  it('no board on file is no card, never a made-up status', () => {
    expect(fantraxDraftCard(null, 2026)).toBeNull()
  })
})
