/**
 * 11c — `IntegrityFlagCard` reads its evidence out of `IntegrityFlag.evidenceJson`.
 *
 * ⚠ THIS SUITE EXISTS BECAUSE PRODUCTION HAS NO DATA TO CHECK AGAINST. Measured
 * while building this screen: `integrity_flags` holds **zero rows** across the
 * whole production database, so neither engine has ever produced a flag a person
 * has seen. The rendering path therefore cannot be verified by looking at the
 * app — every claim below is asserted against the exact `CollusionEvidence` /
 * `TankingEvidence` shapes the engines construct in
 * `lib/integrity/CollusionDetectionEngine.ts` and `TankingDetectionEngine.ts`.
 *
 * The behaviours worth protecting are the ones where a wrong render is an
 * accusation: promoting a frequency signal into an actionable card, or drawing a
 * one-sided trade comparison that reads as "this manager gave nothing away".
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import IntegrityFlagCard, { type IntegrityFlagRow } from '@/components/commish/IntegrityFlagCard'

function flag(over: Partial<IntegrityFlagRow> = {}): IntegrityFlagRow {
  return {
    id: 'flag-1',
    flagType: 'collusion',
    severity: 'high',
    status: 'open',
    summary: 'Trade value imbalance detected (63%). Manual review recommended.',
    aiConfidence: 0.71,
    tradeTransactionId: 'trade-1',
    affectedTeamNames: ['Punt Gods', 'Fourth & Long'],
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    evidenceJson: {},
    ...over,
  }
}

/** Mirrors what `scanTradeForCollusion` writes into `evidenceJson`. */
const COLLUSION_EVIDENCE = {
  tradeTransactionId: 'trade-1',
  team1: { rosterId: 'r1', teamName: '@lex', wins: 2, losses: 9 },
  team2: { rosterId: 'r2', teamName: '@pav', wins: 3, losses: 8 },
  assetsTeam1Gave: [
    { name: 'B. Bowers', position: 'TE', estimatedValue: 30.1 },
    { name: '2027 1st', position: 'PICK', estimatedValue: 12.0 },
  ],
  assetsTeam2Gave: [{ name: 'R. Shaheed', position: 'WR', estimatedValue: 15.6 }],
  team1TotalValue: 42.1,
  team2TotalValue: 15.6,
  valueDifferential: 26.5,
  valueDifferentialPct: 62.9,
  priorTradesBetweenPair: 3,
  isPlayoffContender: { team1: false, team2: false },
  redFlags: ['Value differential ~63%'],
}

/** Mirrors what `scanWeekForTanking` writes into `evidenceJson`. */
const TANKING_EVIDENCE = {
  teamName: 'Punt Gods',
  currentRecord: { wins: 2, losses: 9 },
  weekNumber: 11,
  illegalOrSuspiciousStarters: [
    {
      slotPosition: 'FLEX',
      startedPlayerName: 'K. Walker',
      startedPlayerStatus: 'OUT',
      benchedBetterOption: 'bench',
      benchedBetterOptionProjection: 12.4,
      startedPlayerProjection: 0,
    },
  ],
  consecutiveWeeksWithSuspiciousLineup: 2,
  pointsLeftOnBench: 21.8,
  eliminatedFromPlayoffs: false,
  redFlags: [],
}

describe('IntegrityFlagCard — collusion', () => {
  it('renders both sides of the trade with their real assets and values', () => {
    render(<IntegrityFlagCard flag={flag({ evidenceJson: COLLUSION_EVIDENCE })} onDismiss={() => {}} />)
    expect(screen.getByText('B. Bowers, 2027 1st')).toBeTruthy()
    expect(screen.getByText('R. Shaheed')).toBeTruthy()
    expect(screen.getByText('value 42.1')).toBeTruthy()
    expect(screen.getByText('value 15.6')).toBeTruthy()
  })

  it('states that both managers are eliminated when the evidence says so', () => {
    render(<IntegrityFlagCard flag={flag({ evidenceJson: COLLUSION_EVIDENCE })} />)
    expect(screen.getByText('Both managers are eliminated from playoff contention.')).toBeTruthy()
  })

  it('counts the repeat trade inclusively — 3 prior trades is the 4th', () => {
    render(<IntegrityFlagCard flag={flag({ evidenceJson: COLLUSION_EVIDENCE })} />)
    expect(screen.getByText(/4th trade between this pair/)).toBeTruthy()
  })

  it('shows confidence as a percentage of the stored 0-1 float', () => {
    render(<IntegrityFlagCard flag={flag({ evidenceJson: COLLUSION_EVIDENCE, aiConfidence: 0.71 })} />)
    expect(screen.getByText(/Confidence 71%/)).toBeTruthy()
  })

  it('offers an escalation, a message path and Dismiss — never Dismiss alone', () => {
    render(
      <IntegrityFlagCard
        flag={flag({ evidenceJson: COLLUSION_EVIDENCE })}
        onEscalate={() => {}}
        onMessage={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Open review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Message both' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('says where a trade is actually reversed, so "Open review" is not mistaken for an undo', () => {
    render(<IntegrityFlagCard flag={flag({ evidenceJson: COLLUSION_EVIDENCE })} onEscalate={() => {}} />)
    expect(screen.getByText(/Reversing a trade happens in league settings/)).toBeTruthy()
  })

  /**
   * Build rule 3. A repeat-partner flag carries no priced sides, so it must not
   * present as an actionable accusation.
   */
  it('renders a frequency-only flag as informational with no action row', () => {
    render(
      <IntegrityFlagCard
        flag={flag({
          id: 'flag-2',
          severity: 'medium',
          summary: 'Repeated trade concentration with the same manager (4 recent trades).',
          evidenceJson: { priorTradesBetweenPair: 3, redFlags: ['Repeated trades between same managers this season'] },
        })}
        onEscalate={() => {}}
        onMessage={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Open review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    expect(screen.getByText(/Frequency alone is not proof/)).toBeTruthy()
  })

  /**
   * A half-resolved trade is the realistic failure: `valueOffers` prices what it
   * can and returns nothing for a piece it cannot identify. One filled column
   * beside an empty one reads as a far stronger accusation than the data supports.
   */
  it('draws no side-by-side comparison when only one side priced', () => {
    render(
      <IntegrityFlagCard
        flag={flag({
          evidenceJson: { ...COLLUSION_EVIDENCE, assetsTeam2Gave: [] },
        })}
        onEscalate={() => {}}
      />,
    )
    expect(screen.queryByText('B. Bowers, 2027 1st')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open review' })).toBeNull()
  })
})

describe('IntegrityFlagCard — tanking', () => {
  it('renders the stat grid from real evidence fields', () => {
    render(
      <IntegrityFlagCard
        flag={flag({ flagType: 'tanking', severity: 'medium', evidenceJson: TANKING_EVIDENCE, aiConfidence: 0.62 })}
        onEscalate={() => {}}
      />,
    )
    expect(screen.getByText('2 in a row')).toBeTruthy()
    expect(screen.getByText('21.8 pts')).toBeTruthy()
    expect(screen.getByText('2–9')).toBeTruthy()
  })

  /** `false` is decision-relevant here, so it renders rather than being dropped. */
  it('renders "Not yet" for a manager who is not eliminated', () => {
    render(<IntegrityFlagCard flag={flag({ flagType: 'tanking', evidenceJson: TANKING_EVIDENCE })} />)
    expect(screen.getByText('Not yet')).toBeTruthy()
  })

  it('assembles the lineup sentence from the first suspicious starter', () => {
    render(<IntegrityFlagCard flag={flag({ flagType: 'tanking', evidenceJson: TANKING_EVIDENCE })} />)
    expect(
      screen.getByText('Slot FLEX · started K. Walker (OUT) at 0.0 projected over a bench option at 12.4.'),
    ).toBeTruthy()
  })

  it('drops the projection clause rather than the whole sentence when projections are absent', () => {
    render(
      <IntegrityFlagCard
        flag={flag({
          flagType: 'tanking',
          evidenceJson: {
            ...TANKING_EVIDENCE,
            illegalOrSuspiciousStarters: [
              { slotPosition: 'FLEX', startedPlayerName: 'K. Walker', startedPlayerStatus: 'OUT' },
            ],
          },
        })}
      />,
    )
    expect(screen.getByText('Slot FLEX · started K. Walker (OUT).')).toBeTruthy()
  })

  it('names the manager in the message action when exactly one team is affected', () => {
    render(
      <IntegrityFlagCard
        flag={flag({ flagType: 'tanking', affectedTeamNames: ['@lex'], evidenceJson: TANKING_EVIDENCE })}
        onMessage={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Message @lex' })).toBeTruthy()
  })
})
