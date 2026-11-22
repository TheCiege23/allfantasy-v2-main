/**
 * Playoff series copy and UI, in both languages.
 *
 *  - Every `lsHub.po.series*` / `playoffSeries.*` key is in EN and ES with the same placeholders, and the
 *    Spanish never says "waiver" (it is «reclamo»), and no label is a bare "AI".
 *  - The settings card: one select per round, series off by default; a non-subscriber sees the upsell
 *    with the longer options locked, but a series already saved stays selectable (a lapsed plan keeps it).
 *  - The bracket line and the matchup strip print the series record in the viewer's language.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})

import { PlayoffSeriesLengthsCard, seriesLengthsPatchValue } from '@/components/league-settings/PlayoffSeriesLengthsCard'
import { PlayoffSeriesLine, PlayoffSeriesStrip } from '@/components/league/PlayoffSeriesStrip'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

const KEYS = Object.keys(translations.en).filter((k) => k.startsWith('lsHub.po.series') || k.startsWith('playoffSeries.'))
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((x) => x[1]).sort()

describe('series copy', () => {
  it('has the keys the UI uses', () => {
    expect(KEYS).toEqual(expect.arrayContaining(['lsHub.po.series', 'lsHub.po.seriesPlan', 'playoffSeries.won', 'playoffSeries.leads', 'playoffSeries.tied']))
  })

  it.each(KEYS)('%s: Spanish exists with the same placeholders, says no "waiver" and no bare "AI"', (key) => {
    const en = translations.en[key]
    const es = translations.es[key]
    expect(es, key).toBeTruthy()
    // Translated, not copied — "Final" is the one word that is the same in both.
    if (key !== 'lsHub.po.seriesFinal') expect(es).not.toBe(en)
    expect(placeholders(es)).toEqual(placeholders(en))
    expect(es.toLowerCase()).not.toContain('waiver')
    expect(en).not.toMatch(/\bAI\b/)
    expect(es).not.toMatch(/\bAI\b|\bIA\b/)
  })
})

const series3 = (homeWins: number, awayWins: number, winner: string | null = null) => ({
  series: { bestOf: 3, homeWins, awayWins, winnerRosterId: winner, clinchedWeek: null, games: [] },
})
const names: Record<string, string> = { a: 'Lakers', b: 'Celtics' }
const nameOf = (id: string | null) => (id ? names[id] ?? id : '')

describe('settings card', () => {
  const base = {
    leagueId: 'L-series-card', settings: {}, playoffTeams: 4, playoffStartWeek: 15, seasonWeeks: 25, canEdit: true,
  }

  it('one select per round, single weeks by default; choosing best-of-5 saves the per-round list', () => {
    const queuePatch = vi.fn()
    const r = render(<PlayoffSeriesLengthsCard {...base} hasPlan queuePatch={queuePatch} />)
    const round1 = r.getByTestId('playoff-series-round-1') as HTMLSelectElement
    const final = r.getByTestId('playoff-series-round-2') as HTMLSelectElement
    expect(round1.value).toBe('1')
    expect(r.getByText('Final')).toBeTruthy()
    fireEvent.change(final, { target: { value: '5' } })
    expect(queuePatch).toHaveBeenLastCalledWith({ playoffSeriesLengths: [1, 5] })
    expect(r.getByTestId('playoff-series-window').textContent).toContain('weeks 15 to 20')
    expect(r.queryByTestId('playoff-series-upsell')).toBeNull()
  })

  it('without the plan: upsell, longer options locked, a saved series still selectable', () => {
    const r = render(
      <PlayoffSeriesLengthsCard
        {...base}
        settings={{ playoff_series: { mode: 'series', lengths: [3, 1] } }}
        hasPlan={false}
        queuePatch={vi.fn()}
      />,
    )
    expect(r.getByTestId('playoff-series-upsell').textContent).toContain('AF Commissioner')
    const opts = (id: string) =>
      Array.from((r.getByTestId(id) as HTMLSelectElement).options).map((o) => [o.value, o.disabled])
    expect(opts('playoff-series-round-1')).toEqual([['1', false], ['3', false], ['5', true], ['7', true]])
    expect(opts('playoff-series-round-2')).toEqual([['1', false], ['3', true], ['5', true], ['7', true]])
  })

  it('warns when the series would end after the season', () => {
    const r = render(
      <PlayoffSeriesLengthsCard {...base} settings={{ playoff_series: { mode: 'series', lengths: [7] } }} hasPlan queuePatch={vi.fn()} />,
    )
    expect(r.getByTestId('playoff-series-window').textContent).toContain('week 28')
  })

  it('in Spanish', () => {
    lang.language = 'es'
    const r = render(<PlayoffSeriesLengthsCard {...base} hasPlan={false} queuePatch={vi.fn()} />)
    expect(r.getByText('Series de playoffs')).toBeTruthy()
    expect(r.getAllByText('Al mejor de 5').length).toBeGreaterThan(0)
    expect(r.getByTestId('playoff-series-upsell').textContent).toContain('plan AF Commissioner')
  })

  it('all single weeks saves null (series off)', () => {
    expect(seriesLengthsPatchValue([1, 1])).toBeNull()
    expect(seriesLengthsPatchValue([1, 3])).toEqual([1, 3])
  })
})

describe('bracket line and matchup strip', () => {
  const matchup = (metadata: Record<string, unknown>) => ({ roundNumber: 1, homeRosterId: 'a', awayRosterId: 'b', metadata })

  it('the bracket line: leader, tie, winner — and nothing for a single-week round', () => {
    const line = (meta: Record<string, unknown>, lengths: number[] | null = [3]) =>
      render(<PlayoffSeriesLine seriesLengths={lengths} matchup={matchup(meta)} nameOf={nameOf} />).container.textContent
    expect(line(series3(1, 0))).toBe('Best of 3 · first to 2 wins — Lakers leads the series 1–0')
    cleanup()
    expect(line(series3(1, 1))).toContain('Series tied 1–1')
    cleanup()
    expect(line(series3(0, 2, 'b'))).toContain('Celtics wins the series 2–0')
    cleanup()
    expect(line({}, null)).toBe('')
  })

  it('the bracket line in Spanish', () => {
    lang.language = 'es'
    const text = render(<PlayoffSeriesLine seriesLengths={[3]} matchup={matchup(series3(0, 2, 'b'))} nameOf={nameOf} />).container.textContent
    expect(text).toBe('Al mejor de 3 · gana quien llegue primero a 2 — Celtics gana la serie 2–0')
  })

  it('the matchup strip shows the selected team\'s latest series', () => {
    const r = render(
      <PlayoffSeriesStrip
        seriesLengths={[3, 5]}
        rosterId="b"
        nameOf={nameOf}
        matchups={[
          { roundNumber: 1, homeRosterId: 'b', awayRosterId: 'x', metadata: series3(2, 0, 'b') },
          { roundNumber: 2, homeRosterId: 'a', awayRosterId: 'b', metadata: { series: { ...series3(1, 2).series, bestOf: 5 } } },
        ]}
      />,
    )
    const text = r.getByTestId('playoff-series-strip').textContent ?? ''
    expect(text).toContain('Lakers 1 – 2 Celtics')
    expect(text).toContain('Best of 5')
    expect(text).toContain('Celtics leads the series 2–1')
  })
})
