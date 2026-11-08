// @vitest-environment jsdom
/**
 * Draft HQ for a league whose draft ran on the platform (most Sleeper redraft leagues) is the archive
 * alone. Live /core on 2026-11-05 showed it with no title, opening on the source draft id, UTC start
 * and end times and active-OTC durations. Now the archive carries the Draft HQ title and a one-line
 * summary, and the provenance folds into a closed "Timing and source details" section.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('says each thing once: no repeated draft heading, no lone "Page 1", a singular record count', () => {
    render(<DraftArchive {...props} detail={detail()} asDraftHq />)
    expect(document.querySelectorAll('h3')).toHaveLength(3) // Selections and ownership, Draft analysis, Records from this draft — not the draft line again
    expect([...document.querySelectorAll('h3')].some(h => h.textContent?.startsWith('2026 · NFL'))).toBe(false)
    expect(screen.queryByRole('navigation', { name: 'Archive pages' })).toBeNull()
    expect(screen.getByText('1 draft record')).toBeTruthy()
  })

  it('keeps the page nav when there is somewhere to go', () => {
    render(<DraftArchive {...props} detail={detail()} asDraftHq more total={30} />)
    expect(screen.getByRole('navigation', { name: 'Archive pages' }).textContent).toContain('Page 1')
    expect(screen.getByText('30 draft records')).toBeTruthy()
  })

  it('names drafts in the picker without the provider id, unless two would read the same', () => {
    const c = (key: string, sourceId: string, season = 2026) => ({ key, leagueId: 'L1', leagueName: 'L', source: 'imported', sourceId, season, sport: 'NFL', format: 'snake', status: 'complete' })
    render(<DraftArchive {...props} detail={detail()} choices={[c('imported:139', '1391441779609317376'), c('imported:2025', '1180000000000004242', 2025)] as never} asDraftHq />)
    expect([...screen.getByRole('combobox', { name: 'Select draft' }).querySelectorAll('option')].map(o => o.textContent)).toEqual(['Choose a draft', '2026 · snake · complete', '2025 · snake · complete'])
    cleanup()
    render(<DraftArchive {...props} detail={detail()} choices={[c('imported:139', '1391441779609317376'), c('imported:140', '1400000000000009999')] as never} asDraftHq />)
    expect([...screen.getByRole('combobox', { name: 'Select draft' }).querySelectorAll('option')].map(o => o.textContent)).toEqual(['Choose a draft', '2026 · snake · complete · …7376', '2026 · snake · complete · …9999'])
  })

  it('never prints a raw provider user id under Selected by', () => {
    const d = detail()
    ;(d.picks[0] as { actor: string | null }).actor = '100561289762'
    ;(d.picks[1] as { actor: string | null; actorName?: string | null }).actor = 'u2'
    ;(d.picks[1] as { actorName?: string | null }).actorName = 'GuapCiege'
    render(<DraftArchive {...props} detail={d} asDraftHq />)
    expect(document.querySelector('.af-archive-table')?.textContent).not.toContain('100561289762')
    expect(document.querySelector('.af-archive-table')?.textContent).toContain('GuapCiege')
  })

  const picksTable = () => screen.getByRole('region', { name: 'Archived picks' })
  const heads = () => [...picksTable().querySelectorAll('th')].map(th => th.textContent)
  const cellsPerRow = () => [...picksTable().querySelectorAll('tbody tr')].map(tr => tr.querySelectorAll('td').length)

  it('drops every column the draft has no data for, and says so', () => {
    // Live /core 2026-11-06: an imported Sleeper draft read "—" in four columns on all 168 rows.
    const d = detail()
    d.picks.forEach((p, i) => Object.assign(p, { slot: i + 1, actorName: 'Manager ' + i, source: 'sleeper' }))
    render(<DraftArchive {...props} detail={d} asDraftHq />)
    expect(heads()).toEqual(['Pick', 'Player', 'Receiving team', 'Original slot', 'Selected by'])
    expect(cellsPerRow()).toEqual([5, 5])
    expect((picksTable().querySelector('table') as HTMLElement).style.getPropertyValue('--af-cols')).toBe('5')
    expect(document.querySelector('.af-archive-cols-note')?.textContent).toContain('Timing and source details')
    expect(picksTable().textContent).not.toContain('— / sleeper')
  })

  it('keeps a column when any one pick has a value, so a filter never makes it flicker', () => {
    const d = detail()
    Object.assign(d.picks[1], { slot: 2, originalRosterId: 'r1', originalTeamName: 'Club 1', actorName: 'M', selectedAt: '2026-08-30T01:01:00.000Z', elapsedMs: 30_000, activeMs: 25_000, allowanceSeconds: 90, amount: 12, adp: 1.5, adpDifference: 0.5 })
    render(<DraftArchive {...props} detail={d} asDraftHq />)
    expect(heads()).toHaveLength(9)
    expect(cellsPerRow()).toEqual([9, 9])
    expect(heads()).toContain('Original slot / owner')
    expect(document.querySelector('.af-archive-cols-note')).toBeNull()
  })

  it('shows pick timing behind one switch for the whole table, not a drawer on every row', () => {
    // Live /core 2026-11-06: 25 "Identity and owner time" drawers nearly doubled the table's height on a phone.
    const d = detail()
    Object.assign(d.picks[0], { playerId: '4034', identityBasis: 'Recorded at selection' })
    render(<DraftArchive {...props} detail={d} asDraftHq />)
    expect(picksTable().querySelectorAll('details')).toHaveLength(0)
    expect(picksTable().textContent).not.toContain('Recorded at selection')
    const toggle = screen.getByRole('button', { name: 'Show pick details' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide pick details' }).getAttribute('aria-pressed')).toBe('true')
    expect(picksTable().textContent).toContain('4034 · Recorded at selection')
  })

  it('groups the history drawers in one records card, with no lone timeline page', () => {
    render(<DraftArchive {...props} detail={detail()} asDraftHq />)
    const card = screen.getByRole('region', { name: 'Records from this draft' })
    expect(card.querySelectorAll('details').length).toBe(5)
    expect(screen.queryByRole('navigation', { name: 'Timeline pages' })).toBeNull()
  })

  it('reads Spanish', () => {
    h.language = 'es'
    render(<DraftArchive {...props} detail={detail()} asDraftHq />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Centro del draft')
    expect(document.querySelector('details.af-archive-tech summary')?.textContent).toBe('Detalles de horario y origen')
  })
})
