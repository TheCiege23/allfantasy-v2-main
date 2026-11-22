import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { ChimmyReceipt, DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'
import { savedLines, savedMargin } from '@/components/core-app/screens/AfSavedShare'

const tip = (over: Partial<ChimmyReceipt> = {}): ChimmyReceipt => ({
  id: 'g26:2026:7:in:out',
  leagueId: 'g26',
  leagueName: 'Guilly League 26',
  season: 2026,
  week: 7,
  slot: null,
  recommended: { name: 'Tyler Allgeier', points: 14.2 },
  instead: { name: 'Jeremiyah Love', points: 0 },
  followed: 'yes',
  call: 'right',
  href: '/core/my-team?league=g26',
  confidencePct: null,
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [],
  tooEarly: 0,
  uncoveredLeagues: 0,
  afTips: [tip()],
  ...over,
})

describe('ReceiptsCard — AF swap tips', () => {
  it('says AF said it — not Chimmy — with both players\' points and the verdict', () => {
    const { container } = render(<ReceiptsCard data={data()} />)
    expect(screen.getByRole('link', { name: 'AF said start Tyler Allgeier over Jeremiyah Love' })).toBeTruthy()
    expect(screen.getByText(/Jeremiyah Love 0\.0 — AF was right/)).toBeTruthy()
    expect(container.querySelector('[data-kind="af-tip"]')).toBeTruthy()
    expect(container.querySelector('[data-kind="chimmy"]')).toBeNull()
  })

  it('offers "AF saved me" only for a tip you followed that came good', () => {
    const { rerender } = render(<ReceiptsCard data={data()} />)
    expect(screen.queryAllByRole('button', { name: 'Share' }).length).toBe(1)
    rerender(<ReceiptsCard data={data({ afTips: [tip({ followed: 'no' })] })} />)
    expect(screen.queryAllByRole('button', { name: 'Share' }).length).toBe(0)
    rerender(<ReceiptsCard data={data({ afTips: [tip({ call: 'wrong' })] })} />)
    expect(screen.queryAllByRole('button', { name: 'Share' }).length).toBe(0)
  })
})

describe('the AF saved me card', () => {
  it('says the margin and both lines', () => {
    const t = { recommended: { name: 'Tyler Allgeier', points: 14.2 }, instead: { name: 'Jeremiyah Love', points: 0 }, leagueName: 'G26', week: 7 }
    expect(savedMargin(t)).toBe(14.2)
    expect(savedLines(t, false)).toEqual({
      headline: 'AllFantasy saved me +14.2 pts',
      detail: 'Tyler Allgeier 14.2 vs Jeremiyah Love 0.0',
      footer: 'G26 · week 7 · allfantasy.ai',
    })
    expect(savedLines(t, true).headline).toBe('AllFantasy me salvó +14.2 pts')
  })
})
