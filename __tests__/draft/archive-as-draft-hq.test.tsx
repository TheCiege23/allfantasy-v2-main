// @vitest-environment jsdom
/**
 * Draft HQ for a league whose draft ran on the platform (most Sleeper redraft leagues) is the archive
 * alone. Live /core on 2026-11-05 showed it with no title, opening on the source draft id, UTC start
 * and end times and active-OTC durations. Now the archive carries the Draft HQ title and a one-line
 * summary, and the provenance folds into a closed "Timing and source details" section.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: h.language }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }) }))
vi.mock('@/components/core-app/screens/DraftHistoryReview', () => ({ DraftHistoryReview: () => null }))
vi.mock('@/components/core-app/screens/DraftResultsRefresh', () => ({ DraftResultsRefresh: () => null }))

import { DraftArchive } from '@/components/core-app/screens/DraftArchive'
import type { ArchiveDetail } from '@/lib/draft-archive/detail'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const detail = () =>
  ({
    choice: { key: 'imported:139', leagueId: 'L1', season: 2026, sport: 'NFL', format: 'snake', status: 'complete', sourceId: '1391441779609317376' },
    canReconcile: false,
    canRefreshResults: false,
    resultsObservedAt: null,
    startedAt: '2026-08-30T01:00:03.000Z',
    endedAt: '2026-08-30T01:53:05.000Z',
    endMeaning: 'Provider last selection time',
    elapsedMs: 3_182_000,
    activeMs: null,
    coverage: ['Exact per-pick selection timestamps and active OTC were not supplied by this provider.'],
    picks: [
      { id: 'a', overall: 1, round: 1, playerName: 'First Pick', rosterId: 'r1', teamName: 'Club 1' },
      { id: 'b', overall: 2, round: 1, playerName: 'Second Pick', rosterId: 'r2', teamName: 'Club 2' },
    ],
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

const props = { choices: [], leagueId: 'L1', page: 1, more: false, total: 1 }

describe('the archive as Draft HQ', () => {
  it('carries the Draft HQ title and says which draft this is', () => {
    render(<DraftArchive {...props} detail={detail()} asDraftHq />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Draft HQ')
    expect(document.querySelector('.af-archive-hq-sub')?.textContent).toBe('2026 · NFL · snake · complete · 2 picks')
  })

  it('folds the source id, UTC clock and coverage notes into a closed details section', () => {
    render(<DraftArchive {...props} detail={detail()} asDraftHq />)
    const tech = document.querySelector('details.af-archive-tech') as HTMLDetailsElement
    expect(tech).not.toBeNull()
    expect(tech.open).toBe(false)
    expect(tech.querySelector('summary')?.textContent).toBe('Timing and source details')
    expect(tech.textContent).toContain('1391441779609317376')
    expect(tech.textContent).toContain('2026-08-30 01:00:03 UTC')
    expect(tech.textContent).toContain('Exact per-pick selection timestamps')
  })

  it('draws no title when it sits under the league’s own Draft HQ', () => {
    render(<DraftArchive {...props} detail={detail()} />)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(document.querySelector('details.af-archive-tech')).not.toBeNull()
  })

  it('reads Spanish', () => {
    h.language = 'es'
    render(<DraftArchive {...props} detail={detail()} asDraftHq />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Centro del draft')
    expect(document.querySelector('details.af-archive-tech summary')?.textContent).toBe('Detalles de horario y origen')
  })
})
