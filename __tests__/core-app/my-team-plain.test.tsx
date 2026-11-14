import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * My team in plain words (2026-11-14), for every league. Found on the owner's dynasty league: "make
 * changes on Sleeper" in about seven forms; 187.6 four times and the opponent's 232.6 twice; the next
 * kickoff as a number and again as a countdown card; two platform buttons and four Ask Chimmy
 * buttons; a headline saying the lineup is set over a card saying "Review your starting lineup"; bench
 * checks that said "fine as-is" between starters; and the roster value's detail twice. The owner then
 * asked for a dynasty team's future draft picks on this page — now their own section under Taxi.
 */

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'
import {
  futurePicksSummary, kickoffCountdown, showBenchCheck, showGradeDetail, winPercent,
} from '@/lib/core-app/myTeamGuide'
import { myTeamGuideMessages } from '@/lib/core-app/messages/myTeamGuide'

afterEach(() => { lang.language = 'en' })

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
} as LineupPlayer)

const LINEUP = 'https://sleeper.com/leagues/1/team'
const KICKOFF_IN = 26 * 3_600_000 + 5 * 60_000 // 1d 2h 5m

function data(over: Record<string, unknown> = {}): MyTeamData {
  return {
    league: { id: 'l1', name: 'AFC Dreaming!', platform: 'sleeper', format: 'dynasty', sport: 'NFL', sourceLink: { href: LINEUP, label: 'Fix Lineup in AFC Dreaming!' } },
    team: { available: true, data: { teamName: 'NewYorkJets!', ownerName: 'TheCiege24', rank: 12, teamCount: 14, record: '2-7', recordKnown: true, managerAvatarUrl: null } },
    starters: {
      available: true,
      data: [
        { slotLabel: 'QB', player: player(), empty: false, unresolvedId: null },
        { slotLabel: 'WR', player: player({ sleeperId: 'gw', name: 'Garrett Wilson', position: 'WR', injuryStatus: 'Questionable' }), empty: false, unresolvedId: null },
        {
          slotLabel: 'WR', player: player({ sleeperId: 'jl', name: "Ja'Kobi Lane", position: 'WR' }), empty: false, unresolvedId: null,
          benchCheck: { verdict: 'hold', benchName: 'Xavier Hutchinson', benchProjected: 5.9, starterName: "Ja'Kobi Lane", starterProjected: 5.6 },
        },
      ],
    },
    bench: { available: true, data: [player({ sleeperId: 'b1', name: 'Xavier Hutchinson', position: 'WR' })] },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: true, data: { at: new Date(Date.now() + KICKOFF_IN), anyEmptySlot: false, week: 10, season: 2026, daysAway: 1, next: true } },
    projections: { available: true, data: { total: 187.6, projected: 3, unprojected: 0, season: '2026', week: 10, afTotal: 187.6, afEngineTotal: 184.7, afProjected: 3, standardComparable: true } },
    projectionBasis: { notes: [], scoringKnown: true },
    nextMatchup: {
      available: true,
      data: {
        seasonYear: 2026, week: 10, bye: false, unpricedReason: null,
        you: { rosterId: '3', teamName: 'NewYorkJets!', managerName: 'me', avatarUrl: null, projected: 187.6, projectedFrom: 3, starterCount: 3 },
        opponent: { rosterId: '7', teamName: 'Dolphins (B2B Champs)', managerName: 'them', avatarUrl: null, projected: 232.6, projectedFrom: 3, starterCount: 3 },
        forecast: { available: true, pWin: 0.09, projectedMargin: -46, confidence: 'LOW', detail: '' },
      },
    },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    lineupOptimizer: { state: 'optimal', currentTotal: 187.6, lockedSeats: 0 },
    lineupVerification: { checkedAt: new Date().toISOString(), week: 10 },
    dynasty: {
      picks: {
        available: true,
        coverage: 'complete',
        bySeason: [
          { season: 2027, picks: [{ season: 2027, round: 1, label: '1st', fromTeamName: null }, { season: 2027, round: 1, label: '1st', fromTeamName: 'Taco Tuesday' }, { season: 2027, round: 2, label: '2nd', fromTeamName: null }] },
          { season: 2028, picks: [{ season: 2028, round: 3, label: '3rd', fromTeamName: null }] },
        ],
      },
      ages: { available: true, medianStarterAge: 26.5, known: 3, total: 3, youngCore: 1, aging: [] },
    },
    ...over,
  } as unknown as MyTeamData
}

describe('the rules', () => {
  it('counts down to the next kickoff in whole minutes, or says it has started', () => {
    const now = Date.parse('2026-11-14T12:00:00Z')
    expect(kickoffCountdown(now + KICKOFF_IN, now)).toEqual({ kind: 'in', days: 1, hours: 2, minutes: 5 })
    expect(kickoffCountdown(now + 90_000, now)).toEqual({ kind: 'in', days: 0, hours: 0, minutes: 1 })
    expect(kickoffCountdown(now, now)).toEqual({ kind: 'started' })
    expect(kickoffCountdown(now - 1, now)).toEqual({ kind: 'started' })
    expect(kickoffCountdown(Number.NaN, now)).toEqual({ kind: 'started' })
  })

  it('reads the win chance only from a forecast that has one', () => {
    expect(winPercent({ available: true, pWin: 0.09 })).toBe(9)
    expect(winPercent({ available: true, pWin: 1.4 })).toBe(100)
    expect(winPercent({ available: false })).toBeNull()
    expect(winPercent({ available: true, pWin: Number.NaN })).toBeNull()
    expect(winPercent(null)).toBeNull()
  })

  it('keeps a bench check only when it says to swap', () => {
    expect(showBenchCheck({ verdict: 'swap' })).toBe(true)
    expect(showBenchCheck({ verdict: 'hold' })).toBe(false)
    expect(showBenchCheck(null)).toBe(false)
  })

  it('keeps the roster-value detail only where Positional strength is not drawn', () => {
    expect(showGradeDetail({ positions: [{}, {}] })).toBe(false)
    expect(showGradeDetail({ positions: [{}] })).toBe(true)
    expect(showGradeDetail({ positions: null })).toBe(true)
  })

  it('sums a dynasty team’s picks', () => {
    expect(futurePicksSummary([
      { season: 2027, picks: [{ round: 1 }, { round: 1 }, { round: 2 }] },
      { season: 2028, picks: [{ round: 3 }] },
      { season: 2029, picks: [] },
    ])).toEqual({ total: 4, firstRounders: 2, seasons: 2 })
  })
})

describe('<MyTeam /> — the top', () => {
  it('drops the intro and the "starters to check" number; says the kickoff with its time left', async () => {
    const { container } = render(<MyTeam data={data()} />)
    await act(async () => {})
    const guide = container.querySelector('[data-testid=my-team-guide]')!
    expect(guide.textContent).not.toMatch(/Lineup changes are made on|Check your lineup before kickoff/)
    expect(guide.querySelector('[data-chip=check]')).toBeNull()
    expect(guide.querySelector('[data-chip=kickoff] span')?.textContent).toBe('Next kickoff · in 1d 2h')
    expect(container.querySelector('.af-mt-lock')).toBeNull()
  })

  it('says both projections and the win chance once, opening Matchup', () => {
    const { container } = render(<MyTeam data={data()} />)
    const chip = container.querySelector('[data-chip=projected]')!
    expect(chip.querySelector('b')?.textContent).toBe('187.6 vs 232.6')
    expect(chip.querySelector('span')?.textContent).toBe('Projected · 9% to win')
    expect(chip.getAttribute('href')).toBe('/core/matchup?league=l1')
    expect(container.querySelector('.af-mt-matchup')).toBeNull()
    expect(container.textContent).not.toMatch(/projected behind by|projected margin/)
    // Your total is in the scoring card's comparison, not in the team card again.
    expect(container.querySelector('.af-mt-head .af-mt-tile--proj')).toBeNull()
  })

  it('has one platform button, on the team card, and the Sleeper check as one line', () => {
    const { container } = render(<MyTeam data={data()} />)
    // The roster-decisions panel at the foot keeps its own hand-off; above it there is exactly one.
    const toPlatform = [...container.querySelectorAll('a')].filter((a) => a.getAttribute('href') === LINEUP && !a.closest('.af-tw-panel'))
    expect(toPlatform).toHaveLength(1)
    expect(toPlatform[0].closest('.af-mt-head')).not.toBeNull()
    expect(container.querySelector('[data-testid=my-team-checked]')?.textContent).toContain('Checked just now with Sleeper')
    expect(container.textContent).not.toContain('Starter, bench, IR and taxi placement verified')
    expect(container.textContent).not.toContain('This checks lineup placement')
  })
})

describe('<MyTeam /> — what to do and the lineup', () => {
  it('names the starter to check, without the "nothing found" boilerplate or "Why it matters"', () => {
    const { container } = render(<MyTeam data={data()} />)
    const decision = container.querySelector('.af-mt-decision')!
    expect(decision.querySelector('h2')?.textContent).toBe('1 starter to check')
    expect(decision.textContent).toContain('Garrett Wilson')
    expect(decision.textContent).not.toMatch(/No empty, out, or bye slot|Why it matters|Confirm eligibility, locks, and AutoSubs/)
    expect(container.querySelectorAll('.af-mtg-ask')).toHaveLength(1)
  })

  it('says what a bye means in one line, without sending you to confirm it on the platform', () => {
    const starters = { available: true, data: [{ slotLabel: 'QB', player: player({ onBye: true }), empty: false, unresolvedId: null }] }
    const text = render(<MyTeam data={data({ starters })} />).container.querySelector('.af-mt-decision')!.textContent!
    expect(text).toContain('Bo Nix is on a bye — he scores zero unless you start someone else.')
    expect(text).not.toMatch(/on your platform/)
  })

  it('keeps the boilerplate when nothing was found', () => {
    const starters = { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] }
    const { container } = render(<MyTeam data={data({ starters })} />)
    expect(container.querySelector('.af-mt-decision')?.textContent).toContain('No empty, out, or bye slot was identified')
  })

  it('says the best lineup in one line, with no repeated total and no method note', () => {
    const { container } = render(<MyTeam data={data()} />)
    const opt = container.querySelector('[data-testid=mt-optimizer]')!
    expect(opt.querySelector('.af-mt-opt-clear')?.textContent).toBe('Your lineup is already the best one we can find.')
    expect(opt.textContent).not.toMatch(/187\.6|Recommendation only|never sets your lineup/)
  })

  it('shows no "fine as-is" bench check between starters; shows a swap', () => {
    const hold = render(<MyTeam data={data()} />).container
    expect(hold.querySelector('.af-mt-bench-check')).toBeNull()
    const starters = data().starters as { available: true; data: Array<Record<string, unknown>> }
    starters.data[2] = { ...starters.data[2], benchCheck: { verdict: 'swap', benchName: 'Xavier Hutchinson', benchProjected: 15, starterName: "Ja'Kobi Lane", starterProjected: 5.6 } }
    const swap = render(<MyTeam data={data({ starters })} />).container
    const strip = swap.querySelector('.af-mt-bench-check')!
    expect(strip.getAttribute('data-verdict')).toBe('swap')
    expect(strip.textContent).not.toContain('confirm injury updates')
  })

  it('says where the lineup is changed once, briefly, above the starters', () => {
    const { container } = render(<MyTeam data={data()} />)
    expect(container.querySelector('#af-mt-starters .af-mt-section-note')?.textContent).toBe('Lineup from Sleeper — change it there.')
    expect(container.textContent).not.toMatch(/AllFantasy only reads|confirm individual locks and AutoSubs/)
  })
})

describe('<MyTeam /> — a dynasty team’s future draft picks', () => {
  it('lists them under Taxi, each year’s picks with where a traded-in one came from, and how to trade them', () => {
    const { container } = render(<MyTeam data={data()} />)
    const picks = container.querySelector('[data-testid=my-team-future-picks]')!
    expect(picks.querySelector('h2')?.textContent).toBe('Future draft picks')
    expect(picks.querySelector('[data-testid=my-team-picks-count]')?.textContent).toBe('4 picks · 2 first-rounders')
    const rows = [...picks.querySelectorAll('.af-mt-picks-list li')]
    expect(rows.map((r) => r.querySelector('.af-mt-picks-season')?.textContent)).toEqual(['2027', '2028'])
    expect([...rows[0].querySelectorAll('.af-mt-pick')].map((p) => p.textContent)).toEqual(['1st', '1stvia Taco Tuesday', '2nd'])
    expect(rows[0].querySelector('[data-via=true]')?.getAttribute('data-round')).toBe('1')
    expect(picks.querySelector('a')?.getAttribute('href')).toBe('/core/trades?league=l1')
    // In the roster column, after the bench, not in the side card.
    expect(picks.closest('.af-mt-main')).not.toBeNull()
    expect(container.querySelector('.af-mt-dynasty')?.textContent).not.toContain('2027')
  })

  it('says when there are none, and why when they cannot be read', () => {
    const none = data({ dynasty: { picks: { available: true, coverage: 'complete', bySeason: [] }, ages: { available: false, reason: 'n/a' } } })
    expect(render(<MyTeam data={none} />).container.querySelector('[data-testid=my-team-future-picks]')?.textContent).toContain('You hold no picks in the upcoming drafts.')
    const off = data({ dynasty: { picks: { available: false, reason: 'future picks are not synced for this platform yet' }, ages: { available: false, reason: 'n/a' } } })
    expect(render(<MyTeam data={off} />).container.querySelector('[data-testid=my-team-future-picks]')?.textContent).toContain('future picks are not synced for this platform yet')
  })

  it('is not drawn outside dynasty', () => {
    expect(render(<MyTeam data={data({ dynasty: null })} />).container.querySelector('[data-testid=my-team-future-picks]')).toBeNull()
  })
})

describe('Spanish', () => {
  it('says the new lines in Spanish', async () => {
    lang.language = 'es'
    const { container } = render(<MyTeam data={data()} />)
    await act(async () => {})
    expect(container.querySelector('[data-chip=kickoff] span')?.textContent).toBe('Próximo inicio · en 1 d 2 h')
    // The kickoff's weekday in Spanish too, not "Sun".
    expect(container.querySelector('[data-chip=kickoff] b')?.textContent).not.toMatch(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/)
    expect(container.querySelector('[data-chip=projected] span')?.textContent).toBe('Proyección · 9% de ganar')
    expect(container.querySelector('.af-mt-decision h2')?.textContent).toBe('1 titular por revisar')
    expect(container.querySelector('.af-mt-opt-clear')?.textContent).toBe('Tu alineación ya es la mejor que encontramos.')
    expect(container.querySelector('#af-mt-starters .af-mt-section-note')?.textContent).toBe('Alineación de Sleeper: cámbiala allí.')
    const picks = container.querySelector('[data-testid=my-team-future-picks]')!
    expect(picks.querySelector('h2')?.textContent).toBe('Selecciones de draft futuras')
    expect(picks.querySelector('[data-testid=my-team-picks-count]')?.textContent).toBe('4 selecciones · 2 de primera ronda')
    expect(container.querySelector('[data-testid=my-team-checked]')?.textContent).toContain('con Sleeper')
  })

  it('has every key in both languages and never says «waiver»', () => {
    const en = myTeamGuideMessages.en as Record<string, unknown>
    const es = myTeamGuideMessages.es as Record<string, unknown>
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const text = Object.values(es).map((v) => (typeof v === 'function' ? String((v as (...a: unknown[]) => unknown)(2, 3)) : String(v))).join(' ')
    expect(text).not.toMatch(/waiver/i)
  })
})
