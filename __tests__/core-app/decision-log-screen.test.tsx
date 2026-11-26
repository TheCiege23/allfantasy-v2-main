import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /core/decisions (2026-11-26): each row's TRADE GRADE and OUTCOME grade, each labelled; a withheld
 * grade says "not graded" with the reason; a row logged before the stamp says "not recorded" and never
 * shows its stale `aiRecommendation.grade`; the type and league filters; the empty, error and locked states.
 */

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useOptionalLanguage: () => ({ ...actual.defaultLanguageValue, language: lang.language }) }
})
// The CTA's trial-offer hooks are not under test; keep its href and the lock attribution visible.
vi.mock('@/components/core-app/CoreDepthLockCta', () => ({
  CoreDepthLockCta: ({ href, source, children }: { href: string; source: string; children: React.ReactNode }) => (
    <a href={href} data-source={source} data-testid="lock-cta">{children}</a>
  ),
}))

import { DecisionLogScreen, type DecisionLogLoader } from '@/components/core-app/screens/DecisionLogScreen'
import { EMPTY_SUMMARY, SAMPLE_DECISIONS, SAMPLE_LEAGUE_NAMES, SAMPLE_SUMMARY } from '@/app/e2e/decisions/fixtures'

const ready: DecisionLogLoader = async (leagueId) => ({
  ok: true,
  data: { decisions: leagueId ? SAMPLE_DECISIONS.filter((d) => d.leagueId === leagueId) : SAMPLE_DECISIONS, summary: SAMPLE_SUMMARY },
})

const rowFor = (headline: string) => {
  const row = screen.getByText(headline).closest('[data-testid="decision-row"]')
  if (!row) throw new Error(`no row for ${headline}`)
  return within(row as HTMLElement)
}

beforeEach(() => {
  lang.language = 'en'
})
afterEach(cleanup)

describe('each decision, its trade grade and its outcome — labelled apart', () => {
  it('a graded trade reads "Trade grade B+" beside "Outcome after 4 weeks: A"', async () => {
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    await screen.findByTestId('decision-list')
    const r = rowFor('Trade: accept')
    expect(r.getByTestId('decision-trade-grade').textContent).toBe('Trade grade B+')
    expect(r.getByTestId('decision-outcome-grade').textContent).toBe('Outcome after 4 weeks: A')
    expect(r.getByText('Sample Dynasty League')).toBeTruthy()
    expect(r.getByText('Trade')).toBeTruthy()
    expect(r.getByText('You followed it')).toBeTruthy()
  })

  it('a withheld grade says "not graded" and why, and the outcome is awaiting', async () => {
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    await screen.findByTestId('decision-list')
    const r = rowFor('Trade: analyzed')
    expect(r.getByTestId('decision-trade-grade').textContent).toBe('Trade grade: not graded')
    expect(r.getByTestId('decision-trade-withheld').textContent).toBe('Not graded: only two-team trades are graded')
    expect(r.getByTestId('decision-outcome-grade').textContent).toBe('Outcome: awaiting')
  })

  it('🛑 a trade logged before the stamp says "not recorded" — its stale aiRecommendation.grade "D" is never shown', async () => {
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    await screen.findByTestId('decision-list')
    const r = rowFor('Trade: decline')
    expect(r.getByTestId('decision-trade-grade').textContent).toBe('Trade grade: not recorded')
    expect(r.queryByText(/\bD\b/)).toBeNull()
    expect(r.getByTestId('decision-outcome-grade').textContent).toBe('Outcome after 3 weeks: B')
  })

  it('a waiver or a proposal run carries no trade grade at all, only its outcome', async () => {
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    await screen.findByTestId('decision-list')
    const waiver = rowFor('Waiver: 6 suggestions (contend team)')
    expect(waiver.queryByTestId('decision-trade-grade')).toBeNull()
    expect(waiver.getByText('Sample Running Back')).toBeTruthy()
    expect(waiver.getByTestId('decision-outcome-grade').textContent).toBe('Outcome after 3 weeks: C')
    expect(rowFor('Trade Proposals: 3 generated').queryByTestId('decision-trade-grade')).toBeNull()
  })

  it('the summary: trade grade coverage and the outcome record', async () => {
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    const summary = await screen.findByTestId('decision-summary')
    expect(within(summary).getByTestId('decision-summary-coverage').textContent).toBe('1of 4 trades carry a trade grade')
    const record = within(summary).getByTestId('decision-outcome-record').textContent ?? ''
    expect(record).toContain('A ×1')
    expect(record).toContain('B ×1')
    expect(record).toContain('C ×1')
  })

  it('Spanish copy, labels included', async () => {
    lang.language = 'es'
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    await screen.findByTestId('decision-list')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mis decisiones')
    const r = rowFor('Trade: accept')
    expect(r.getByTestId('decision-trade-grade').textContent).toBe('Calificación del intercambio: B+')
    expect(r.getByTestId('decision-outcome-grade').textContent).toBe('Resultado tras 4 semanas: A')
  })
})

describe('filters', () => {
  it('by type: only the waiver row is left', async () => {
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={ready} />)
    await screen.findByTestId('decision-list')
    expect(screen.getAllByTestId('decision-row')).toHaveLength(5)
    fireEvent.change(screen.getByTestId('decision-filter-type'), { target: { value: 'waiver' } })
    const rows = screen.getAllByTestId('decision-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('data-type')).toBe('waiver')
  })

  it('by league: the route is asked for that league (so the summary is that league’s), and names come from the map', async () => {
    const load = vi.fn(ready)
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={load} />)
    await screen.findByTestId('decision-list')
    const select = screen.getByTestId('decision-filter-league') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['All leagues', 'Sample Dynasty League', 'Sample Redraft League'])
    await act(async () => {
      fireEvent.change(select, { target: { value: 'sample-sleeper-league-2' } })
    })
    await waitFor(() => expect(screen.getAllByTestId('decision-row')).toHaveLength(2))
    expect(load).toHaveBeenLastCalledWith('sample-sleeper-league-2')
    // The league options survive the narrower read.
    expect((screen.getByTestId('decision-filter-league') as HTMLSelectElement).options).toHaveLength(3)
  })

  it('starts on the held league when the page passes one', async () => {
    const load = vi.fn(ready)
    render(<DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={load} initialLeagueId="sample-sleeper-league-1" />)
    await screen.findByTestId('decision-list')
    expect(load).toHaveBeenCalledWith('sample-sleeper-league-1')
    expect(screen.getAllByTestId('decision-row')).toHaveLength(3)
  })
})

describe('loading, empty, error and locked', () => {
  it('loading shows the skeleton', () => {
    render(<DecisionLogScreen leagueNames={{}} load={() => new Promise(() => {})} />)
    expect(screen.getByTestId('decision-log-loading')).toBeTruthy()
  })

  it('empty: says how decisions get here, and draws no summary', async () => {
    render(<DecisionLogScreen leagueNames={{}} load={async () => ({ ok: true, data: { decisions: [], summary: EMPTY_SUMMARY } })} />)
    const empty = await screen.findByTestId('decision-log-empty')
    expect(empty.textContent).toContain('No decisions logged yet')
    expect(screen.queryByTestId('decision-summary')).toBeNull()
  })

  it('error: a read failure, never an empty history, with a retry that reads again', async () => {
    const load = vi.fn<DecisionLogLoader>(async () => ({ ok: false, locked: false }))
    render(<DecisionLogScreen leagueNames={{}} load={load} />)
    const err = await screen.findByTestId('decision-log-error')
    expect(err.textContent).toContain('not an empty history')
    load.mockImplementation(ready)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    await screen.findByTestId('decision-list')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('🛑 locked (the server paywall read): the AF Pro lock with its attribution, and NOTHING is fetched', async () => {
    const load = vi.fn(ready)
    render(<DecisionLogScreen leagueNames={{}} load={load} locked />)
    const lock = screen.getByTestId('core-lock-decision_history')
    expect(lock.textContent).toContain('Your decision history is part of AF Pro')
    const cta = screen.getByTestId('lock-cta')
    expect(cta.getAttribute('href')).toBe('/upgrade?plan=pro')
    expect(cta.getAttribute('data-source')).toBe('lock_decision_history')
    expect(screen.queryByTestId('decision-filter-type')).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(load).not.toHaveBeenCalled()
  })

  it('the route’s own 403 draws the same lock', async () => {
    render(<DecisionLogScreen leagueNames={{}} load={async () => ({ ok: false, locked: true })} />)
    expect(await screen.findByTestId('core-lock-decision_history')).toBeTruthy()
    expect(screen.queryByTestId('decision-list')).toBeNull()
  })
})
