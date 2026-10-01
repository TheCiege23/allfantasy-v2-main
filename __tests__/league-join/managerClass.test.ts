import { describe, expect, it } from 'vitest'
import {
  CLASS_EXCEPTIONS_KEY,
  CLASS_REQUESTS_KEY,
  MANAGER_CLASS_BAND,
  MAX_CLASS_LEVEL,
  classRangeFor,
  hasClassException,
  isWithinClass,
  readClassExceptions,
  readClassJoinRequests,
  resolveLeagueClassRange,
  withClassException,
  withClassJoinRequest,
  withoutClassException,
  withoutClassJoinRequest,
} from '@/lib/league-join/managerClass'
import { isLeagueVisibleForCareerTier } from '@/lib/ranking/tier-visibility'
import { classBlockedMessage, medianClass, skillClassFor, skillClassRatingSpan } from '@/lib/league-join/managerClass'

describe('manager class band', () => {
  it('is ±2', () => {
    expect(MANAGER_CLASS_BAND).toBe(2)
    expect(classRangeFor(20)).toEqual({ center: 20, min: 18, max: 22 })
  })

  it('a Level 20 manager may join leagues centred on 18 through 22 and nothing else', () => {
    const allowed = Array.from({ length: MAX_CLASS_LEVEL }, (_, i) => i + 1).filter((center) =>
      isWithinClass(20, classRangeFor(center)),
    )
    expect(allowed).toEqual([18, 19, 20, 21, 22])
  })

  it('clips at both ends of the ladder', () => {
    expect(classRangeFor(1)).toEqual({ center: 1, min: 1, max: 3 })
    expect(classRangeFor(MAX_CLASS_LEVEL)).toEqual({
      center: MAX_CLASS_LEVEL,
      min: MAX_CLASS_LEVEL - 2,
      max: MAX_CLASS_LEVEL,
    })
    expect(classRangeFor(0).min).toBe(1)
    expect(classRangeFor(Number.NaN).center).toBe(1)
  })

  it('discovery uses the same band as the join gate', () => {
    expect(isLeagueVisibleForCareerTier(10, 12)).toBe(true)
    expect(isLeagueVisibleForCareerTier(10, 8)).toBe(true)
    expect(isLeagueVisibleForCareerTier(10, 13)).toBe(false)
    expect(isLeagueVisibleForCareerTier(10, 7)).toBe(false)
  })
})

describe('resolveLeagueClassRange', () => {
  it('recomputes from the centre, so legacy ±3 listings become ±2', () => {
    expect(resolveLeagueClassRange({ creatorRankLevel: 9, minRankLevel: 6, maxRankLevel: 12 })).toEqual({
      center: 9,
      min: 7,
      max: 11,
    })
  })

  it('uses the stored range when there is no centre, and nothing when there is neither', () => {
    expect(resolveLeagueClassRange({ creatorRankLevel: null, minRankLevel: 3, maxRankLevel: 5 })).toEqual({
      center: 4,
      min: 3,
      max: 5,
    })
    expect(resolveLeagueClassRange({ creatorRankLevel: null, minRankLevel: null, maxRankLevel: null })).toBeNull()
    expect(resolveLeagueClassRange({ creatorRankLevel: null, minRankLevel: 6, maxRankLevel: 2 })).toBeNull()
    expect(resolveLeagueClassRange(null)).toBeNull()
  })
})

describe('exceptions and requests on League.settings', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')

  it('keeps every other settings key untouched', () => {
    const settings = { inviteCode: 'ABC', scoring: { ppr: 1 } }
    const next = withClassJoinRequest(settings, { userId: 'u1', levelAtRequest: 3, now })
    expect(next.inviteCode).toBe('ABC')
    expect(next.scoring).toEqual({ ppr: 1 })
    expect(settings).not.toHaveProperty(CLASS_REQUESTS_KEY)
  })

  it('records a request once, keeping the first timestamp', () => {
    let s: Record<string, unknown> = withClassJoinRequest({}, { userId: 'u1', levelAtRequest: 3, now })
    s = withClassJoinRequest(s, { userId: 'u1', levelAtRequest: 3, now: new Date('2026-10-05T00:00:00.000Z') })
    const reqs = readClassJoinRequests(s)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].requestedAt).toBe(now.toISOString())
  })

  it('approving a request grants the exception and clears the request', () => {
    let s: Record<string, unknown> = withClassJoinRequest({}, { userId: 'u1', levelAtRequest: 3, now })
    s = withClassJoinRequest(s, { userId: 'u2', levelAtRequest: 4, now })
    s = withClassException(s, { userId: 'u1', grantedBy: 'comm', via: 'request', levelAtGrant: 3, now })

    expect(hasClassException(s, 'u1')).toBe(true)
    expect(hasClassException(s, 'u2')).toBe(false)
    expect(readClassJoinRequests(s).map((r) => r.userId)).toEqual(['u2'])
    expect(readClassExceptions(s)[0]).toMatchObject({ userId: 'u1', grantedBy: 'comm', via: 'request', levelAtGrant: 3 })
  })

  it('declining clears the request without granting anything', () => {
    let s: Record<string, unknown> = withClassJoinRequest({}, { userId: 'u1', levelAtRequest: 3, now })
    s = withoutClassJoinRequest(s, 'u1')
    expect(readClassJoinRequests(s)).toEqual([])
    expect(hasClassException(s, 'u1')).toBe(false)
  })

  it('revoking removes only that manager', () => {
    let s: Record<string, unknown> = withClassException({}, { userId: 'u1', grantedBy: 'c', via: 'direct', levelAtGrant: 1, now })
    s = withClassException(s, { userId: 'u2', grantedBy: 'c', via: 'direct', levelAtGrant: 1, now })
    s = withoutClassException(s, 'u1')
    expect(readClassExceptions(s).map((e) => e.userId)).toEqual(['u2'])
  })

  it('drops malformed and duplicate entries rather than trusting stored JSON', () => {
    const s = {
      [CLASS_EXCEPTIONS_KEY]: [null, 'x', { userId: '' }, { userId: 'u1' }, { userId: 'u1', via: 'request' }],
      [CLASS_REQUESTS_KEY]: { not: 'an array' },
    }
    expect(readClassExceptions(s).map((e) => e.userId)).toEqual(['u1'])
    expect(readClassExceptions(s)[0].via).toBe('direct')
    expect(readClassJoinRequests(s)).toEqual([])
    expect(hasClassException(null, 'u1')).toBe(false)
  })
})

describe('skill classes', () => {
  it('are fixed 50-point bands with Class 13 centred on 1500', () => {
    expect(skillClassFor(1500)).toBe(13)
    expect(skillClassFor(1524)).toBe(13)
    expect(skillClassFor(1525)).toBe(14)
    expect(skillClassFor(1474)).toBe(12)
    expect(skillClassRatingSpan(13)).toEqual({ lo: 1475, hi: 1524 })
    expect(skillClassFor(5000)).toBe(25)
    expect(skillClassFor(-5000)).toBe(1)
  })

  it('±2 classes is about ±100 rating points', () => {
    expect(skillClassRatingSpan(15).hi - skillClassRatingSpan(11).lo + 1).toBe(250)
  })

  it('the league median takes the lower middle, so one strong late joiner cannot lift it', () => {
    expect(medianClass([12, 13, 20])).toBe(13)
    expect(medianClass([12, 20])).toBe(12)
    expect(medianClass([])).toBeNull()
  })

  it('says which basis blocked the manager', () => {
    expect(classBlockedMessage({ min: 12, max: 16 }, 19, 'skill', 'NFL')).toContain('NFL skill Class 12–16 (ratings 1425–1674), and you are Class 19')
    expect(classBlockedMessage({ min: 5, max: 9 }, 2)).toContain('Level 5–9, and you are Level 2')
  })
})
