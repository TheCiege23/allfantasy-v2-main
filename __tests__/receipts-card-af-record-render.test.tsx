import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'
import type { LedgerRecordView } from '@/lib/chimmy-outcomes/ledgerRecord'

const record = (over: Partial<LedgerRecordView> = {}): LedgerRecordView => ({
  season: 2026,
  bench: { you: { right: 4, wrong: 1, same: 0, ratePct: 80 }, everyone: { right: 42, wrong: 18, same: 3, ratePct: 70, gainPerCall: 2.4 } },
  pickups: { you: { graded: 3, startable: 2, ratePct: null }, everyone: { graded: 50, startable: 21, ratePct: 42, vsDrop: 40, beatDrop: 28 } },
  trades: [
    { letter: 'A', n: 36, netPerWeek: 4.1 },
    { letter: 'F', n: 22, netPerWeek: -3 },
  ],
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({ trades: [], tooEarly: 0, uncoveredLeagues: 0, afRecord: record(), ...over })

describe('ReceiptsCard — AllFantasy’s record', () => {
  it('states the bench check, the #1 pickup and the trade grades in numbers', () => {
    const { container } = render(<ReceiptsCard data={data()} />)
    const text = (k: string) => container.querySelector(`[data-kind="${k}"]`)?.textContent ?? ''
    expect(text('af-record-bench')).toBe('My Team’s bench check — you: 4 right, 1 wrong (80%) · everyone: 70% right over 60 calls, +2.4 pts per call')
    expect(text('af-record-pickups')).toBe(
      'Waiver panel’s #1 pickup — you: 2 of 3 averaged 10+ PPR over 3 weeks · everyone: 21 of 50 averaged 10+ PPR over 3 weeks (42%), 28 of 40 beat the suggested drop',
    )
    expect(text('af-record-trades')).toBe('Trade grades, against what the players scored since (redraft, PPR per week): A +4.1 (36 deals) · F −3.0 (22 deals)')
  })

  it('an unearned everyone-rate is a count, and absent parts render nothing', () => {
    const { container } = render(
      <ReceiptsCard data={data({ afRecord: record({ bench: { you: null, everyone: { right: 5, wrong: 3, same: 0, ratePct: null, gainPerCall: null } }, pickups: null, trades: null }) })} />,
    )
    expect(container.querySelector('[data-kind="af-record-bench"]')?.textContent).toBe('My Team’s bench check — everyone: 8 calls so far')
    expect(container.querySelector('[data-kind="af-record-pickups"]')).toBeNull()
    expect(container.querySelector('[data-kind="af-record-trades"]')).toBeNull()
  })

  it('a malformed record renders no section (and, alone, no card)', () => {
    const { container } = render(<ReceiptsCard data={data({ afRecord: { bench: { you: { right: 'x' } } } as never })} />)
    expect(container.querySelector('[data-kind="af-record"]')).toBeNull()
  })
})
