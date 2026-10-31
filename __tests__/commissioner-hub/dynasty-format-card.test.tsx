/** The dynasty format card on the Commissioner Hub (formatCards.ts, dynastyFormatFacts.ts, DynastyFormatCard.tsx). */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { commissionerFormatCards, dynastyFormatCard, type DynastyFormatFacts } from '@/lib/core-app/commissioner/formatCards'
import { toDynastyFormatFacts } from '@/lib/core-app/commissioner/dynastyFormatFacts'
import { DynastyFormatCard } from '@/components/core-app/commissioner/DynastyFormatCard'

const full: DynastyFormatFacts = {
  rosterSize: 26,
  taxiSlots: 4,
  devySlots: 6,
  rookieDraftRounds: 4,
  rookieDraftType: 'linear',
  futurePicksYearsOut: 3,
  rollover: { state: 'due', season: 2026 },
}
const none: DynastyFormatFacts = {
  rosterSize: null, taxiSlots: null, devySlots: null, rookieDraftRounds: null, rookieDraftType: null, futurePicksYearsOut: null, rollover: null,
}
const season = (over: Record<string, unknown>) =>
  ({ id: 's', season: 2026, status: 'active', createdAt: new Date('2026-09-01'), currentWeek: 5, playoffStartWeek: 15, totalWeeks: 17, ...over }) as never

describe('dynastyFormatCard', () => {
  it('summarises every saved dynasty setting and links each to its settings page', () => {
    const card = dynastyFormatCard('L 1', full)
    expect(card.key).toBe('dynasty')
    expect(card.tone).toBe('dynasty')
    expect(card.facts!.map((f) => [f.key, f.value])).toEqual([
      ['roster', '26 spots'],
      ['taxi', '4 slots'],
      ['devy', '6 slots'],
      ['rookie', '4 rounds · linear'],
      ['pick_years', '3 seasons out'],
      ['rollover', 'Due · the 2026 season is over'],
    ])
    expect(card.links!.map((l) => l.href)).toEqual([
      '/league/L%201?view=settings&settingsPanel=roster',
      '/league/L%201?view=settings&settingsPanel=draft',
      '/league/L%201?view=settings&settingsPanel=trades',
      '#ch-rollover',
    ])
    expect(card.href).toBe('/league/L%201?view=settings&settingsPanel=format')
    expect(card.rookieRounds).toBe(4)
  })

  it('never invents a value: an unsaved league shows an honest empty state and no rows', () => {
    const card = dynastyFormatCard('L1', none)
    expect(card.facts).toEqual([])
    expect(card.links).toEqual([])
    expect(card.rookieRounds).toBeUndefined()
    expect(card.detail).toMatch(/No dynasty settings are saved/)
  })

  it('links the rollover only while one is due', () => {
    const started = dynastyFormatCard('L1', { ...none, rollover: { state: 'started', season: 2027 } })
    expect(started.facts!.map((f) => f.value)).toEqual(['Done · 2027 is under way'])
    expect(started.links).toEqual([])
  })

  it('writes Spanish without the word waiver', () => {
    const card = dynastyFormatCard('L1', full, 'es')
    const text = [card.title, card.detail, card.action, ...card.facts!.flatMap((f) => [f.label, f.value]), ...card.links!.map((l) => l.label)].join(' ')
    expect(text).toContain('Draft de novatos')
    expect(text).toContain('4 rondas · lineal')
    expect(text.toLowerCase()).not.toContain('waiver')
  })
})

describe('commissionerFormatCards with dynasty facts', () => {
  const profile = resolveCommissionerLeagueProfile({ league: { id: 'dyn-1', leagueType: 'dynasty', sport: 'NFL' }, commissionerRole: 'commissioner' })
  it('adds the dynasty card only when facts are passed', () => {
    expect(commissionerFormatCards(profile).map((c) => c.key)).not.toContain('dynasty')
    expect(commissionerFormatCards(profile, 'dynasty', 'en', null).map((c) => c.key)).not.toContain('dynasty')
    expect(commissionerFormatCards(profile, 'dynasty', 'en', full)[0].key).toBe('dynasty')
  })
})

describe('toDynastyFormatFacts', () => {
  it('lets a devy row override the core taxi count and keeps unsaved values null', () => {
    const facts = toDynastyFormatFacts({
      league: { rosterSize: null, taxiSlots: 0 },
      config: { taxiSlots: 4, rookieDraftRounds: 5, rookieDraftType: 'snake', futurePicksYearsOut: 2 },
      devy: { taxiSlots: 5, devySlots: 10 },
      seasons: null,
    })
    expect(facts).toEqual({ rosterSize: null, taxiSlots: 5, devySlots: 10, rookieDraftRounds: 5, rookieDraftType: 'snake', futurePicksYearsOut: 2, rollover: null })
  })

  it('treats an imported League.taxiSlots of 0 as unknown, not as no taxi squad', () => {
    expect(toDynastyFormatFacts({ league: { taxiSlots: 0 }, config: null, devy: null, seasons: null }).taxiSlots).toBeNull()
    expect(toDynastyFormatFacts({ league: { taxiSlots: 3 }, config: null, devy: null, seasons: null }).taxiSlots).toBe(3)
  })

  it('reads the rollover state from the league season rows', () => {
    const read = (seasons: unknown[]) => toDynastyFormatFacts({ league: {}, config: null, devy: null, seasons: seasons as never }).rollover
    expect(read([])).toBeNull()
    expect(read([season({})])).toEqual({ state: 'in_season', season: 2026 })
    expect(read([season({ status: 'complete' })])).toEqual({ state: 'due', season: 2026 })
    expect(read([season({ season: 2027, status: 'active', currentWeek: 1 }), season({ status: 'complete' })])).toEqual({ state: 'started', season: 2027 })
  })
})

describe('DynastyFormatCard', () => {
  it('renders the facts, the pick chips and the settings links', () => {
    render(<ul><DynastyFormatCard card={dynastyFormatCard('L1', full)} /></ul>)
    const card = screen.getByTestId('dynasty-format-card')
    expect(card.textContent).toContain('Dynasty settings')
    expect(card.querySelectorAll('[data-fact]').length).toBe(6)
    const chips = card.querySelectorAll('.af-dyn-chip')
    expect(Array.from(chips).map((c) => c.textContent)).toEqual(['R1', 'R2', 'R3', 'R4'])
    expect(chips[0].getAttribute('data-round')).toBe('first')
    expect(chips[1].getAttribute('data-round')).toBe('later')
    expect(Array.from(card.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('#ch-rollover')
  })

  it('renders no rows or chips when nothing is saved', () => {
    render(<ul><DynastyFormatCard card={dynastyFormatCard('L1', none)} /></ul>)
    const card = screen.getByTestId('dynasty-format-card')
    expect(card.querySelector('dl')).toBeNull()
    expect(card.querySelector('.af-dyn-chip')).toBeNull()
  })
})
