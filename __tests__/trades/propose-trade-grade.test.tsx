/**
 * "Propose a Trade" shows THE grade (2026-09-28): on each suggested package (in place of the
 * suggester's own "N% value match") and on the deal as composed, before it is sent.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  createGrader: vi.fn(),
  gradeDeal: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.member }))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: h.createGrader, gradeDeal: h.gradeDeal }))

import {
  composerAssetsFromPackage,
  composerGradeInputs,
  gradeProposalPackages,
  suggestionGradeFrom,
} from '@/lib/league-trade-engine/proposalPackageGrades'
import { ComposerGradeLine } from '@/app/league/[leagueId]/tabs/ComposerGradeLine'
import { composerSide, reasonWithoutValueGap } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'
import { POST } from '@/app/api/leagues/[leagueId]/trades/grade-preview/route'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const GRADED = { graded: true as const, letter: 'D' as const, partnerLetter: 'B' as const, label: 'Slightly favors opponent', giveValue: 6100, getValue: 5200 }

describe('composer grade inputs', () => {
  it('players by id and name, picks by season and round, FAAB by amount — an unplaceable pick is named, never zero', () => {
    expect(
      composerGradeInputs([
        { kind: 'player', id: '6813', name: 'Travis Kelce' },
        { kind: 'pick', season: 2027, round: 1, label: '2027 1st' },
        { kind: 'pick', season: null, round: 2, label: 'a 2nd' },
        { kind: 'faab', amount: 15 },
        { kind: 'faab', amount: 0 },
      ]),
    ).toEqual({
      assets: [
        { kind: 'player', playerId: '6813', name: 'Travis Kelce' },
        { kind: 'pick', year: 2027, round: 1, label: '2027 1st' },
        { kind: 'faab', amount: 15 },
      ],
      unpriceable: ['a 2nd'],
    })
  })

  it('a suggested package side reads its picks from the rosters by pickId', () => {
    const picks = new Map([['p1', { season: 2027, round: 1, label: '2027 1st (own)' }]])
    expect(
      composerAssetsFromPackage(
        [
          { kind: 'pick', id: 'p1', name: '2027 1st', value: 900, position: null, amount: null, itemType: 'future_pick' },
          { kind: 'faab', id: 'f', name: 'FAAB', value: null, position: null, amount: 10, itemType: 'faab' },
        ],
        picks,
      ),
    ).toEqual([
      { kind: 'pick', season: 2027, round: 1, label: '2027 1st (own)' },
      { kind: 'faab', amount: 10 },
    ])
  })
})

describe('gradeProposalPackages', () => {
  const pkg = (id: string) => ({
    id,
    send: [{ kind: 'player' as const, id: 'a', name: 'A', value: 1, position: 'RB', amount: null, itemType: 'player' as const }],
    receive: [{ kind: 'player' as const, id: 'b', name: 'B', value: 1, position: 'WR', amount: null, itemType: 'player' as const }],
    sendValue: 1,
    receiveValue: 1,
    fairness: 91,
    acceptanceLikelihood: null,
    reason: 'r',
  })

  it('grades only the packages shown, from the viewer side (send = give), and a failure costs one letter', async () => {
    const suggestions = [{ packages: [pkg('1'), pkg('2')] }, { packages: [pkg('3')] }]
    const grade = vi.fn(async (give: { assets: Array<{ name?: string }> }) => {
      if (grade.mock.calls.length === 2) throw new Error('boom')
      expect(give.assets[0]?.name).toBe('A')
      return { ...GRADED, percentDiff: 0, sideAdvantage: 'opponent', action: 'counter', recommendation: '', giveMarket: 0, getMarket: 0, basis: '', scoringApplied: false, needApplied: false, needGap: null, lines: [], moves: [] } as never
    })
    await gradeProposalPackages({ suggestions, picks: new Map(), grade, limit: 2 })
    expect(grade).toHaveBeenCalledTimes(2)
    expect(suggestions[0]!.packages[0]!.grade).toEqual(GRADED)
    expect(suggestions[0]!.packages[1]!.grade).toBeNull()
    expect('grade' in suggestions[1]!.packages[0]!).toBe(false)
  })

  it('a withheld grade keeps its reason', () => {
    expect(suggestionGradeFrom({ graded: false, reason: 'No values.', basis: null } as never)).toEqual({ graded: false, reason: 'No values.' })
  })
})

describe('composer helpers', () => {
  it('cuts only the value-gap clause from a graded package’s reason', () => {
    expect(
      reasonWithoutValueGap(
        "Bijan Robinson adds depth at RB; the package stays within 9% of the priced value, avoids unnecessary damage to your scarce positions, and addresses Jordan's roster.",
      ),
    ).toBe("Bijan Robinson adds depth at RB; avoids unnecessary damage to your scarce positions, and addresses Jordan's roster.")
  })

  it('builds a composed side from the checked players, picks and FAAB', () => {
    const roster = {
      players: [{ id: '6813', name: 'Travis Kelce' }],
      picks: [{ pickId: 'p1', season: 2027, round: 1, label: '2027 1st' }],
    } as never
    expect(composerSide(roster, new Set(['6813']), new Set(['p1']), '12')).toEqual([
      { kind: 'player', id: '6813', name: 'Travis Kelce' },
      { kind: 'pick', season: 2027, round: 1, label: '2027 1st' },
      { kind: 'faab', amount: 12 },
    ])
  })
})

describe('ComposerGradeLine', () => {
  it('draws your letter, theirs, the label and the league values', () => {
    render(<ComposerGradeLine grade={GRADED} partnerName="Jordan" />)
    expect(screen.getByTestId('composer-grade').textContent).toBe(
      'Grade: You D · Jordan B — Slightly favors opponentYou get 5,200 for 6,100 in league value',
    )
  })

  it('a withheld grade says why with no letter; none draws nothing', () => {
    const { container, rerender } = render(<ComposerGradeLine grade={{ graded: false, reason: 'No values.' }} />)
    expect(screen.getByTestId('composer-grade-withheld').textContent).toBe('Not graded: No values.')
    rerender(<ComposerGradeLine grade={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('POST /api/leagues/[leagueId]/trades/grade-preview', () => {
  const call = (body: unknown) =>
    POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ leagueId: 'L1' }) })

  beforeEach(() => {
    h.session.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    h.member.mockReset().mockResolvedValue({ ok: true })
    h.createGrader.mockReset().mockResolvedValue({ grader: true })
    h.gradeDeal.mockReset().mockResolvedValue({ ...GRADED })
  })

  it('refuses a signed-out caller and a non-member before grading anything', async () => {
    h.session.mockResolvedValue(null)
    expect((await call({ give: [], get: [] })).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.member.mockResolvedValue({ ok: false, status: 403 })
    expect((await call({ give: [], get: [] })).status).toBe(403)
    expect(h.createGrader).not.toHaveBeenCalled()
  })

  it('refuses malformed assets, and asks for both sides before grading', async () => {
    expect((await call({ give: [{ kind: 'player' }], get: [] })).status).toBe(400)
    const empty = await (await call({ give: [], get: [{ kind: 'faab', amount: 5 }] })).json()
    expect(empty.grade).toEqual({ graded: false, reason: 'Add something to both sides to see the grade.' })
    expect(h.gradeDeal).not.toHaveBeenCalled()
  })

  it('grades the composed deal from the viewer’s side on the league’s own grader', async () => {
    const res = await call({ give: [{ kind: 'player', id: '6813', name: 'Travis Kelce' }], get: [{ kind: 'pick', season: 2027, round: 1, label: '2027 1st' }] })
    expect(await res.json()).toEqual({ grade: GRADED })
    expect(h.createGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
    expect(h.gradeDeal).toHaveBeenCalledWith(
      { grader: true },
      {
        give: { assets: [{ kind: 'player', playerId: '6813', name: 'Travis Kelce' }], unpriceable: [] },
        get: { assets: [{ kind: 'pick', year: 2027, round: 1, label: '2027 1st' }], unpriceable: [] },
        viewerSide: true,
      },
    )
  })
})

describe('wiring', () => {
  const modal = code('app/league/[leagueId]/tabs/ProposeTradeModal.tsx')
  const rosters = code('app/api/leagues/[leagueId]/trades/rosters/route.ts')

  it('the composer asks for the composed deal’s grade and shows "% value match" only without one', () => {
    expect(modal).toMatch(/\/trades\/grade-preview/)
    expect(modal).toMatch(/proposal\.grade \? reasonWithoutValueGap\(proposal\.reason\) : `\$\{proposal\.fairness\}% value match/)
    expect(modal).toMatch(/Three-team trades aren&apos;t graded\./)
  })

  it('the rosters route grades the composer’s packages only when it sends them, bounded', () => {
    expect(rosters).toMatch(/if \(depthOpen && suggestions\.length > 0\)[\s\S]{0,200}gradeProposalPackages\(/)
    expect(rosters).toMatch(/limit: GRADED_COMPOSER_PACKAGES/)
  })
})
