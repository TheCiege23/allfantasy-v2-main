// @vitest-environment jsdom
/**
 * Draft HQ duplicated its analysis on every server refresh (live, 2026-10-06): one language switch —
 * which calls `router.refresh()` — turned one "Draft decisions and replay" section into five. The
 * original stayed in the old language, four copies were appended, and only the last answered clicks.
 *
 * Cause: three siblings in DraftArchive's detail fragment — DraftHistoryReview, DraftPhase4 and
 * DraftResultsRefresh — all carried `key={detail.choice.key}`. React requires sibling keys to be
 * unique; with duplicates it warns (in development only) that children "may be duplicated and/or
 * omitted", and a refresh re-renders exactly that fragment.
 *
 * This re-renders the archive the way a refresh does — same draft, a fresh `detail` object, a
 * language change — and asserts exactly one of each section after every render.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: h.language }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }) }))
// The two siblings that fetch on mount render as markers; their keys are what matter here.
vi.mock('@/components/core-app/screens/DraftHistoryReview', () => ({ DraftHistoryReview: () => <div data-testid="history-review" /> }))
vi.mock('@/components/core-app/screens/DraftResultsRefresh', () => ({ DraftResultsRefresh: () => <div data-testid="results-refresh" /> }))

import { DraftArchive } from '@/components/core-app/screens/DraftArchive'
import type { ArchiveDetail } from '@/lib/draft-archive/detail'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

/** A fresh object every call — what a server refresh hands the client for the same draft. */
const detail = () =>
  ({
    choice: { key: 'native:d1', leagueId: 'L1', season: 2026, sport: 'NFL', format: 'snake', status: 'complete', sourceId: 'd1' },
    canReconcile: true,
    canRefreshResults: true,
    resultsObservedAt: null,
    startedAt: null,
    endedAt: null,
    endMeaning: 'Completed at',
    elapsedMs: null,
    activeMs: null,
    coverage: [],
    picks: [{ id: 'a', overall: 1, round: 1, playerName: 'First Pick', rosterId: 'r1', teamName: 'Club 1' }],
    references: null,
    analysisReport: null,
    resultsReport: null,
    analysis: null,
    snapshot: null,
    events: [],
    corrections: [],
    trades: [],
    playerTrades: [],
    phase4: {
      components: [],
      scores: [],
      calibration: null,
      dynasty: [],
      replay: { state: 'unavailable', players: [], picks: [] },
      lineage: { state: 'partial', lineages: [], pending: [] },
      contributions: [],
    },
  }) as unknown as ArchiveDetail

const props = () => ({ choices: [], detail: detail(), leagueId: 'L1', page: 1, more: false, total: 1 })

const counts = (c: HTMLElement) => ({
  phase4: c.querySelectorAll('nav.af-phase4-tabs').length > 0 ? new Set([...c.querySelectorAll('nav.af-phase4-tabs')].map((n) => n.closest('section'))).size : 0,
  review: c.querySelectorAll('[data-testid="history-review"]').length,
  refresh: c.querySelectorAll('[data-testid="results-refresh"]').length,
})

describe('Draft archive — a refresh re-renders, it does not append', () => {
  it('stays one of each across refreshes and a language switch', () => {
    const r = render(<DraftArchive {...props()} />)
    const first = counts(r.container)
    expect(first.phase4, 'the fixture must draw the analysis at all, or this asserts nothing').toBe(1)
    expect(first).toEqual({ phase4: 1, review: 1, refresh: 1 })

    // A refresh: same draft, new detail object.
    r.rerender(<DraftArchive {...props()} />)
    expect(counts(r.container)).toEqual({ phase4: 1, review: 1, refresh: 1 })

    // The language switch that exposed it live: new language, then the refresh it triggers.
    h.language = 'es'
    r.rerender(<DraftArchive {...props()} />)
    r.rerender(<DraftArchive {...props()} />)
    expect(counts(r.container)).toEqual({ phase4: 1, review: 1, refresh: 1 })
  })

  it('🛑 no two siblings in the detail fragment share a key', async () => {
    // A source pin, because the runtime symptom depends on React's reconciliation order and a future
    // React could stop showing it while the duplicate keys remain.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('components/core-app/screens/DraftArchive.tsx', 'utf8')
    const keys = [...src.matchAll(/key=\{([^}]+)\}/g)].map((m) => m[1]!.replace(/\s+/g, ''))
    const shared = keys.filter((k, i) => keys.indexOf(k) !== i && k === 'detail.choice.key')
    expect(shared).toEqual([])
  })
})
