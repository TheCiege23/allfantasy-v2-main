import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The saved-recommendations stub is RETIRED (Chimmy follow-up, user decision 2026-09-16: "wire up or
 * retire"). `lib/saved-recommendations/SavedRecommendationsService.ts` was a Supabase-era service with
 * no database behind it — list always empty, save always 500, every lookup 404 — and nothing mounted
 * anywhere ever saved one. These pin what replaced it.
 */

const h = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
  feedbackFindMany: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('@/lib/prisma', () => ({ prisma: { aIUserFeedback: { findMany: h.feedbackFindMany } } }))

import AISavedPage from '@/app/ai/saved/page'
import { getChimmyQualityMetrics } from '@/lib/chimmy-quality/ChimmyQualityAnalytics'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/ai/saved', () => {
  it('sends old links to where saved AI results actually live', () => {
    expect(() => AISavedPage()).toThrow('REDIRECT:/ai/history')
    expect(h.redirect).toHaveBeenCalledWith('/ai/history')
  })
})

describe('Chimmy quality metrics', () => {
  it('reports saved-recommendation lifecycle as NOT TRACKED, never as zero', async () => {
    h.feedbackFindMany.mockResolvedValue([
      { actionType: 'chimmy_quality_memory_item_created' },
      { actionType: 'chimmy_quality_memory_item_created' },
      { actionType: 'chimmy_quality_memory_item_corrected' },
    ])
    const m = await getChimmyQualityMetrics({ userId: 'u1', periodDays: 7 })
    expect(m.lifecycle).toEqual({
      savedRecommendationsTotal: null,
      savedRecommendationsStale: null,
      savedRecommendationsActedOn: null,
    })
    expect(m.rates.staleRecommendationRate).toBeNull()
    expect(m.rates.recommendationFollowThroughRate).toBeNull()
    // The tracked parts still work.
    expect(m.counts.memory_item_created).toBe(2)
    expect(m.rates.memoryCorrectionOrIgnoreRate).toBe(0.5)
    expect(h.feedbackFindMany).toHaveBeenCalledTimes(1)
  })
})

/*
 * A census, because every piece removed here was reachable only through imports and links: if any
 * of them comes back, it comes back pointing at routes that no longer exist.
 */
describe('nothing still reaches the retired pieces', () => {
  const root = process.cwd()
  const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'playwright-report', 'test-results'])
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name) || name.startsWith('.next')) continue
      const full = path.join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(name)) files.push(full)
    }
  }
  for (const dir of ['app', 'components', 'lib', 'hooks']) {
    try {
      walk(path.join(root, dir))
    } catch {
      /* a missing top-level dir is fine */
    }
  }

  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/')

  it('found files to scan (the census is not empty)', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(files.map(rel)).toContain('app/ai/history/page.tsx')
  })

  it('no module imports the retired service, hook or components', () => {
    const retired = /saved-recommendations\/(?:SavedRecommendationsService|useSavedRecommendations)|\/(?:SaveRecommendationButton|SavedRecommendationsPanel|SavedRecommendationDetailModal)['"]/
    const hits = files.filter((f) => retired.test(readFileSync(f, 'utf8'))).map(rel)
    expect(hits).toEqual([])
  })

  /*
   * 🛑 A PROP IS NOT AN IMPORT. Three surfaces still passed `savePayload={{…}}` to a card whose prop
   * was removed; the import census above read clean and only the CI typecheck caught it — and tests
   * are never typechecked here, so nothing in this suite could have.
   */
  it('no component still passes the retired save payload', () => {
    const hits = files.filter((f) => /\bsavePayload=\{/.test(readFileSync(f, 'utf8'))).map(rel)
    expect(hits).toEqual([])
  })

  it('no code calls the retired API or links to the retired page', () => {
    const hits = files
      .filter((f) => rel(f) !== 'app/ai/saved/page.tsx')
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return /['"`]\/api\/ai\/saved-recommendations/.test(src) || /href=["'{`]*\/ai\/saved["'`}]/.test(src)
      })
      .map(rel)
    expect(hits).toEqual([])
  })
})
