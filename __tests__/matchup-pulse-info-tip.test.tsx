/**
 * The all-leagues matchup board's "?" (2026-10-03). Its columns are chosen by WIN PROBABILITY while
 * each row prints its own MARGIN, so "+30.9" in green under "Underdog" is correct and reads as a bug.
 * The tip says so — and each sentence only when the thing it explains is on screen.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { MatchupPulseBoard } from '@/components/core-app/MatchupPulseBoard'
import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'

const row = (over: Partial<PulseRow> = {}): PulseRow => ({
  leagueId: 'l1', leagueName: 'Dynasty Warriors', platform: 'sleeper', logoUrl: null, leagueBadge: 'DW',
  opponentName: 'Ghosts', opponentLabel: 'Ghosts', opponentAvatarUrl: null, opponentInitials: 'GG',
  margin: 12.4, basis: 'scored', season: 2026, week: 2, final: false, startersLeft: 6, coverage: null,
  href: '/core/matchup?league=l1', ...over,
})
const pulse = (over: Partial<MatchupPulse> = {}): MatchupPulse => ({
  leading: [row({ pWin: 0.7 })], trailing: [row({ leagueId: 'l2', margin: 30.9, pWin: 0.2 })],
  considered: 3, ranked: 2, basis: 'scored', allFinal: false, withOdds: 2, expectedWins: 0.9,
  closest: [row({ leagueId: 'l3', margin: -0.4, pWin: 0.49 })],
  notRanked: { noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0, unidentifiedRoster: 0 },
  ...over,
}) as MatchupPulse
const board = (p: MatchupPulse) => render(<MatchupPulseBoard pulse={p} issues={[]} allHref="/core/matchup?all=1" totalLeagues={9} />).container
const tipText = (c: HTMLElement) => c.querySelector('.af-mp-head .af-info-pop')?.textContent ?? null

describe('"Where you stand" explains itself once', () => {
  it('puts ONE "?" beside the heading — none on the rows — and names the margin-vs-odds trap', () => {
    lang.language = 'en'
    const c = board(pulse({ basis: 'mixed', leading: [row({ pWin: 0.7, basis: 'projected' })] }))
    expect(c.querySelectorAll('button.af-info-tip').length).toBe(1)
    expect(c.querySelector('.af-mp-head > .af-bd-sec-info button.af-info-tip')).not.toBeNull()
    expect(c.querySelectorAll('.af-mp-row button').length).toBe(0)
    const t = tipText(c)!
    for (const s of ['Favoured and Underdog sort your leagues by chance to win', 'lead by 30 can sit under Underdog', 'with its own sign', 'tagged PROJ', 'The ring is your chance to win', 'proj final', 'Expected record', 'Closest games']) {
      expect(t).toContain(s)
    }
  })

  it('⚠ says nothing about projections on a fully scored board — not even in the tip', () => {
    const c = board(pulse())
    expect(tipText(c)).not.toMatch(/projection|PROJ\b/)
    expect(c.textContent ?? '').not.toMatch(/projection/i)
  })

  it('⚠ keeps the button out of the heading the section is labelled by', () => {
    const c = board(pulse())
    const h = c.querySelector(`[id="${c.querySelector('section.af-mp')!.getAttribute('aria-labelledby')}"]`)!
    expect(h.tagName).toBe('H2')
    expect(h.querySelector('button')).toBeNull()
  })

  it('describes margin columns, with no ring sentence, when the model priced nothing', () => {
    const t = tipText(board(pulse({ withOdds: 0, expectedWins: null, closest: [], leading: [row()], trailing: [row({ leagueId: 'l2', margin: -3 })] })))!
    expect(t).toContain('Leading and Trailing sort your leagues by margin')
    expect(t).not.toContain('ring')
    expect(t).not.toContain('Expected record')
    expect(t).not.toContain('Closest games')
  })

  it('says results, not odds, when every game is final', () => {
    const t = tipText(board(pulse({ allFinal: true, leading: [row({ final: true })], trailing: [row({ leagueId: 'l2', final: true, margin: -3 })], closest: [] })))!
    expect(t).toContain('Every game is final')
    expect(t).not.toContain('ring')
    expect(t).not.toContain('Expected record')
  })

  it('says nothing over a board with nothing ranked', () => {
    const c = board(pulse({ ranked: 0, leading: [], trailing: [], closest: [] }))
    expect(c.querySelector('button.af-info-tip')).toBeNull()
  })

  it('never sits under a `title`', () => {
    for (const pop of board(pulse()).querySelectorAll('.af-info-pop')) expect(pop.closest('[title]')).toBeNull()
  })

  it('names the columns and tags as Spanish renders them, and switches live both ways', () => {
    lang.language = 'en'
    const r = render(<MatchupPulseBoard pulse={pulse()} issues={[]} allHref="/core/matchup?all=1" totalLeagues={9} />)
    const label = () => r.container.querySelector('.af-mp-head button.af-info-tip')!.getAttribute('aria-label')
    expect(label()).toBe('How to read this board')
    lang.language = 'es'
    r.rerender(<MatchupPulseBoard pulse={pulse()} issues={[]} allHref="/core/matchup?all=1" totalLeagues={9} />)
    expect(label()).toBe('Cómo leer este tablero')
    const t = r.container.querySelector('.af-mp-head .af-info-pop')!.textContent!
    for (const s of ['Favorito y En desventaja', '«final proy.»', 'Partidos más reñidos']) expect(t).toContain(s)
    /* The words the tip quotes are the words the board shows. */
    const shown = r.container.textContent!
    for (const s of ['Favorito', 'En desventaja', 'Partidos más reñidos']) expect(shown).toContain(s)
    lang.language = 'en'
    r.rerender(<MatchupPulseBoard pulse={pulse()} issues={[]} allHref="/core/matchup?all=1" totalLeagues={9} />)
    expect(label()).toBe('How to read this board')
  })
})
