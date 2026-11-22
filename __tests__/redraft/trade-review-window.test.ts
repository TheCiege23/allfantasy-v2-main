import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRADE_REVIEW_HOURS,
  explainTradeReview,
  reviewWindowEnded,
  reviewWindowEndsAt,
  tradeReviewWindowHours,
  type TradeReviewProposal,
} from '@/lib/redraft/tradeReviewWindow'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const fmt = (d: Date) => d.toISOString().slice(0, 16)
const p = (over: Partial<TradeReviewProposal>): TradeReviewProposal => ({
  status: 'pending', vetoMode: 'commissioner', vetoThreshold: 4, acceptedAt: null, expiresAt: '2026-10-26T12:00:00Z', votes: [], ...over,
})

describe('the review window', () => {
  it("reads League.tradeReviewHours: unset is 48, 0 is allowed, out of range is clamped", () => {
    expect(tradeReviewWindowHours(null)).toBe(DEFAULT_TRADE_REVIEW_HOURS)
    expect(tradeReviewWindowHours(undefined)).toBe(48)
    expect(tradeReviewWindowHours(24)).toBe(24)
    expect(tradeReviewWindowHours(0)).toBe(0)
    expect(tradeReviewWindowHours(-5)).toBe(0)
    expect(tradeReviewWindowHours(500)).toBe(168)
    expect(tradeReviewWindowHours(36.7)).toBe(36)
  })

  it('ends that many hours after acceptance, and only an accepted trade can have ended', () => {
    const at = new Date('2026-10-25T10:00:00Z')
    expect(reviewWindowEndsAt(at, 48).toISOString()).toBe('2026-10-27T10:00:00.000Z')
    expect(reviewWindowEnded({ acceptedAt: at, expiresAt: new Date(NOW - 1) }, NOW)).toBe(true)
    expect(reviewWindowEnded({ acceptedAt: at, expiresAt: new Date(NOW + 1) }, NOW)).toBe(false)
    // A lapsed OFFER is not an ended review.
    expect(reviewWindowEnded({ acceptedAt: null, expiresAt: new Date(NOW - 1) }, NOW)).toBe(false)
  })
})

describe('what a manager is told', () => {
  it('before acceptance: who reviews next, and when the offer lapses', () => {
    expect(explainTradeReview(p({}), NOW, fmt)).toMatchObject({
      phase: 'awaiting_receiver', reviewer: 'commissioner',
      en: 'Waiting on the other manager. If accepted, the commissioner reviews it before it goes through. The offer lapses 2026-10-26T12:00.',
    })
    expect(explainTradeReview(p({ vetoMode: 'league_vote' }), NOW, fmt).en).toContain('the league can vote on it')
    expect(explainTradeReview(p({ vetoMode: 'no_veto' }), NOW, fmt).en).toContain('goes through right away')
  })

  it('commissioner review: goes through at the end unless vetoed', () => {
    const e = explainTradeReview(p({ acceptedAt: '2026-10-25T11:00:00Z' }), NOW, fmt)
    expect(e).toMatchObject({ phase: 'in_review', reviewer: 'commissioner', endsAt: '2026-10-26T12:00:00.000Z', votes: null })
    expect(e.en).toBe('Under commissioner review. It goes through on 2026-10-26T12:00 unless the commissioner vetoes it; the commissioner can also approve it sooner.')
    expect(e.es).toContain('salvo que el comisionado lo vete')
  })

  it('league vote: the veto tally against the threshold, and approvals when there are some', () => {
    const none = explainTradeReview(p({ vetoMode: 'league_vote', acceptedAt: '2026-10-25T11:00:00Z', votes: [{ vote: 'veto' }] }), NOW, fmt)
    expect(none.votes).toEqual({ approve: 0, veto: 1, needed: 4 })
    expect(none.en).toBe('Under league review: 1 of 4 veto votes so far. It goes through on 2026-10-26T12:00 unless 4 managers veto it.')
    const some = explainTradeReview(
      p({ vetoMode: 'league_vote', vetoThreshold: 3, acceptedAt: '2026-10-25T11:00:00Z', votes: [{ vote: 'approve' }, { vote: 'approve' }, { vote: 'veto' }] }),
      NOW,
      fmt,
    )
    expect(some.en).toBe('Under league review: 1 of 3 veto votes so far. It goes through on 2026-10-26T12:00 unless 3 managers veto it, or sooner if 3 approve (2 have).')
  })

  it('after the window: going through within the hour', () => {
    const e = explainTradeReview(p({ acceptedAt: '2026-10-23T11:00:00Z', expiresAt: '2026-10-25T11:00:00Z' }), NOW, fmt)
    expect(e.phase).toBe('review_ended')
    expect(e.en).toBe('The review window has ended with no veto. The trade is going through within the hour.')
    // «intercambio», never «traspaso» (the Trade Center's Spanish term).
    expect(e.es).toBe('La ventana de revisión terminó sin veto. El intercambio se procesa en menos de una hora.')
  })

  it('says nothing about a trade that is already settled', () => {
    expect(explainTradeReview(p({ status: 'accepted', acceptedAt: '2026-10-25T11:00:00Z' }), NOW, fmt)).toMatchObject({ phase: 'settled', en: '' })
  })
})
