/**
 * Everything My Team prints from the server, and the client sentences that only appear in states
 * the earlier audit never reached, in Spanish (2026-10-03).
 *
 * Server side: every `reason:` in `myTeam.ts` and `dynastyOutlook.ts`, the dynasty card's "another
 * team" placeholder, and `describeScoringDifferences`' notes — through `myTeamReasonText` /
 * `scoringNoteText` at render. Client side: the lineup-decision panel, the bench-check strip and its
 * Chimmy prefill, the roster-grade line, the matchup card's one-line read, and `ordinal` ("2nd").
 *
 * The guard READS THE PRODUCERS, so a new English reason fails here instead of shipping; and two
 * rich renders drive the page through every state that prints these, audited for English.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { myTeamReasonText, scoringNoteText } from '@/lib/core-app/myTeamReasonText'
import { describeScoringDifferences } from '@/lib/core-app/scoringNotes'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

/**
 * Words only an English sentence uses here. Not "no"/"a" (Spanish too), not "Best"/"Ball"/"feed"/
 * "tight"/"ends" (loanwords and a product name the Spanish keeps).
 */
const ENGLISH = /\b(the|your|you|this|that|with|from|for|yet|been|has|have|are|is|was|were|which|could|would|should|than|more|projects?|points|league|starters?|bench|lineup|roster|week|players?|team|game|lock|locks|scoring|swap|replace|review|fill|cover|slot|median|priced|valued|above|below|nobody|catch|worth)\b/i

/** Prose literals from every `reason:` expression — one line, several lines, or a ternary. */
function reasonLiterals(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\breason:\s*/g)) {
    const rest = src.slice(m.index! + m[0].length)
    const stop = rest.search(/,\s*\n\s*[A-Za-z_]+\s*[:(]|\n\s*[}\])]/)
    const expr = stop === -1 ? rest.slice(0, 400) : rest.slice(0, stop)
    for (const lit of expr.matchAll(/(['"`])((?:(?!\1)[^\n])+)\1/g)) {
      const s = lit[2]!.replace(/\$\{[^}]*\}/g, '4')
      if (/\s/.test(s)) out.push(s)
    }
  }
  return [...new Set(out)]
}
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('the server side has Spanish', () => {
  it('🛑 every reason myTeam.ts and dynastyOutlook.ts can write — read from the source', () => {
    const reasons = [...reasonLiterals(read('lib/core-app/myTeam.ts')), ...reasonLiterals(read('lib/core-app/dynastyOutlook.ts'))]
    // The scan must see real, varied reasons — single-line, multi-line and ternary — or it asserts nothing.
    expect(reasons.length).toBeGreaterThan(20)
    expect(reasons).toEqual(expect.arrayContaining([
      'nobody on injured reserve',
      'We need prices for most of this league’s rosters to rank yours against them, and we don’t have them yet.',
      'no starters to project on this roster', 'no weekly projection feed has been ingested yet',
      'no week 4 game found for any of your starters yet', 'this league has no future-pick inventory yet',
    ]))
    const untranslated = reasons.filter((r) => myTeamReasonText(r, 'es') === r || ENGLISH.test(myTeamReasonText(r, 'es')))
    expect(untranslated).toEqual([])
  })

  it('the dynasty card’s "another team" placeholder', () => {
    expect(read('lib/core-app/dynastyOutlook.ts')).toContain("fromTeamName: p.originalTeamId === p.ownerTeamId ? null : 'another team'")
    expect(myTeamReasonText('another team', 'es')).toBe('otro equipo')
  })

  it('every scoring note describeScoringDifferences writes — generated, not copied', () => {
    const notes = [
      ...describeScoringDifferences({ rec: 0.5, bonus_rec_te: 0.5, pass_td: 6, pass_int: -1, bonus_rush_yd_100: 1, idp_tkl: 1 }),
      ...describeScoringDifferences({ rec: 0, bonus_rush_yd_100: 1, bonus_rec_yd_100: 2 }),
    ]
    expect(notes.length).toBe(8)
    for (const n of notes) {
      const es = scoringNoteText(n, 'es')
      expect(es, n).not.toBe(n)
      expect(es, n).not.toMatch(ENGLISH)
    }
  })

  it('passes English through, and never blanks an unknown string', () => {
    expect(myTeamReasonText('nobody on injured reserve', 'en')).toBe('nobody on injured reserve')
    expect(myTeamReasonText('something new', 'es')).toBe('something new')
    expect(scoringNoteText('Something new.', 'es')).toBe('Something new.')
  })
})

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null, market: null, onBye: false, ...over,
})
const slot = (label: string, p: LineupPlayer | null, benchCheck: LineupSlot['benchCheck'] = null): LineupSlot =>
  ({ slotLabel: label, benchCheck, player: p, empty: p == null, unresolvedId: null }) as LineupSlot
const side = (over: Record<string, unknown> = {}) => ({ rosterId: 4, teamName: 'Mine', managerName: 'me', avatarUrl: null, projected: 131.7, afProjected: 128.4, projectedFrom: 9, starterCount: 9, ...over })
const base = (over: Record<string, unknown> = {}) =>
  ({
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: { href: 'https://sleeper.com/leagues/1/team', label: 'Sleeper' } },
    team: { available: true, data: { teamName: 'Mine', ownerName: 'me', managerAvatarUrl: null, record: '2-1', recordKnown: true, rank: 2, pointsFor: 300, pointsAgainst: 280, teamCount: 12 } },
    starters: { available: true, data: [slot('QB', player())] },
    bench: { available: true, data: [player({ sleeperId: 'b1', name: 'Jo Reyes', afProjectedPoints: 30 })] },
    ir: { available: false, reason: 'nobody on injured reserve' }, taxi: { available: false, reason: 'nobody on the taxi squad' },
    lock: { available: true, data: { at: new Date('2099-10-04T17:00:00Z'), anyEmptySlot: false, week: 4, season: 2026, daysAway: 1 } },
    projections: { available: true, data: { total: 118.4, projected: 8, unprojected: 1, season: '2026', week: 4, afTotal: 131.7, afEngineTotal: 127.3, afProjected: 8, standardComparable: true } },
    projectionBasis: { notes: describeScoringDifferences({ rec: 0.5, bonus_rec_te: 0.5, pass_td: 6, idp_tkl: 1 }), scoringKnown: true },
    nextMatchup: { available: true, data: { seasonYear: 2026, week: 4, you: side(), opponent: side({ rosterId: 7, teamName: 'Them', projected: 118.2 }), bye: false, unpricedReason: null } },
    upcomingByes: [],
    rosterGrade: {
      available: true,
      data: {
        rank: 3, outOf: 12, value: 41200, median: 38000,
        strongest: { position: 'WR', value: 18400, rank: 2, outOf: 12, playerCount: 7 },
        weakest: { position: 'TE', value: 2100, rank: 11, outOf: 12, playerCount: 2 },
        pricedPlayers: 24, totalPlayers: 26,
        basis: { format: 'DYNASTY', qbFormat: 'ONE_QB', capturedAt: '2026-08-22T00:00:00.000Z', leagueScored: true },
      },
    },
    liveScore: { available: false, reason: 'no live scoring ingested for imported leagues' },
    dynasty: {
      picks: { available: false, reason: 'this league has no future-pick inventory yet' },
      ages: { available: false, reason: 'no ages on file for your starters' },
    },
    ...over,
  }) as unknown as MyTeamData

const swap = { verdict: 'swap' as const, benchName: 'Jo Reyes', benchProjected: 30, starterName: 'Bo Nix', starterProjected: 22.4 }
const close = { verdict: 'close' as const, benchName: 'Jo Reyes', benchProjected: 23, starterName: 'Al Close', starterProjected: 22.4 }

/** Every state that prints one of these sentences, across the pages it takes to reach them all. */
const PAGES: Array<[string, MyTeamData]> = [
  ['ruled-out decision, both bench verdicts, grade, edge, notes, dynasty gaps', base({
    starters: { available: true, data: [slot('QB', player({ ruledOut: true, injuryStatus: 'Out' })), slot('RB', player({ name: 'Ru Back' }), swap), slot('WR', player({ name: 'Al Close' }), close)] },
  })],
  ['swap decision with a league-scored delta', base({ starters: { available: true, data: [slot('QB', player(), swap)] } })],
  ['empty slot and bye decisions', base({ starters: { available: true, data: [slot('WR', null), slot('QB', player({ onBye: true }))] } })],
  ['every section unavailable', base({
    team: { available: false, reason: 'we cannot tell which team in this league is yours — claim it and the lineup appears here' },
  })],
  ['sections unavailable on a claimed team', base({
    starters: { available: false, reason: 'no starting lineup recorded on this roster' },
    bench: { available: false, reason: 'no bench players recorded on this roster' },
    lock: { available: false, reason: 'no upcoming game found for your starters, so there is no lock time to count down to' },
    projections: { available: false, reason: 'no weekly projection feed has been ingested yet' },
    rosterGrade: { available: false, reason: 'We need prices for most of this league’s rosters to rank yours against them, and we don’t have them yet.' },
    nextMatchup: { available: false, reason: 'no week 4 matchup recorded for your team yet' },
  })],
  ['picks via another team', base({
    dynasty: {
      picks: { available: true, coverage: 'complete', bySeason: [{ season: 2027, picks: [{ season: 2027, round: 1, label: '2027 1st', fromTeamName: 'another team' }] }] },
      ages: { available: false, reason: 'no ages on file for your starters' },
    },
  })],
]

function englishIn(root: HTMLElement): string[] {
  const out = new Set<string>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim()
    if (t && ENGLISH.test(t)) out.add(`text: ${t}`)
  }
  for (const el of root.querySelectorAll('[aria-label],[title],[alt],[placeholder]'))
    for (const a of ['aria-label', 'title', 'alt', 'placeholder']) {
      const v = el.getAttribute(a)
      if (v && ENGLISH.test(v)) out.add(`${a}: ${v}`)
    }
  return [...out]
}

describe('My Team, rendered in Spanish, in every state that prints these', () => {
  for (const [name, d] of PAGES) {
    it(`${name}: no English left`, () => {
      lang.language = 'es'
      const left = englishIn(render(<MyTeam data={d} />).container)
      lang.language = 'en'
      expect(left).toEqual([])
    })
  }

  it('the new comparison, Chimmy question and saved personal plan stay Spanish', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: { method?: string }) => ({ ok:true, status:200, json:async()=>url.includes('team-alerts')?{available:true,alerts:[]}:{plan:opts?.method==='PUT'?{version:1,slots:{},note:'',deleted:false}:null} })))
    lang.language = 'es'
    const r = render(<MyTeam data={base({workspaceScope:{rosterKey:'R',season:2026}})} />)
    fireEvent.change(r.getByLabelText('Suplente elegible'), { target: { value: 'b1' } })
    expect(r.container.textContent).toContain('Proyección:')
    expect(englishIn(r.container)).toEqual([])
    const questions: string[] = []
    const on = (e: Event) => questions.push((e as CustomEvent).detail.prefill)
    window.addEventListener('af-comms-open', on)
    fireEvent.click(r.getByRole('button', { name: 'Pedir una explicación a Chimmy' }))
    window.removeEventListener('af-comms-open', on)
    expect(questions[0]).toContain('compara Bo Nix con Jo Reyes')
    expect(questions[0]).not.toMatch(ENGLISH)
    fireEvent.change(r.getByLabelText('Semana prevista'), { target: { value: '7' } })
    await waitFor(() => expect(r.getByRole('button', { name: 'Guardar plan personal' })).not.toBeDisabled())
    fireEvent.click(r.getByRole('button', { name: 'Guardar plan personal' }))
    await waitFor(() => expect(r.container.textContent).toContain('Guardado en tu cuenta.'))
    expect(englishIn(r.container)).toEqual([])
    lang.language = 'en'
    r.rerender(<MyTeam data={base({workspaceScope:{rosterKey:'R',season:2026}})} />)
    expect(r.container.textContent).toContain('Saved to your account.')
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('the swap question Chimmy receives is Spanish too', () => {
    lang.language = 'es'
    const seen: string[] = []
    const on = (e: Event) => seen.push((e as CustomEvent).detail.prefill)
    window.addEventListener('af-comms-open', on)
    const c = render(<MyTeam data={PAGES[0][1]} />).container
    fireEvent.click(c.querySelector('button.af-mt-bench-ask')!)
    window.removeEventListener('af-comms-open', on)
    lang.language = 'en'
    expect(seen[0]).toContain('¿Debería poner de titular a Jo Reyes en lugar de Bo Nix')
  })

  it('switches live, both ways, with no reload', () => {
    lang.language = 'en'
    const d = PAGES[4][1]
    const r = render(<MyTeam data={d} />)
    expect(r.container.textContent).toContain('no bench players recorded on this roster')
    lang.language = 'es'
    r.rerender(<MyTeam data={d} />)
    expect(r.container.textContent).toContain('no hay suplentes registrados en esta plantilla')
    lang.language = 'en'
    r.rerender(<MyTeam data={d} />)
    expect(r.container.textContent).toContain('no bench players recorded on this roster')
  })
})
