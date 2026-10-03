/**
 * The Matchup screen's two "?" (2026-10-03): how to read the banner, and how to read the slot board.
 * Both explained themselves through hover `title`s and an engine detail line, or not at all.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell, MatchupSlot } from '@/lib/core-app/matchup'

const cell = (over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell => ({
  playerId: 'p', sleeperId: 'p', name: 'P', position: 'WR', team: 'KC', sport: 'NFL', imageUrl: null,
  projected: 10, afEngine: 11, actual: null, empty: false, unavailable: null, ...over,
})
const slot = (you: MatchupPlayerCell | null, opponent: MatchupPlayerCell | null): MatchupSlot =>
  ({ slotLabel: 'WR', you, opponent }) as MatchupSlot

function data(over: Partial<MatchupData> = {}): MatchupData {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '2-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Theirs', ownerName: 'them', record: '1-2', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'unplayed week' },
    lineups: { available: true, data: [slot(cell({ projected: 14 }), cell({ projected: 9 })), slot(cell(), cell({ projected: null }))] },
    identityNote: null,
    playerScoring: { available: false, reason: 'Projections until kickoff.' },
    winProbability: { available: true, data: { pWin: 0.64, confidence: 'LOW', detail: '18 starters still to play, 210.0 projected points outstanding' } },
    projectedFinal: { available: true, data: { you: 112.4, opponent: 98.1, unprojected: { you: 0, opponent: 0 } } },
    yetToPlay: { available: false, reason: 'no game state' },
    ...over,
  } as MatchupData
}

const tipIn = (c: HTMLElement, sel: string) => c.querySelector(`${sel} .af-info-pop`)?.textContent ?? null

describe('the banner explains its numbers once, at its centre', () => {
  it('puts ONE "?" beside "Win probability" — none on the team cards', () => {
    lang.language = 'en'
    const c = render(<Matchup data={data()} />).container
    const h2h = c.querySelector('.af-mu-h2h')!
    expect(h2h.querySelectorAll('button.af-info-tip').length).toBe(1)
    expect(h2h.querySelector('.af-mu-centre-label button.af-info-tip')).not.toBeNull()
    expect(c.querySelectorAll('.af-mu-team button.af-info-tip').length).toBe(0)
    const text = tipIn(c, '.af-mu-centre-label')!
    for (const s of ['marked “proj”', 'Sleeper’s projection', 'independent', 'empty slot or a starter ruled out counts as zero', 'no percentage is shown', 'never reads HIGH', 'Projected']) expect(text).toContain(s)
  })

  it('explains AF only while an AF figure is on screen', () => {
    expect(tipIn(render(<Matchup data={data()} />).container, '.af-mu-centre-label')).toContain('AF beneath it')
    const noAf = data({ lineups: { available: true, data: [slot(cell({ afEngine: null }), cell({ afEngine: null }))] } })
    expect(tipIn(render(<Matchup data={noAf} />).container, '.af-mu-centre-label')).not.toContain('AF beneath it')
  })
})

describe('the slot board explains itself beside its heading', () => {
  it('names SLPR and AF before kickoff, and the tint and the tally', () => {
    const c = render(<Matchup data={data()} />).container
    const head = [...c.querySelectorAll('.af-mu-section-head')].find((h) => h.textContent?.includes('slot by slot'))!
    expect(head.querySelectorAll('button.af-info-tip').length).toBe(1)
    const text = head.querySelector('.af-info-pop')!.textContent!
    for (const s of ['SLPR is Sleeper’s', 'AF is AllFantasy’s', 'on Sleeper’s projection', 'No tint', 'of N comparable']) expect(text).toContain(s)
    /* Not in the column header: a button there joins the column's accessible name. */
    expect(c.querySelector('[role="columnheader"] button')).toBeNull()
    expect(c.querySelectorAll('.af-mu-board-row button.af-info-tip').length).toBe(0)
  })

  it('names PTS on a live board, and drops the projection wording', () => {
    const live = data({ playerScoring: { available: true, data: { source: 'Sleeper', playersScored: 4 } } } as Partial<MatchupData>)
    const head = [...render(<Matchup data={live} />).container.querySelectorAll('.af-mu-section-head')].find((h) => h.textContent?.includes('slot by slot'))!
    const text = head.querySelector('.af-info-pop')!.textContent!
    expect(text).toContain('PTS is each player’s points')
    expect(text).not.toContain('SLPR')
    expect(text).not.toContain('on Sleeper’s projection')
  })

  it('says nothing when there is no board to read', () => {
    const c = render(<Matchup data={data({ lineups: { available: false, reason: 'no lineups on file' } })} />).container
    const head = [...c.querySelectorAll('.af-mu-section-head')].find((h) => h.textContent?.includes('slot by slot'))!
    expect(head.querySelector('button.af-info-tip')).toBeNull()
  })
})

describe('both', () => {
  it('never sit under a `title`', () => {
    const c = render(<Matchup data={data()} />).container
    const pops = [...c.querySelectorAll('.af-info-pop')]
    expect(pops.length).toBe(2)
    for (const pop of pops) expect(pop.closest('[title]')).toBeNull()
  })

  it('read in Spanish', () => {
    lang.language = 'es'
    const c = render(<Matchup data={data()} />).container
    const labels = [...c.querySelectorAll('button.af-info-tip')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Cómo leer este marcador', 'Cómo leer esta tabla'])
    expect(tipIn(c, '.af-mu-centre-label')).toContain('nunca es ALTA')
    lang.language = 'en'
  })

  it('keep the board’s "?" on the heading’s line — the head is a row', () => {
    const css = readFileSync(resolve(__dirname, '../components/core-app/af-matchup.css'), 'utf8')
    const out: Record<string, string> = {}
    postcss.parse(css).walkRules((r: Rule) => {
      if (r.parent?.type === 'root' && r.selector === '.af-mu-section-head') r.walkDecls((d) => void (out[d.prop] = d.value))
    })
    expect(out).toMatchObject({ display: 'flex', 'align-items': 'center' })
  })
})
