// @vitest-environment node
/**
 * Chimmy's season recap (lib/season-recap/seasonRecapAi.ts): cached per league, season and language;
 * the daily cap is checked before a model is called and counted after one is; a model answer that
 * fails the fact guard is replaced by the deterministic recap. The router, cap and recap loader are
 * injected — no model, no DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleRecap } from './season-recap-fixture'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; metadata: unknown }>,
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueStoryline: {
      findMany: vi.fn(async () => h.rows),
      create: h.create,
      update: h.update,
    },
  },
}))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: vi.fn() }))
vi.mock('@/lib/ai/dailyCaps', () => ({ checkDailyCap: vi.fn(), incrementDailyCap: vi.fn() }))
vi.mock('@/lib/season-recap/seasonRecapService', () => ({ getSeasonRecap: vi.fn() }))

import { buildSeasonRecapPrompt, generateSeasonRecapNarrative, readCachedSeasonRecapNarrative } from '@/lib/season-recap/seasonRecapAi'
import { buildSeasonRecapFacts, seasonRecapFactsHash } from '@/lib/season-recap/seasonRecapFacts'

const recap = sampleRecap()
const GOOD = '[[Aces]] took the 2026 crown over [[Bears]], going 10-4 with 1500.4 points. [[Joe Burrow]] gave [[Bears]] 150.4 points after week 3.'

function deps(over: { text?: string | null; capAllowed?: boolean } = {}) {
  return {
    loadRecap: vi.fn(async () => ({ recap, stored: true })),
    route: vi.fn(async () => (over.text === null ? { ok: false as const } : { ok: true as const, text: JSON.stringify({ text: over.text ?? GOOD }), model: 'm', provider: 'openai' as const, tokensUsed: 1 })),
    checkCap: vi.fn(async () => ({ allowed: over.capAllowed ?? true, used: 0, limit: 5, resetsAt: new Date('2027-01-02T00:00:00Z'), message: 'cap hit', upgradePath: '/pricing' })),
    incrementCap: vi.fn(async () => {}),
    now: () => new Date('2027-01-01T12:00:00Z'),
  }
}

const run = (d: ReturnType<typeof deps>, extra: { lang?: 'en' | 'es'; regenerate?: boolean } = {}) =>
  generateSeasonRecapNarrative({ leagueId: 'l1', season: 2026, userId: 'u1', lang: extra.lang ?? 'en', regenerate: extra.regenerate, deps: d as never })

beforeEach(() => {
  h.rows = []
  vi.clearAllMocks()
})

describe('generateSeasonRecapNarrative', () => {
  it('writes, guards and caches an answer that keeps to the facts, and counts it against the cap', async () => {
    const d = deps()
    const out = await run(d)
    expect(out).toMatchObject({ ok: true, cached: false, factGuardErrors: [], narrative: { source: 'ai', text: GOOD, lang: 'en' } })
    expect(d.checkCap).toHaveBeenCalledWith('commissioner_brain', 'u1', 'pro')
    expect(d.incrementCap).toHaveBeenCalledOnce()
    expect(d.route.mock.calls[0][0]).toMatchObject({ feature: 'season_recap_ai', userId: 'u1', leagueId: 'l1' })
    expect(h.create).toHaveBeenCalledOnce()
    expect(h.create.mock.calls[0][0].data).toMatchObject({ leagueId: 'l1', season: 2026, storyType: 'season_recap_ai' })
  })

  it('a cached narrative over the same facts is served with no model call and no cap check', async () => {
    const factsHash = seasonRecapFactsHash(buildSeasonRecapFacts(recap), 'en')
    h.rows = [{ id: 'row1', metadata: { leagueId: 'l1', season: 2026, lang: 'en', factsHash, text: GOOD, source: 'ai', generatedAt: 'x', generatedByUserId: 'u1' } }]
    const d = deps()
    const out = await run(d)
    expect(out).toMatchObject({ ok: true, cached: true, narrative: { text: GOOD } })
    expect(d.route).not.toHaveBeenCalled()
    expect(d.checkCap).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('a cached narrative in the other language, or over changed facts, is not served', async () => {
    const factsHash = seasonRecapFactsHash(buildSeasonRecapFacts(recap), 'en')
    h.rows = [
      { id: 'es1', metadata: { leagueId: 'l1', season: 2026, lang: 'es', factsHash: seasonRecapFactsHash(buildSeasonRecapFacts(recap), 'es'), text: 'x', source: 'ai', generatedAt: 'x', generatedByUserId: 'u1' } },
      { id: 'en1', metadata: { leagueId: 'l1', season: 2026, lang: 'en', factsHash: 'stale', text: 'old', source: 'ai', generatedAt: 'x', generatedByUserId: 'u1' } },
    ]
    const d = deps()
    const out = await run(d)
    expect(out).toMatchObject({ ok: true, cached: false })
    expect(d.route).toHaveBeenCalledOnce()
    expect(h.update.mock.calls[0][0].where).toEqual({ id: 'en1' })
    expect(factsHash).not.toBe('stale')
  })

  it('regenerate bypasses a current cache entry, still under the cap', async () => {
    const factsHash = seasonRecapFactsHash(buildSeasonRecapFacts(recap), 'en')
    h.rows = [{ id: 'row1', metadata: { leagueId: 'l1', season: 2026, lang: 'en', factsHash, text: GOOD, source: 'template', generatedAt: 'x', generatedByUserId: 'u1' } }]
    const d = deps()
    await run(d, { regenerate: true })
    expect(d.checkCap).toHaveBeenCalledOnce()
    expect(d.route).toHaveBeenCalledOnce()
    expect(h.update).toHaveBeenCalledOnce()
  })

  it('over the daily cap: no model call, nothing written', async () => {
    const d = deps({ capAllowed: false })
    const out = await run(d)
    expect(out).toMatchObject({ ok: false, reason: 'daily_cap', limit: 5 })
    expect(d.route).not.toHaveBeenCalled()
    expect(d.incrementCap).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('an answer that invents a fact is replaced by the deterministic recap (the call still counts)', async () => {
    const d = deps({ text: GOOD.replace('1500.4', '1720') + ' [[Tom Brady]] was robbed.' })
    const out = await run(d)
    if (!out.ok) throw new Error('expected ok')
    expect(out.narrative.source).toBe('template')
    expect(out.narrative.text).toContain('[[Aces]] won the 2026 title')
    expect(out.factGuardErrors.join(' ')).toMatch(/1720/)
    expect(out.factGuardErrors.join(' ')).toMatch(/Tom Brady/)
    expect(d.incrementCap).toHaveBeenCalledOnce()
    expect(h.create.mock.calls[0][0].data.source).toBe('engine')
  })

  it('no model answer: the deterministic recap, and the cap is not counted', async () => {
    const d = deps({ text: null })
    const out = await run(d, { lang: 'es' })
    if (!out.ok) throw new Error('expected ok')
    expect(out.narrative).toMatchObject({ source: 'template', lang: 'es' })
    expect(out.narrative.text).toContain('reclamo')
    expect(d.incrementCap).not.toHaveBeenCalled()
  })

  it('no recap for the season', async () => {
    const d = deps()
    d.loadRecap.mockResolvedValueOnce(null as never)
    expect(await run(d)).toEqual({ ok: false, reason: 'no_recap' })
    expect(d.route).not.toHaveBeenCalled()
  })
})

describe('the prompt', () => {
  it('hands over only the facts, and the Spanish brief says «reclamo», never «waiver»', () => {
    const f = buildSeasonRecapFacts(recap)
    const en = buildSeasonRecapPrompt(f, 'en')
    expect(en.system).toMatch(/Use ONLY the facts/)
    expect(en.user).toContain(JSON.stringify(f.facts))
    const es = buildSeasonRecapPrompt(f, 'es')
    expect(es.system).toContain('«reclamo»')
    expect(`${es.system}\n${es.user}`).not.toMatch(/waiver/i)
  })
})

describe('readCachedSeasonRecapNarrative', () => {
  it('returns the current entry and drops a stale one', async () => {
    const factsHash = seasonRecapFactsHash(buildSeasonRecapFacts(recap), 'en')
    h.rows = [{ id: 'row1', metadata: { leagueId: 'l1', season: 2026, lang: 'en', factsHash, text: GOOD, source: 'ai', generatedAt: 'x', generatedByUserId: 'u1' } }]
    expect((await readCachedSeasonRecapNarrative('l1', 2026, 'en', recap))?.text).toBe(GOOD)
    h.rows = [{ id: 'row1', metadata: { leagueId: 'l1', season: 2026, lang: 'en', factsHash: 'old', text: GOOD, source: 'ai', generatedAt: 'x', generatedByUserId: 'u1' } }]
    expect(await readCachedSeasonRecapNarrative('l1', 2026, 'en', recap)).toBeNull()
  })
})
