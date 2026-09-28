/**
 * The dynasty trade analyzer shows THE grade (2026-09-27): the one engine's letter for each team, in
 * the league the viewer chose — and neither of the two private "Fairness" letters it printed before.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { gradeInputsFromAssetLabels, splitSideAssets } from '@/lib/decision-os/trade/tradeGradeInputs'
import { DynastyLeagueGrade } from '@/components/dynasty-trade/DynastyLeagueGrade'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('splitSideAssets', () => {
  it('splits the form’s " + " join, commas and a whole-word "and"', () => {
    expect(splitSideAssets('Josh Allen (QB) + Mark Andrews (TE)')).toEqual(['Josh Allen (QB)', 'Mark Andrews (TE)'])
    expect(splitSideAssets('Bijan Robinson, 2026 1st and 2027 2nd')).toEqual(['Bijan Robinson', '2026 1st', '2027 2nd'])
  })

  it('🛑 never splits inside a name (the old /,|and/i cut "Andrews" and "Brandon")', () => {
    expect(splitSideAssets('Brandon Aiyuk (WR)')).toEqual(['Brandon Aiyuk (WR)'])
    expect(splitSideAssets('Mark Andrews (TE)')).toEqual(['Mark Andrews (TE)'])
    expect(splitSideAssets('Brandon Aiyuk (WR) + Garrett Wilson (WR)')).toHaveLength(2)
  })
})

describe('gradeInputsFromAssetLabels', () => {
  it('strips the form’s position suffix from a player and reads picks with parsePickLabel', () => {
    const out = gradeInputsFromAssetLabels([
      { name: 'Josh Allen (QB)', type: 'player' },
      { name: '2026 1st', type: 'pick' },
      { name: '2027 Early 2nd', type: 'pick' },
      { name: '2027 2nd from Chiefs', type: 'pick' },
    ])
    expect(out.unpriceable).toEqual([])
    expect(out.assets).toEqual([
      { kind: 'player', name: 'Josh Allen' },
      { kind: 'pick', year: 2026, round: 1, label: '2026 1st' },
      { kind: 'pick', year: 2027, round: 2, tier: 'early', label: '2027 Early 2nd' },
      { kind: 'pick', year: 2027, round: 2, label: '2027 2nd from Chiefs' },
    ])
  })

  it('an unreadable pick is unpriceable — not searched for as a player — and FAAB is FAAB', () => {
    const out = gradeInputsFromAssetLabels([
      { name: '2026 first', type: 'pick' },
      { name: '$15 FAAB', type: null },
    ])
    expect(out.unpriceable).toEqual(['"2026 first"'])
    expect(out.assets).toEqual([{ kind: 'faab', amount: 15 }])
  })

  it('untyped text that carries a draft year is read as a pick', () => {
    expect(gradeInputsFromAssetLabels([{ name: '2028 late 1st' }]).assets).toEqual([
      { kind: 'pick', year: 2028, round: 1, tier: 'late', label: '2028 late 1st' },
    ])
  })
})

describe('DynastyLeagueGrade', () => {
  const graded = { grade: 'D', partnerGrade: 'B', gradeLabel: 'Slightly favors opponent', gradeWithheld: null, giveValue: 5900, getValue: 6000 }

  it('draws each team’s letter, the label and the league values Team A gets and sends', () => {
    render(<DynastyLeagueGrade tradeGrade={graded} teamAName="Hoovi" teamBName="Nicolodeon" leagueChosen leagueOptionCount={2} />)
    expect(screen.getByTestId('dynasty-grade').textContent).toBe(
      'League gradeDHooviBNicolodeonSlightly favors opponentHoovi gets 6,000 for 5,900 in league value',
    )
  })

  it('a withheld grade says why, with no letter — and how to get one when no league was chosen', () => {
    const withheld = { ...graded, grade: null, partnerGrade: null, gradeLabel: null, giveValue: null, getValue: null, gradeWithheld: 'No league is selected.' }
    const { rerender } = render(
      <DynastyLeagueGrade tradeGrade={withheld} teamAName="A" teamBName="B" leagueChosen={false} leagueOptionCount={3} />,
    )
    expect(screen.getByTestId('dynasty-grade-withheld').textContent).toMatch(/^Not graded: No league is selected\./)
    expect(screen.getByTestId('dynasty-grade-no-league-hint').textContent).toMatch(/Choose one of your leagues/)
    rerender(<DynastyLeagueGrade tradeGrade={withheld} teamAName="A" teamBName="B" leagueChosen leagueOptionCount={3} />)
    expect(screen.queryByTestId('dynasty-grade-no-league-hint')).toBeNull()
  })

  it('no grade in the response draws nothing', () => {
    const { container } = render(<DynastyLeagueGrade tradeGrade={null} teamAName="A" teamBName="B" leagueChosen={false} leagueOptionCount={0} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('wiring', () => {
  const route = code('app/api/dynasty-trade-analyzer/route.ts')
  const form = code('components/DynastyTradeForm.tsx')

  it('the route grades through the one engine, in a membership-checked league, from Team A’s side', () => {
    expect(route).toMatch(/resolveEvaluationLeagueId\(\{ suppliedLeagueId: gradeLeagueId \?\? null, userId \}\)/)
    expect(route).toMatch(/surface: 'dynasty-trade-analyzer'/)
    // Each list is what that team GETS: Team A gives B's list.
    expect(route).toMatch(/give: gradeInputsFromAssetLabels\(labelAssets\(gradeSideB,/)
    expect(route).toMatch(/get: gradeInputsFromAssetLabels\(labelAssets\(gradeSideA,/)
    // Both responses carry it — the AI-unavailable fallback too.
    expect(route.match(/tradeGrade: await tradeGradePayload\(\)/g)).toHaveLength(2)
  })

  it('the old in-name split is gone', () => {
    expect(route).not.toMatch(/split\(\/,\|and\/i\)/)
  })

  it('🛑 the form prints neither private "Fairness" letter, and sends the grade league separately', () => {
    expect(form).not.toMatch(/\{detVerdict\.fairnessGrade\}/)
    expect(form).not.toMatch(/\{sections\.valueVerdict\.fairnessGrade\}/)
    expect(form).not.toMatch(/\$\{detVerdict\.fairnessGrade\} fairness/)
    expect(form).toMatch(/\.\.\.\(gradeLeagueId \? \{ gradeLeagueId \} : \{\}\)/)
    // `leagueId` would switch on the context assembler's unchecked path; the form never sends it.
    expect(form).not.toMatch(/\bleagueId: /)
  })
})
