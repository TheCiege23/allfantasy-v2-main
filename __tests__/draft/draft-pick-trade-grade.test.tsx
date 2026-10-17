/**
 * The live draft's pick-trade builder shows THE grade (2026-09-28) — for a rookie draft, where the
 * league's value chart prices the picks — and hides its three private verdict chips when it does.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  NOT_A_ROOKIE_DRAFT_REASON,
  draftPickGradeAsset,
  draftPickTradeGradeFrom,
  isRookieDraft,
  pickTierInRound,
} from '@/lib/live-draft-engine/draftPickTradeGrade'
import { DraftPickTradeGradeLine, readDraftPickTradeGrade } from '@/components/app/draft-room/DraftPickTradeGradeLine'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('isRookieDraft', () => {
  it('a rookie-labelled draft or a rookies-only pool is graded; a startup or redraft draft is not', () => {
    expect(isRookieDraft({ draftModeLabel: 'rookie', playerPool: 'all' })).toBe(true)
    expect(isRookieDraft({ draftModeLabel: null, playerPool: 'rookies_only' })).toBe(true)
    expect(isRookieDraft({ draftModeLabel: 'startup', playerPool: 'all' })).toBe(false)
    expect(isRookieDraft({ draftModeLabel: null, playerPool: 'all' })).toBe(false)
  })
})

describe('pickTierInRound', () => {
  it('reads WHEN the pick is made from the overall number, not which slot holds it', () => {
    // 12 teams, snake: slot 1 picks 1st in round 1 but 12th (last) in round 2 — overall 24.
    expect(pickTierInRound({ round: 1, overall: 1, slot: 1, teamCount: 12 })).toBe('early')
    expect(pickTierInRound({ round: 2, overall: 24, slot: 1, teamCount: 12 })).toBe('late')
    expect(pickTierInRound({ round: 1, overall: 6, slot: 6, teamCount: 12 })).toBe('mid')
    // No overall: falls back to the slot.
    expect(pickTierInRound({ round: 3, overall: null, slot: 11, teamCount: 12 })).toBe('late')
  })

  it('builds the grader input as this season’s pick with its round and tier', () => {
    expect(draftPickGradeAsset({ season: 2026, round: 2, overall: 14, slot: 2, teamCount: 12 })).toEqual({
      kind: 'pick',
      year: 2026,
      round: 2,
      tier: 'early',
      label: '2026 early round 2 (#14)',
    })
  })
})

describe('draftPickTradeGradeFrom / readDraftPickTradeGrade', () => {
  it('keeps the letters, label, values and recommendation of a graded view; a withheld one keeps its reason', () => {
    expect(
      draftPickTradeGradeFrom({ graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you', giveValue: 900, getValue: 1100, recommendation: 'Accept.' }),
    ).toEqual({ graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you', giveValue: 900, getValue: 1100, recommendation: 'Accept.' })
    expect(draftPickTradeGradeFrom({ graded: false, reason: 'No values.' })).toEqual({ graded: false, reason: 'No values.' })
  })

  it('the panel reader rejects malformed data', () => {
    expect(readDraftPickTradeGrade({ graded: true, letter: 'B' })).toBeNull()
    expect(readDraftPickTradeGrade({ graded: false, reason: '' })).toBeNull()
    expect(readDraftPickTradeGrade('B')).toBeNull()
    expect(readDraftPickTradeGrade({ graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON })).toEqual({ graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON })
  })
})

describe('DraftPickTradeGradeLine', () => {
  it('draws your letter, theirs, the label and the league values', () => {
    render(
      <DraftPickTradeGradeLine
        partnerName="Jordan"
        grade={{ graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you', giveValue: 900, getValue: 1100, recommendation: '' }}
      />,
    )
    expect(screen.getByTestId('draft-trade-grade').textContent).toBe(
      'League grade: You B · Jordan D — Slightly favors youYou get 1,100 for 900 in league value',
    )
  })

  it('a withheld grade says why, with no letter; no grade draws nothing', () => {
    const { container, rerender } = render(<DraftPickTradeGradeLine grade={{ graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON }} />)
    expect(screen.getByTestId('draft-trade-grade-withheld').textContent).toBe(`Not graded: ${NOT_A_ROOKIE_DRAFT_REASON}`)
    rerender(<DraftPickTradeGradeLine grade={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('wiring', () => {
  const route = code('app/api/leagues/[leagueId]/draft/trade-builder/analyze/route.ts')
  const root = code('components/app/draft-room/DraftPickTradePanelRoot.tsx')

  it('the route grades only a rookie draft, through the league grader, and returns the grade', () => {
    expect(route).toMatch(/const tradeGrade: DraftPickTradeGrade = isRookieDraft\(draftSession\)\s*\?\s*await gradeDeal\(/)
    expect(route).toMatch(/: \{ graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON \}/)
    expect(route).toMatch(/ok: true,\s*tradeGrade,/)
  })

  it('the AI is handed the grade as the verdict, not the private one, when there is a grade', () => {
    expect(route).toMatch(/If trade\.leagueGrade is present it is THE AllFantasy grade/)
    expect(route).toMatch(/tradeGrade\.graded\s*\?\s*\{\s*leagueGrade:/)
  })

  it('🛑 the panel hides the verdict, fairness and move-quality chips when the swap is graded', () => {
    expect(root).toMatch(/<DraftPickTradeGradeLine grade=\{builderAnalysis\.tradeGrade\}/)
    expect(root.match(/builderAnalysis\.tradeGrade\?\.graded \? null :/g)).toHaveLength(2)
  })
})
