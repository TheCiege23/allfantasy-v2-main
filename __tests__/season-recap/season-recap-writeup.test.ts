// @vitest-environment node
/**
 * Chimmy's written season recap (lib/season-recap/seasonRecapAiService.ts): the AF Commissioner gate,
 * the fact guard, the stored-text cache and the daily cap. Every dependency is injected, so no test
 * reaches a model, the plan service or the database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class {} }))

import {
  generateSeasonRecapWriteup,
  seasonRecapWriteupView,
  type SeasonRecapWriteup,
  type WriteupDeps,
} from '@/lib/season-recap/seasonRecapAiService'
import { buildSeasonRecapFacts, seasonRecapFactsHash } from '@/lib/season-recap/seasonRecapFacts'
import { validateSeasonRecapText } from '@/lib/league-story-creator/StoryFactGuard'
import { RECAP_LEAGUE_ID, RECAP_SEASON, recapFixture } from './recapFixture'

const COMMISH = 'usr-commish-501'
const MEMBER = 'usr-member-502'
const LEAGUE_NAME = 'Gridiron 99 League'

const recap = recapFixture()
const facts = buildSeasonRecapFacts(recap, LEAGUE_NAME)
const HASH = seasonRecapFactsHash(facts)

/** A recap built only from the facts: Bears champion, Aces runner-up, 150.3 in week 2, +300 trade. */
const GOOD = {
  headline: 'Bears win the 2026 title',
  paragraphs: [
    'Bears beat Aces in the final to take the 2026 crown.',
    'Aces posted the highest week of the season, 150.3 points in week 2, and won the best trade by value at +300.',
    'Jordan Reed was the best pickup, scoring 64.2 points after week 1.',
  ],
  provider: 'openai',
  model: 'test-model',
}

function deps(over: Partial<WriteupDeps> = {}) {
  const store: { doc: Parameters<NonNullable<WriteupDeps['saveDoc']>>[0] | null } = { doc: null }
  const d = {
    role: vi.fn(async (_l: string, u: string) => (u === COMMISH ? ('commissioner' as const) : ('member' as const))),
    entitled: vi.fn(async () => true),
    upgradePath: vi.fn(async () => '/pricing?from=season-recap'),
    loadRecap: vi.fn(async () => recap),
    leagueName: vi.fn(async () => LEAGUE_NAME),
    checkCap: vi.fn(async () => ({ allowed: true, message: '', resetsAt: new Date('2027-01-11T00:00:00Z'), upgradePath: '/pricing' })),
    countCall: vi.fn(async () => undefined),
    write: vi.fn(async () => GOOD),
    readDoc: vi.fn(async () => store.doc),
    saveDoc: vi.fn(async (doc: NonNullable<typeof store.doc>) => {
      store.doc = doc
    }),
    now: () => new Date('2027-01-10T12:00:00Z'),
    ...over,
  }
  return { d: d as unknown as WriteupDeps & typeof d, store }
}

const args = (userId = COMMISH, over: Partial<Parameters<typeof generateSeasonRecapWriteup>[0]> = {}) => ({
  leagueId: RECAP_LEAGUE_ID,
  season: RECAP_SEASON,
  userId,
  language: 'en' as const,
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('the gate — the Storyline Studio gate, reused', () => {
  it('a commissioner without AF Commissioner cannot generate, and no model is called', async () => {
    const { d } = deps({ entitled: vi.fn(async () => false) })
    const r = await generateSeasonRecapWriteup(args(), d)
    expect(r).toEqual({ ok: false, error: 'not_entitled', upgradePath: '/pricing?from=season-recap' })
    expect(d.write).not.toHaveBeenCalled()
    expect(d.checkCap).not.toHaveBeenCalled()
    expect(d.saveDoc).not.toHaveBeenCalled()
  })

  it('a member who is not the commissioner cannot generate, even on a plan', async () => {
    const { d } = deps()
    const r = await generateSeasonRecapWriteup(args(MEMBER), d)
    expect(r).toEqual({ ok: false, error: 'commissioner_only' })
    expect(d.entitled).not.toHaveBeenCalled()
    expect(d.write).not.toHaveBeenCalled()
  })

  it('outside the league it is not found', async () => {
    const { d } = deps({ role: vi.fn(async () => null) })
    expect(await generateSeasonRecapWriteup(args('usr-stranger-503'), d)).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('the fact guard decides, not the model', () => {
  it('a recap with an invented stat is refused and not stored', async () => {
    const invented = { ...GOOD, paragraphs: [...GOOD.paragraphs, 'Bears scored 212.5 points in the final.'] }
    const { d, store } = deps({ write: vi.fn(async () => invented) })
    const r = await generateSeasonRecapWriteup(args(), d)
    expect(r.ok).toBe(false)
    if (r.ok || r.error !== 'fact_guard') throw new Error('expected a fact-guard refusal')
    expect(r.factGuardErrors.join(' ')).toContain('212.5')
    expect(d.saveDoc).not.toHaveBeenCalled()
    expect(store.doc).toBeNull()
    // The call was made, so it counts against the cap.
    expect(d.countCall).toHaveBeenCalledTimes(1)
  })

  it('the same text without the invented stat passes and is stored', async () => {
    const { d, store } = deps()
    const r = await generateSeasonRecapWriteup(args(), d)
    expect(r).toMatchObject({ ok: true, cached: false, writeup: { headline: GOOD.headline, factsHash: HASH, generatedByUserId: COMMISH } })
    expect(store.doc?.texts.en?.paragraphs).toEqual(GOOD.paragraphs)
    expect(d.write).toHaveBeenCalledWith(expect.objectContaining({ facts, language: 'en', userId: COMMISH, leagueId: RECAP_LEAGUE_ID }))
  })

  it('dropping the champion is refused', () => {
    const r = validateSeasonRecapText('Aces had the highest week, 150.3 points in week 2.', facts, { requiredNames: ['Bears'] })
    expect(r.passed).toBe(false)
    expect(r.errors).toContain('Recap dropped "Bears".')
  })

  it('a number inside a fact name is not an invented number, and a page-rounded value is allowed', () => {
    const ok = validateSeasonRecapText(`${LEAGUE_NAME}: Bears won 2026. Aces scored 480.4 points (about 480).`, facts, { requiredNames: ['Bears'] })
    expect(ok).toMatchObject({ passed: true, errors: [] })
  })

  it('Spanish says «reclamo», never «waiver»', () => {
    const es = validateSeasonRecapText('Bears ganó 2026. Jordan Reed fue el mejor waiver.', facts, { requiredNames: ['Bears'], language: 'es' })
    expect(es.passed).toBe(false)
    expect(es.errors.join(' ')).toContain('reclamo')
    const ok = validateSeasonRecapText('Bears ganó 2026. Jordan Reed fue el mejor reclamo, con 64,2 puntos.', facts, { requiredNames: ['Bears'], language: 'es' })
    expect(ok.passed).toBe(true)
  })

  it('a Spanish recap that says «waiver» is refused end to end', async () => {
    const { d } = deps({ write: vi.fn(async () => ({ ...GOOD, paragraphs: ['Bears ganó 2026 con el mejor waiver de la liga.'] })) })
    const r = await generateSeasonRecapWriteup(args(COMMISH, { language: 'es' }), d)
    expect(r).toMatchObject({ ok: false, error: 'fact_guard' })
    expect(d.saveDoc).not.toHaveBeenCalled()
  })
})

describe('the stored text is the cache', () => {
  it('reopening returns the stored recap without calling the model or the cap', async () => {
    const { d } = deps()
    const first = await generateSeasonRecapWriteup(args(), d)
    expect(first).toMatchObject({ ok: true, cached: false })
    d.write.mockClear()
    d.checkCap.mockClear()
    d.countCall.mockClear()

    const again = await generateSeasonRecapWriteup(args(), d)
    expect(again).toMatchObject({ ok: true, cached: true, writeup: { headline: GOOD.headline } })
    expect(d.write).not.toHaveBeenCalled()
    expect(d.checkCap).not.toHaveBeenCalled()
    expect(d.countCall).not.toHaveBeenCalled()
  })

  it('a stored text written from different facts is not served, and is written again', async () => {
    const stale: SeasonRecapWriteup = { language: 'en', headline: 'Old', paragraphs: ['Old'], factsHash: 'hash-from-an-older-recap', generatedAt: '2026-12-30T00:00:00Z', generatedByUserId: COMMISH }
    const { d, store } = deps()
    store.doc = { version: 1, leagueId: RECAP_LEAGUE_ID, season: RECAP_SEASON, texts: { en: stale } }
    const r = await generateSeasonRecapWriteup(args(), d)
    expect(r).toMatchObject({ ok: true, cached: false })
    expect(d.write).toHaveBeenCalledTimes(1)
  })

  it('each language is its own text: an English recap is not served to a Spanish reader', async () => {
    const { d } = deps()
    await generateSeasonRecapWriteup(args(), d)
    d.write.mockClear()
    d.write.mockResolvedValueOnce({ ...GOOD, headline: 'Bears gana el título de 2026', paragraphs: ['Bears venció a Aces en la final de 2026.'] })
    const es = await generateSeasonRecapWriteup(args(COMMISH, { language: 'es' }), d)
    expect(es).toMatchObject({ ok: true, cached: false, writeup: { language: 'es' } })
    expect(d.write).toHaveBeenCalledTimes(1)
  })

  it('regenerate skips the cache and is capped like any call', async () => {
    const { d } = deps()
    await generateSeasonRecapWriteup(args(), d)
    d.write.mockClear()
    const r = await generateSeasonRecapWriteup(args(COMMISH, { regenerate: true }), d)
    expect(r).toMatchObject({ ok: true, cached: false })
    expect(d.write).toHaveBeenCalledTimes(1)
    expect(d.checkCap).toHaveBeenCalledTimes(2)
  })
})

describe('the daily cap', () => {
  it('a reached cap stops the call before the model', async () => {
    const { d } = deps({ checkCap: vi.fn(async () => ({ allowed: false, message: 'limit', resetsAt: new Date('2027-01-11T00:00:00Z'), upgradePath: '/pricing' })) })
    const r = await generateSeasonRecapWriteup(args(), d)
    expect(r).toEqual({ ok: false, error: 'daily_cap', message: 'limit', resetsAt: '2027-01-11T00:00:00.000Z', upgradePath: '/pricing' })
    expect(d.write).not.toHaveBeenCalled()
    expect(d.countCall).not.toHaveBeenCalled()
  })
})

describe('the page view', () => {
  it('a member reads the stored recap but is offered nothing to write or buy', async () => {
    const { d } = deps()
    await generateSeasonRecapWriteup(args(), d)
    const v = await seasonRecapWriteupView(RECAP_LEAGUE_ID, RECAP_SEASON, recap, MEMBER, 'en', d)
    expect(v).toMatchObject({ isCommissioner: false, entitled: false, upgradePath: null, writeup: { headline: GOOD.headline } })
  })

  it('a commissioner without the plan gets the upsell path', async () => {
    const { d } = deps({ entitled: vi.fn(async () => false) })
    const v = await seasonRecapWriteupView(RECAP_LEAGUE_ID, RECAP_SEASON, recap, COMMISH, 'en', d)
    expect(v).toEqual({ writeup: null, isCommissioner: true, entitled: false, upgradePath: '/pricing?from=season-recap' })
  })
})

describe('the facts', () => {
  it('carry the recap and not its computedAt, so an on-the-spot recompute keeps the same hash', () => {
    const later = recapFixture({ computedAt: '2027-02-01T00:00:00.000Z' })
    expect(seasonRecapFactsHash(buildSeasonRecapFacts(later, LEAGUE_NAME))).toBe(HASH)
    expect(facts).toEqual(expect.arrayContaining([
      { key: 'championTeam', value: 'Bears' },
      { key: 'highestWeekPoints', value: 150.3 },
      { key: 'bestTradeNetValue', value: 300 },
      { key: 'bestPickupPlayer', value: 'Jordan Reed' },
    ]))
  })
})
