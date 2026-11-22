import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * Trades part 2 (2026-11-14): Create a trade with 3 or 4 teams.
 *
 * - A letter for every team: what it gets against what it gives, through the SAME gap and the SAME
 *   bands as a 2-team grade (one `signedGapPct`, now in gradeScale.ts and re-exported).
 * - Nothing is guessed: an unpriced asset, or a team that only gives or only gets, is not graded.
 * - A 3–4 team screenshot is matched section by section to rosters; each asset's sender is the one
 *   team in the deal that holds it. FAAB is left out and said so.
 */

const lang = vi.hoisted(() => ({ value: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.value, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { gradeMultiTeam, type MultiAsset } from '@/lib/trade-intel/multiTeamGrade'
import { projectedLetterFor, signedGapPct as gapFromScale } from '@/lib/trade-intel/gradeScale'
import { signedGapPct as gapFromGrade } from '@/lib/decision-os/trade/tradeGrade'
import { matchMultiTeamOffer, offerTeamCount } from '@/lib/trade-screenshot/matchMultiOffer'
import { MultiTeamTradeBuilder } from '@/components/core-app/screens/MultiTeamTradeBuilder'
import { multiTeamTradeMessages } from '@/lib/core-app/messages/multiTeamTrade'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'
import type { OfferRead, ReadTeam } from '@/lib/trade-screenshot/offerRead'

afterEach(() => {
  cleanup()
  lang.value = 'en'
})

const asset = (key: string, from: string, to: string, value: number | null, label = key): MultiAsset => ({ key, kind: 'player', from, to, label, value })

describe('the 3–4 team grade', () => {
  it('one gap function: the 2-team grade and this grade share it', () => {
    expect(gapFromGrade).toBe(gapFromScale)
  })

  it('a fair three-way deal is C for everyone, and says so', () => {
    const g = gradeMultiTeam(['a', 'b', 'c'], [asset('p1', 'a', 'b', 100), asset('p2', 'b', 'c', 100), asset('p3', 'c', 'a', 100)])
    expect(g.teams.map((t) => (t.graded ? t.letter : null))).toEqual(['C', 'C', 'C'])
    expect(g.verdict).toEqual({ kind: 'fair' })
  })

  it('each letter is the 2-team letter for the same gets and gives', () => {
    const g = gradeMultiTeam(['a', 'b', 'c'], [asset('p1', 'a', 'b', 400), asset('p2', 'b', 'c', 100), asset('p3', 'c', 'a', 300)])
    for (const t of g.teams) {
      if (!t.graded) throw new Error('should be graded')
      expect(t.percentDiff).toBe(gapFromScale(t.gives, t.gets))
      expect(t.letter).toBe(projectedLetterFor({ percentDiff: gapFromScale(t.gives, t.gets), hasSignal: true }))
    }
    // b gets 400 for 100: A. c gets 100 for 300: F.
    expect(g.teams.find((t) => t.rosterId === 'b')).toMatchObject({ letter: 'A', gets: 400, gives: 100 })
    expect(g.teams.find((t) => t.rosterId === 'c')).toMatchObject({ letter: 'F' })
    expect(g.verdict).toEqual({ kind: 'ahead', rosterIds: ['b'] })
  })

  it('two teams equally ahead are both named', () => {
    const g = gradeMultiTeam(['a', 'b', 'c'], [asset('p1', 'c', 'a', 200), asset('p2', 'c', 'b', 200), asset('p3', 'a', 'c', 100), asset('p4', 'b', 'c', 100)])
    expect(g.verdict).toEqual({ kind: 'ahead', rosterIds: ['a', 'b'] })
  })

  it('🛑 an unpriced asset is not graded as worthless — the teams it touches get no letter', () => {
    const g = gradeMultiTeam(['a', 'b', 'c'], [asset('p1', 'a', 'b', null), asset('p2', 'b', 'c', 100), asset('p3', 'c', 'a', 100)])
    expect(g.teams.find((t) => t.rosterId === 'a')).toMatchObject({ graded: false, why: 'unpriced', unpriced: 1 })
    expect(g.teams.find((t) => t.rosterId === 'b')).toMatchObject({ graded: false, why: 'unpriced' })
    expect(g.teams.find((t) => t.rosterId === 'c')).toMatchObject({ graded: true })
    expect(g.verdict).toEqual({ kind: 'incomplete' })
  })

  it('a team that only gives, or only gets, has no gap to grade', () => {
    const g = gradeMultiTeam(['a', 'b', 'c'], [asset('p1', 'a', 'b', 100), asset('p2', 'b', 'a', 100)])
    expect(g.teams.find((t) => t.rosterId === 'c')).toMatchObject({ graded: false, why: 'gets_nothing' })
    const h = gradeMultiTeam(['a', 'b', 'c'], [asset('p1', 'a', 'b', 100), asset('p2', 'b', 'c', 100)])
    expect(h.teams.find((t) => t.rosterId === 'c')).toMatchObject({ graded: false, why: 'sends_nothing' })
  })

  it('an asset to or from a team outside the deal is ignored', () => {
    const g = gradeMultiTeam(['a', 'b', 'c'], [asset('x', 'a', 'z', 999), asset('p1', 'a', 'b', 100), asset('p2', 'b', 'c', 100), asset('p3', 'c', 'a', 100)])
    expect(g.teams.find((t) => t.rosterId === 'a')).toMatchObject({ gives: 100 })
  })
})

const player = (id: string, name: string, value: number | null, position = 'RB') => ({ id, name, position, team: null, imageUrl: null, byeWeek: null, injuryStatus: null, value })
const roster = (rosterId: string, ownerName: string, players: ReturnType<typeof player>[], picks: LeagueRoster['picks'] = []): LeagueRoster => ({
  rosterId,
  platformUserId: `u-${rosterId}`,
  players,
  picks,
  teamExternalId: rosterId,
  ownerName,
  ownerHandles: [ownerName],
  avatarUrl: null,
  wins: 0,
  losses: 0,
  ties: 0,
  faabRemaining: 100,
  canReceiveProposal: true,
})
const pick = (pickId: string, season: number, round: number, value: number | null, fromTeam: string | null = null) => ({ pickId, season, round, label: `${season} ${round === 1 ? '1st' : round === 2 ? '2nd' : `${round}th`}`, itemType: 'future_pick' as const, value, fromTeam })

const ROSTERS: LeagueRoster[] = [
  roster('r1', 'TheCiege24', [player('11', 'James Cook', 5556), player('12', 'Garrett Wilson', 3813, 'WR')], [pick('k1', 2027, 1, 2656)]),
  roster('r2', 'peteshabam', [player('21', 'Dallas Goedert', 1200, 'TE')], [pick('k2', 2027, 1, 2656), pick('k3', 2027, 1, 2656, 'Dysfunctional Texans')]),
  roster('r3', 'RhhNiner', [player('31', 'Rico Dowdle', 1000)], [pick('k4', 2028, 2, 1266)]),
  roster('r4', 'Fitzy37', [player('41', 'Malik Washington', 700, 'WR')]),
]

const read = (teams: ReadTeam[], unreadable: string[] = []): OfferRead => ({ kind: 'offer', teams, unreadable })

describe('reading a 3–4 team screenshot', () => {
  it('places each section by its label and each asset by who holds it', () => {
    const m = matchMultiTeamOffer({
      rosters: ROSTERS,
      viewerRosterId: 'r1',
      read: read([
        { name: '@TheCiege24', receives: [{ type: 'player', name: 'Dallas Goedert', position: 'TE' }] },
        { name: '@peteshabam', receives: [{ type: 'player', name: 'Rico Dowdle', position: 'RB' }] },
        { name: '@RhhNiner', receives: [{ type: 'player', name: 'James Cook', position: 'RB' }, { type: 'faab', amount: 12 }] },
      ]),
    })
    if (!m.ok) throw new Error(JSON.stringify(m.reason))
    expect(m.teamIds).toEqual(['r1', 'r2', 'r3'])
    expect(m.assets.map((a) => `${a.label}:${a.from}->${a.to}`)).toEqual(['Dallas Goedert:r2->r1', 'Rico Dowdle:r3->r2', 'James Cook:r1->r3'])
    expect(m.faabLeftOut).toEqual([12])
    expect(m.unmatched).toEqual([])
  })

  it('one unlabelled section is the viewer’s, when the viewer is the only one left', () => {
    const m = matchMultiTeamOffer({
      rosters: ROSTERS,
      viewerRosterId: 'r1',
      read: read([
        { name: null, receives: [{ type: 'player', name: 'Dallas Goedert', position: 'TE' }] },
        { name: 'peteshabam', receives: [{ type: 'player', name: 'Rico Dowdle', position: 'RB' }] },
        { name: 'RhhNiner', receives: [{ type: 'player', name: 'James Cook', position: 'RB' }] },
      ]),
    })
    expect(m.ok && m.teamIds[0]).toBe('r1')
  })

  it('🛑 two unlabelled sections are refused, not guessed', () => {
    const m = matchMultiTeamOffer({
      rosters: ROSTERS,
      viewerRosterId: 'r1',
      read: read([
        { name: null, receives: [{ type: 'player', name: 'Dallas Goedert', position: 'TE' }] },
        { name: null, receives: [{ type: 'player', name: 'Rico Dowdle', position: 'RB' }] },
        { name: 'RhhNiner', receives: [{ type: 'player', name: 'James Cook', position: 'RB' }] },
      ]),
    })
    expect(m).toEqual({ ok: false, reason: { code: 'unplaced' } })
  })

  it('a pick two teams hold is placed by its original owner, else listed to add by hand', () => {
    const base = [
      { name: 'TheCiege24', receives: [{ type: 'pick' as const, year: 2027, round: 1, originalOwner: 'Dysfunctional Texans' }] },
      { name: 'peteshabam', receives: [{ type: 'player' as const, name: 'Rico Dowdle', position: 'RB' }] },
      { name: 'RhhNiner', receives: [{ type: 'player' as const, name: 'James Cook', position: 'RB' }] },
    ]
    const withOwner = matchMultiTeamOffer({ rosters: ROSTERS, viewerRosterId: 'r1', read: read(base) })
    expect(withOwner.ok && withOwner.assets[0]).toMatchObject({ kind: 'pick', from: 'r2', pickId: 'k3' })
    const noOwner = matchMultiTeamOffer({
      rosters: ROSTERS,
      viewerRosterId: 'r1',
      read: read([{ ...base[0]!, receives: [{ type: 'pick', year: 2027, round: 1, originalOwner: null }] }, base[1]!, base[2]!]),
    })
    expect(noOwner.ok && noOwner.unmatched).toEqual(['2027 round 1'])
  })

  it('a player on no roster in the deal is listed, never swapped for a lookalike', () => {
    const m = matchMultiTeamOffer({
      rosters: ROSTERS,
      viewerRosterId: 'r1',
      read: read([
        { name: 'TheCiege24', receives: [{ type: 'player', name: 'Malik Washington', position: 'WR' }] },
        { name: 'peteshabam', receives: [{ type: 'player', name: 'Rico Dowdle', position: 'RB' }] },
        { name: 'RhhNiner', receives: [{ type: 'player', name: 'James Cook', position: 'RB' }] },
      ]),
    })
    expect(m.ok && m.unmatched).toEqual(['Malik Washington'])
  })

  it('two teams go to the 2-team matcher; the count says so', () => {
    const two = read([
      { name: 'TheCiege24', receives: [] },
      { name: 'peteshabam', receives: [{ type: 'player', name: 'James Cook', position: 'RB' }] },
    ])
    expect(offerTeamCount(two)).toBe(2)
    expect(matchMultiTeamOffer({ rosters: ROSTERS, viewerRosterId: 'r1', read: two })).toEqual({ ok: false, reason: { code: 'team_count', count: 2 } })
  })
})

describe('the 3–4 team builder', () => {
  const initial = {
    teamIds: ['r1', 'r2', 'r3'],
    assets: [
      { key: 'player:21', kind: 'player' as const, from: 'r2', to: 'r1', label: 'Dallas Goedert', value: 1200 },
      { key: 'player:31', kind: 'player' as const, from: 'r3', to: 'r2', label: 'Rico Dowdle', value: 1000 },
      { key: 'player:12', kind: 'player' as const, from: 'r1', to: 'r3', label: 'Garrett Wilson', value: 3813 },
    ],
  }

  it('a letter for every team, the verdict, and the link out', () => {
    render(<MultiTeamTradeBuilder rosters={ROSTERS} viewerRosterId="r1" initial={initial} sendHref="https://sleeper.example/trade" platformLabel="Sleeper" />)
    const rows = screen.getAllByTestId('multi-team-grade-row').map((r) => r.textContent)
    // peteshabam gets 1,000 for 1,200: −17%, a D. (Exactly −25% would be an F — the bands are shared.)
    expect(rows).toEqual(['FYou get 1,200 for 3,813', 'Dpeteshabam gets 1,000 for 1,200', 'ARhhNiner gets 3,813 for 1,000'])
    expect(screen.getByTestId('multi-team-verdict').textContent).toBe('RhhNiner comes out ahead')
    expect(screen.getByText(/League value only/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Send it in Sleeper/ }).getAttribute('href')).toBe('https://sleeper.example/trade')
  })

  it('changing who gets an asset regrades at once', () => {
    render(<MultiTeamTradeBuilder rosters={ROSTERS} viewerRosterId="r1" initial={initial} />)
    fireEvent.change(screen.getByLabelText('Who gets Garrett Wilson'), { target: { value: 'r2' } })
    expect(screen.getByTestId('multi-team-verdict').textContent).toBe('Every team has to send something and get something before the trade can be graded.')
  })

  it('search adds an asset from that team, to the next team round the table', () => {
    render(<MultiTeamTradeBuilder rosters={ROSTERS} viewerRosterId="r1" initial={{ teamIds: ['r1', 'r2', 'r3'], assets: [] }} />)
    fireEvent.change(screen.getByLabelText('Add a player or pick you send'), { target: { value: 'cook' } })
    fireEvent.click(screen.getByRole('button', { name: /James Cook/ }))
    expect((screen.getByLabelText('Who gets James Cook') as HTMLSelectElement).value).toBe('r2')
    // The second team's asset goes to the third, not back to the first: a fresh deal fans out.
    fireEvent.change(screen.getByLabelText('Add a player or pick peteshabam sends'), { target: { value: 'goedert' } })
    fireEvent.click(screen.getByRole('button', { name: /Dallas Goedert/ }))
    expect((screen.getByLabelText('Who gets Dallas Goedert') as HTMLSelectElement).value).toBe('r3')
  })

  it('a team that leaves takes its assets with it; a fifth team is refused', () => {
    render(<MultiTeamTradeBuilder rosters={[...ROSTERS, roster('r5', 'Extra', [])]} viewerRosterId="r1" initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fitzy37' }))
    fireEvent.click(screen.getByRole('button', { name: 'Extra' }))
    expect(screen.getByText('A trade here has at most 4 teams.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'RhhNiner' }))
    const left = screen.getAllByTestId('multi-team-asset').map((li) => li.textContent)
    expect(left).not.toContainEqual(expect.stringContaining('Rico Dowdle'))
    // What was going TO the team that left goes too — it cannot point at a team no longer in the deal.
    expect(left).not.toContainEqual(expect.stringContaining('Garrett Wilson'))
  })

  it('Spanish, and never «waiver»', () => {
    lang.value = 'es'
    render(<MultiTeamTradeBuilder rosters={ROSTERS} viewerRosterId="r1" initial={initial} sendHref="#" platformLabel="Sleeper" />)
    const rows = screen.getAllByTestId('multi-team-grade-row').map((r) => r.textContent)
    expect(rows[0]).toContain('Recibes')
    expect(rows[1]).toContain('peteshabam recibe')
    expect(screen.getByTestId('multi-team-verdict').textContent).toBe('RhhNiner sale ganando')
    expect(screen.getByText(/Envíalo en Sleeper/)).toBeTruthy()
    for (const v of Object.values(multiTeamTradeMessages.es!)) if (typeof v === 'string') expect(v.toLowerCase()).not.toContain('waiver')
    expect(Object.keys(multiTeamTradeMessages.es!).sort()).toEqual(Object.keys(multiTeamTradeMessages.en).sort())
  })
})

describe('the Trades screen offers 2 or 3–4 teams', () => {
  const tc = readFileSync(join(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'), 'utf8')
  it('a switch under Create a trade, and the builder in 3–4 team mode', () => {
    expect(tc).toContain('data-testid="trade-create-mode"')
    expect(tc).toContain("{tradeMode === 'multi' && rosterData && !props.embedded ? (")
    expect(tc).toContain('<MultiTeamTradeBuilder')
  })
  it('a screenshot with 3 or more teams goes to the 3–4 team matcher; 2 stay on the 2-team one', () => {
    expect(tc).toContain('if (offerTeamCount(j.read) >= 3) {')
    expect(tc).toContain("setTradeMode('multi')")
    expect(tc).toContain('const m = matchOfferToRosters({ read: j.read, rosters: rosterData.rosters, viewerRosterId: rosterData.viewerTeamRosterId })')
  })
})
