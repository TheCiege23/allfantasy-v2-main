// @vitest-environment jsdom
/**
 * Draft HQ's archived records, readable (2026-10-07). The five record sections printed
 * `JSON.stringify(data, null, 2)` — on a live dynasty league a 4,900-character dump of raw Sleeper
 * settings (`slots_bn`, `autopause_enabled`…) and a bare `[]` for each empty section. These render the
 * record view with the loader's real shapes (the provider snapshot below is the live league's own
 * settings, abridged) and assert: no JSON, labelled rows in both languages, formatted timers and
 * times, the lineup slots on one row, every field still present, and "None recorded" for empty.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: h.language }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }) }))
vi.mock('@/components/core-app/screens/DraftHistoryReview', () => ({ DraftHistoryReview: () => null }))
vi.mock('@/components/core-app/screens/DraftResultsRefresh', () => ({ DraftResultsRefresh: () => null }))

import { DraftRecordView } from '@/components/core-app/screens/DraftRecordView'
import { DraftArchive } from '@/components/core-app/screens/DraftArchive'
import { formatRecordValue, formatSeconds, recordLabel } from '@/lib/draft-archive/recordLabels'
import type { ArchiveDetail } from '@/lib/draft-archive/detail'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

// The imported (provider) snapshot shape from lib/draft-archive/detail.ts, values from the live league.
const PROVIDER_SNAPSHOT = {
  format: 'linear',
  status: 'complete',
  sport: 'nfl',
  name: 'Dynasty for life!',
  draftSettings: {
    teams: 12,
    rounds: 4,
    slots_bn: 14,
    slots_qb: 1,
    slots_rb: 2,
    slots_te: 1,
    slots_wr: 2,
    slots_flex: 3,
    slots_super_flex: 1,
    slots_k: 0,
    pick_timer: 86400,
    cpu_autopick: 1,
    autopause_enabled: 0,
    reversal_round: 0,
    nomination_timer: 60,
    player_type: 1,
  },
  tradedPicks: [{ season: '2027', round: 1, rosterId: 3, previousOwnerId: 3, ownerId: 7 }],
  startTime: 1756580700000,
  lastPickedTime: 1756660000000,
  teams: [{ rosterId: 1, teamName: 'Club Uno' }],
}
const NATIVE_EVENTS = [
  { id: 'e1', at: '2026-08-30T19:05:12.000Z', event: 'selection', clock: 'running', allowanceSeconds: 90, selection: { overall: 1, playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' } },
]
const PROVIDER_TRADES = [{ transactionId: '1406727505955532800:9', season: 2026, week: 2, adds: null, drops: null, draftPicks: [], rosterIds: [3, 7] }]

const text = (language: 'en' | 'es', value: unknown) => {
  h.language = language
  const { container } = render(<DraftRecordView value={value} language={language} />)
  return { container, t: container.textContent ?? '' }
}

describe('DraftRecordView — readable, lossless, both languages', () => {
  it('the provider snapshot reads as labelled rows, not JSON', () => {
    const { container, t } = text('en', PROVIDER_SNAPSHOT)
    expect(container.querySelector('pre')).toBeNull()
    expect(t).not.toMatch(/[{}"]|\[\s*\]/)
    for (const s of [
      'Draft settings',
      'Lineup slots',
      // Lineup order, bench last — the provider stores them bench-first.
      'QB 1 · RB 2 · WR 2 · TE 1 · FLEX 3 · SUPER FLEX 1 · BN 14',
      'Pick timer',
      '24 h',
      'Auto-pick for an absent manager',
      'Yes',
      'Overnight auto-pause',
      'Nomination timer',
      '1 min',
      'Traded picks',
      'Previous owner',
      'Started',
      '2025-08-30 19:05 UTC',
      'Club Uno',
    ]) {
      expect(t, s).toContain(s)
    }
    // A slot of zero is not a slot.
    expect(t).not.toMatch(/\bK 0\b/)
  })

  it('reads Spanish', () => {
    const { t } = text('es', PROVIDER_SNAPSHOT)
    for (const s of ['Configuración del draft', 'Puestos de la alineación', 'Tiempo por selección', 'Selección automática si el mánager no está', 'Sí', 'Selecciones intercambiadas', 'Dueño anterior', 'Inicio']) {
      expect(t, s).toContain(s)
    }
    expect(t).not.toMatch(/Draft settings|Pick timer|Lineup slots/)
  })

  it('native clock events and provider trade packages', () => {
    const ev = text('en', NATIVE_EVENTS).t
    for (const s of ['Time', '2026-08-30 19:05 UTC', 'Event', 'selection', 'Time allowed', '1 min 30 s', 'Overall pick', 'Bijan Robinson']) expect(ev, s).toContain(s)
    cleanup()
    const tr = text('en', PROVIDER_TRADES).t
    for (const s of ['Transaction', '1406727505955532800:9', 'Week', '2', 'Teams involved', '3, 7', 'Draft picks', 'None recorded']) expect(tr, s).toContain(s)
  })

  it('an empty section says so, in both languages', () => {
    expect(text('en', []).t).toBe('None recorded')
    cleanup()
    expect(text('es', []).t).toBe('No hay registros')
  })

  it('an unknown field is still shown, under a tidied version of its own name', () => {
    const { t } = text('en', { someNewProviderField: 'kept', other_snake_case: 3 })
    expect(t).toContain('Some new provider field')
    expect(t).toContain('kept')
    expect(t).toContain('Other snake case')
  })
})

describe('the helpers', () => {
  it('format timers, switches and times', () => {
    expect(formatSeconds(86400)).toBe('24 h')
    expect(formatSeconds(5400)).toBe('1 h 30 min')
    expect(formatSeconds(45)).toBe('45 s')
    expect(formatRecordValue('cpu_autopick', 0, 'es')).toBe('No')
    expect(formatRecordValue('startTime', 1756580700000, 'en')).toBe('2025-08-30 19:05 UTC')
    expect(formatRecordValue('status', 'complete', 'en')).toBe('complete')
    expect(recordLabel('pick_timer', 'es')).toBe('Tiempo por selección')
  })
})

describe('DraftArchive — the five sections no longer print JSON', () => {
  it('renders every record section without a <pre> or a brace', () => {
    const detail = {
      choice: { key: 'k', leagueId: 'L1', season: 2025, sport: 'NFL', format: 'linear', status: 'complete', sourceId: 'd1' },
      canReconcile: false,
      canRefreshResults: false,
      startedAt: null,
      endedAt: null,
      endMeaning: 'Completed at',
      elapsedMs: null,
      activeMs: null,
      coverage: [],
      picks: [],
      references: null,
      analysisReport: null,
      resultsReport: null,
      analysis: null,
      snapshot: PROVIDER_SNAPSHOT,
      events: [],
      corrections: [],
      trades: PROVIDER_TRADES,
      playerTrades: [],
      phase4: { components: [], scores: [], calibration: null, dynasty: [], replay: { state: 'unavailable', players: [], picks: [] }, lineage: { state: 'partial', lineages: [], pending: [] }, contributions: [] },
    } as unknown as ArchiveDetail
    const { container } = render(<DraftArchive choices={[]} detail={detail} leagueId="L1" page={1} more={false} total={1} />)
    const sections = [...container.querySelectorAll('details')].filter((d) => d.querySelector(':scope > .af-record'))
    expect(sections.length, 'all five record sections render through the view').toBe(5)
    for (const d of sections) {
      expect(d.querySelector('pre')).toBeNull()
      expect(d.querySelector(':scope > .af-record')!.textContent).not.toMatch(/[{}"]/)
    }
  })
})
