import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  buildAiCacheKey,
  hashScope,
  hashQuestion,
  hashContext,
  getCachedAiAnswer,
  setCachedAiAnswer,
  AI_CACHE_TTL,
} from '@/lib/ai/aiCache'

const mockFindUnique = prisma.sportsDataCache.findUnique as ReturnType<typeof vi.fn>
const mockUpsert = prisma.sportsDataCache.upsert as ReturnType<typeof vi.fn>
const mockDeleteMany = prisma.sportsDataCache.deleteMany as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  mockDeleteMany.mockResolvedValue({ count: 1 })
})

// ── AI_CACHE_TTL shape ────────────────────────────────────────────────────────

describe('AI_CACHE_TTL', () => {
  it('all TTLs are positive integers', () => {
    for (const ttl of Object.values(AI_CACHE_TTL)) {
      expect(Number.isInteger(ttl)).toBe(true)
      expect(ttl).toBeGreaterThan(0)
    }
  })

  it('explain_bracket TTL is longer than chimmy TTL', () => {
    expect(AI_CACHE_TTL.explain_bracket).toBeGreaterThan(AI_CACHE_TTL.chimmy)
  })
})

// ── hashScope ────────────────────────────────────────────────────────────────

describe('hashScope', () => {
  it('returns a 24-char hex string', () => {
    const result = hashScope('user-id-abc')
    expect(result).toMatch(/^[0-9a-f]{24}$/)
  })

  it('is deterministic for the same input', () => {
    expect(hashScope('user-abc')).toBe(hashScope('user-abc'))
  })

  it('different inputs produce different hashes', () => {
    expect(hashScope('user-abc')).not.toBe(hashScope('user-xyz'))
  })

  it('never contains the raw input', () => {
    const rawId = 'raw-user-identifier'
    expect(hashScope(rawId)).not.toContain(rawId)
  })

  it('never contains email-like strings', () => {
    const email = 'user@example.com'
    const result = hashScope(email)
    expect(result).not.toContain('@')
    expect(result).not.toContain('example')
  })
})

// ── hashQuestion ─────────────────────────────────────────────────────────────

describe('hashQuestion', () => {
  it('returns a 24-char hex string', () => {
    expect(hashQuestion('What are the games today?')).toMatch(/^[0-9a-f]{24}$/)
  })

  it('is case-insensitive', () => {
    expect(hashQuestion('WHAT GAMES TODAY')).toBe(hashQuestion('what games today'))
  })

  it('trims whitespace', () => {
    expect(hashQuestion('  hello  ')).toBe(hashQuestion('hello'))
  })

  it('different questions produce different hashes', () => {
    expect(hashQuestion('What are the games today?')).not.toBe(
      hashQuestion('What is my rank?')
    )
  })

  it('never contains the raw question text', () => {
    const question = 'Who should I start this week?'
    expect(hashQuestion(question)).not.toContain('start')
  })
})

// ── hashContext ───────────────────────────────────────────────────────────────

describe('hashContext', () => {
  it('returns a 24-char hex string', () => {
    expect(hashContext({ sport: 'nfl', leagueId: 'lg-123' })).toMatch(/^[0-9a-f]{24}$/)
  })

  it('is deterministic for same context', () => {
    const ctx = { sport: 'nfl', leagueId: 'lg-123', language: 'en' }
    expect(hashContext(ctx)).toBe(hashContext(ctx))
  })

  it('different language produces different hash', () => {
    const en = hashContext({ sport: 'nfl', leagueId: 'lg-123', language: 'en' })
    const es = hashContext({ sport: 'nfl', leagueId: 'lg-123', language: 'es' })
    expect(en).not.toBe(es)
  })

  it('different leagueId produces different hash', () => {
    const a = hashContext({ sport: 'nfl', leagueId: 'league-A' })
    const b = hashContext({ sport: 'nfl', leagueId: 'league-B' })
    expect(a).not.toBe(b)
  })

  it('null fields are treated the same as omitted fields', () => {
    const withNull = hashContext({ sport: 'nfl', leagueId: null })
    const withOmit = hashContext({ sport: 'nfl' })
    expect(withNull).toBe(withOmit)
  })

  it('never contains raw leagueId in output', () => {
    const leagueId = 'raw-league-id-secret'
    const result = hashContext({ leagueId })
    expect(result).not.toContain(leagueId)
  })

  // ── Language isolation ────────────────────────────────────────────────────

  it('all 5 supported locales produce distinct context hashes', () => {
    const base = { sport: 'NFL', leagueId: null, assistantMode: null }
    const hashes = ['en', 'es', 'zh', 'fil', 'vi'].map((lang) =>
      hashContext({ ...base, language: lang })
    )
    expect(new Set(hashes).size).toBe(5)
  })

  it('en and null/omitted language produce different hashes', () => {
    const withEn = hashContext({ sport: 'NFL', language: 'en' })
    const withNull = hashContext({ sport: 'NFL', language: null })
    expect(withEn).not.toBe(withNull)
  })

  it('same language produces identical hash (deterministic)', () => {
    const a = hashContext({ sport: 'NFL', language: 'es' })
    const b = hashContext({ sport: 'NFL', language: 'es' })
    expect(a).toBe(b)
  })

  it('language does not bleed into sport hash — different language, same sport still differs', () => {
    const enNfl = hashContext({ sport: 'NFL', language: 'en' })
    const esNfl = hashContext({ sport: 'NFL', language: 'es' })
    const enNba = hashContext({ sport: 'NBA', language: 'en' })
    // All three are distinct
    expect(new Set([enNfl, esNfl, enNba]).size).toBe(3)
  })
})

// ── buildAiCacheKey ───────────────────────────────────────────────────────────

describe('buildAiCacheKey', () => {
  it('returns a string matching aic:feature:scope:qhash:chash', () => {
    const key = buildAiCacheKey('chimmy', 'abc123', 'def456', 'ghi789')
    expect(key).toBe('aic:chimmy:abc123:def456:ghi789')
  })

  it('different features produce different keys', () => {
    const scope = hashScope('user-123')
    const q = hashQuestion('hello')
    const ctx = hashContext({ sport: 'nfl' })
    expect(buildAiCacheKey('chimmy', scope, q, ctx)).not.toBe(
      buildAiCacheKey('explain_bracket', scope, q, ctx)
    )
  })

  it('key does not contain raw user ID', () => {
    const rawId = 'raw-user-id'
    const scope = hashScope(rawId)
    const key = buildAiCacheKey('chimmy', scope, 'qhash', 'chash')
    expect(key).not.toContain(rawId)
  })
})

// ── getCachedAiAnswer ─────────────────────────────────────────────────────────

describe('getCachedAiAnswer', () => {
  it('returns null on cache miss', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await getCachedAiAnswer('aic:chimmy:scope:q:c')

    expect(result).toBeNull()
  })

  it('returns the cached text on hit', async () => {
    mockFindUnique.mockResolvedValue({
      data: { text: 'Cached answer here' },
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await getCachedAiAnswer('aic:chimmy:scope:q:c')

    expect(result).toBe('Cached answer here')
  })

  it('returns null for expired rows', async () => {
    mockFindUnique.mockResolvedValue({
      data: { text: 'Stale answer' },
      expiresAt: new Date(Date.now() - 1_000), // 1 second in the past
    })

    const result = await getCachedAiAnswer('aic:chimmy:scope:q:c')

    expect(result).toBeNull()
  })

  it('triggers a lazy delete for expired rows', async () => {
    mockFindUnique.mockResolvedValue({
      data: { text: 'Stale' },
      expiresAt: new Date(Date.now() - 1_000),
    })

    await getCachedAiAnswer('aic:chimmy:scope:q:c')

    // deleteMany is fire-and-forget — wait a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(mockDeleteMany).toHaveBeenCalled()
  })

  it('returns null when data.text is missing', async () => {
    mockFindUnique.mockResolvedValue({
      data: {},
      expiresAt: new Date(Date.now() + 60_000),
    })

    const result = await getCachedAiAnswer('aic:chimmy:scope:q:c')

    expect(result).toBeNull()
  })

  it('returns null on DB error', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB offline'))

    const result = await getCachedAiAnswer('aic:chimmy:scope:q:c')

    expect(result).toBeNull()
  })
})

// ── setCachedAiAnswer ─────────────────────────────────────────────────────────

describe('setCachedAiAnswer', () => {
  it('calls upsert with correct key and data', async () => {
    mockUpsert.mockResolvedValue({})

    await setCachedAiAnswer('aic:chimmy:scope:q:c', 'My answer', 1_200)

    expect(mockUpsert).toHaveBeenCalledOnce()
    const call = mockUpsert.mock.calls[0][0]
    expect(call.where.cacheKey).toBe('aic:chimmy:scope:q:c')
    expect(call.create.data).toEqual({ text: 'My answer' })
    expect(call.update.data).toEqual({ text: 'My answer' })
  })

  it('sets expiresAt in the future based on TTL', async () => {
    mockUpsert.mockResolvedValue({})
    const before = Date.now()

    await setCachedAiAnswer('aic:chimmy:scope:q:c', 'text', 1_200)

    const call = mockUpsert.mock.calls[0][0]
    const expiresAt: Date = call.create.expiresAt
    expect(expiresAt.getTime()).toBeGreaterThan(before + 1_100_000) // ~1200s
    expect(expiresAt.getTime()).toBeLessThan(before + 1_300_000)
  })

  it('does nothing when ttlSeconds is 0', async () => {
    await setCachedAiAnswer('aic:chimmy:scope:q:c', 'text', 0)

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('does nothing when ttlSeconds is negative', async () => {
    await setCachedAiAnswer('aic:chimmy:scope:q:c', 'text', -100)

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('never throws when DB errors', async () => {
    mockUpsert.mockRejectedValue(new Error('DB gone'))

    await expect(
      setCachedAiAnswer('aic:chimmy:scope:q:c', 'text', 1_200)
    ).resolves.toBeUndefined()
  })
})

// ── Cross-user privacy ────────────────────────────────────────────────────────

describe('user privacy — same question, different users', () => {
  it('different users get different cache keys', () => {
    const question = 'What is my rank?'
    const ctx = { sport: 'nfl', leagueId: 'lg-1' }

    const keyA = buildAiCacheKey(
      'chimmy',
      hashScope('user-alice'),
      hashQuestion(question),
      hashContext(ctx)
    )
    const keyB = buildAiCacheKey(
      'chimmy',
      hashScope('user-bob'),
      hashQuestion(question),
      hashContext(ctx)
    )

    expect(keyA).not.toBe(keyB)
  })
})
