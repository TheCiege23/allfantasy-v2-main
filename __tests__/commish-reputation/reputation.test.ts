import { describe, expect, it } from 'vitest'
import { appendEntry, isPublic, publicReputation, readEntries, STORED_MAX, summarize, validateRatings, type RatingEntry } from '@/lib/commish-reputation/reputation'

const all = (n: number) => ({ fairness: n, communication: n, responsiveness: n, organization: n, enjoyment: n })
const entry = (userId: string, n: number, season = 2026): RatingEntry => ({ userId, season, ratings: all(n), comment: 'secret note', submittedAt: '2026-12-30T00:00:00Z' })

describe('validateRatings', () => {
  it('needs every question as a whole 1–5', () => {
    expect(validateRatings(all(5))).toEqual({ ok: true, ratings: all(5) })
    expect(validateRatings(null)).toEqual({ ok: false, error: 'ratings_required' })
    expect(validateRatings({ ...all(4), fairness: 6 })).toEqual({ ok: false, error: 'invalid_fairness' })
    expect(validateRatings({ ...all(4), enjoyment: 3.5 })).toEqual({ ok: false, error: 'invalid_enjoyment' })
    const { organization: _o, ...missing } = all(4)
    expect(validateRatings(missing)).toEqual({ ok: false, error: 'invalid_organization' })
  })
})

describe('summarize — across every league the commissioner runs', () => {
  it('rolls up ratings, distinct raters and leagues', () => {
    const s = summarize([
      { leagueId: 'L1', entries: [entry('a', 5), entry('b', 4), entry('a', 3, 2025)] },
      { leagueId: 'L2', entries: [entry('c', 4)] },
      { leagueId: 'L3', entries: [] },
    ])
    expect(s).toMatchObject({ ratings: 4, raters: 3, leagues: 2, overall: 4, seasons: [2026, 2025] })
    expect(s.byQuestion.fairness).toBe(4)
  })
  it('is empty and null with no ratings', () => {
    expect(summarize([{ leagueId: 'L1', entries: [] }])).toMatchObject({ ratings: 0, raters: 0, overall: null })
  })
})

describe('publicReputation — the only public shape', () => {
  const s = (entries: RatingEntry[]) => summarize([{ leagueId: 'L1', entries }])
  it('shows no score below the evidence floor', () => {
    // 4 perfect ratings: not enough volume.
    expect(publicReputation(s(['a', 'b', 'c', 'd'].map((u) => entry(u, 5))))).toEqual({ kind: 'new', ratings: 4 })
    // 5 ratings but from only 2 managers over several seasons: not enough raters.
    const twoRaters = [entry('a', 5, 2022), entry('a', 5, 2023), entry('a', 5, 2024), entry('b', 5, 2023), entry('b', 5, 2024)]
    expect(publicReputation(s(twoRaters))).toEqual({ kind: 'new', ratings: 5 })
  })
  it('earns "well-run" at 4.2 or better, and a plain score below it', () => {
    const good = ['a', 'b', 'c', 'd', 'e'].map((u) => entry(u, u === 'e' ? 4 : 5))
    expect(publicReputation(s(good))).toEqual({ kind: 'rated', overall: 4.8, ratings: 5, leagues: 1, wellRun: true })
    const ok = ['a', 'b', 'c', 'd', 'e'].map((u) => entry(u, 4))
    expect(publicReputation(s(ok))).toMatchObject({ kind: 'rated', overall: 4, wellRun: false })
  })
  it('never carries a rater id or a comment', () => {
    const pub = publicReputation(s(['a', 'b', 'c', 'd', 'e'].map((u) => entry(u, 5))))
    expect(JSON.stringify(pub)).not.toMatch(/secret note|"a"|userId/)
  })
})

describe('storage', () => {
  it('reads only well-formed entries, and the opt-in is strict', () => {
    const settings = { commissioner_ratings: { entries: [entry('a', 5), { userId: 'x' }, null] }, commissioner_reputation_public: 'yes' }
    expect(readEntries(settings)).toHaveLength(1)
    expect(isPublic(settings)).toBe(false)
    expect(isPublic({ commissioner_reputation_public: true })).toBe(true)
  })
  it('keeps the newest entries when full', () => {
    const many = Array.from({ length: STORED_MAX }, (_, i) => entry(`u${i}`, 4))
    const next = appendEntry(many, entry('newest', 5))
    expect(next).toHaveLength(STORED_MAX)
    expect(next[next.length - 1].userId).toBe('newest')
    expect(next[0].userId).toBe('u1')
  })
})
