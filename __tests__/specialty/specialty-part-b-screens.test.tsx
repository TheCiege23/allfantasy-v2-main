// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ZombieInfectionNight } from '@/components/league/specialty/zombie/ZombieInfectionNight'
import { SalaryCapBidCheck } from '@/components/league/specialty/salary/SalaryCapBidCheck'
import { DevyPromotionMoment } from '@/components/league/specialty/devy/DevyPromotionMoment'
import type { ZombieSummary } from '@/components/zombie/types'
import type { SalaryCapSummary } from '@/components/salary-cap/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

function zombieSummary(over: Partial<ZombieSummary> = {}): ZombieSummary {
  return {
    config: { whispererSelection: 'random', infectionLossToWhisperer: true, infectionLossToZombie: true, serumReviveCount: 3, zombieTradeBlocked: false },
    statuses: [
      { rosterId: 'me', status: 'Zombie' },
      { rosterId: 'o9', status: 'Zombie' },
      { rosterId: 'o6', status: 'Survivor' },
    ],
    whispererRosterId: null,
    survivors: ['o6'],
    zombies: ['me', 'o9'],
    week: 6,
    movementWatch: [],
    rosterDisplayNames: { me: 'TheCiege', o9: 'Open Team 9', o6: 'Open Team 6' },
    myRosterId: 'me',
    myStatus: 'Zombie',
    league: { name: 'Gamma 2', sport: 'NFL', season: 2026, currentWeek: 6, totalWeeks: 17, status: 'active', backgroundTheme: 'graveyard_dawn', teamCount: 3 },
    weeklyBoard: [{ kind: 'infection', victimRosterId: 'me', infectorRosterId: 'o9', winnerScore: 112.9, loserScore: 108.4, amount: null } as never],
    myMatchup: { opponentRosterId: 'o9', opponentName: 'Open Team 9', opponentStatus: 'Zombie', myScore: 108.4, opponentScore: 112.9, final: true },
    turnMoment: { kind: 'turned', week: 6, opponentName: 'Open Team 9', myScore: 108.4, opponentScore: 112.9, key: 'k' },
    ...over,
  }
}

describe('Zombie infection night', () => {
  it('announces the turn and offers Replay, but no serum choice the engine does not have', () => {
    render(<ZombieInfectionNight summary={zombieSummary()} onBack={() => {}} />)
    expect(screen.getByText("You've been bitten")).toBeTruthy()
    expect(screen.getByTestId('specialty-replay')).toBeTruthy()
    expect(screen.queryByText(/use my serum/i)).toBeNull()
    expect(screen.getByText('Bitten')).toBeTruthy()
  })

  it('does not name an infector the server withheld', () => {
    const s = zombieSummary({
      myRosterId: 'o6',
      myStatus: 'Survivor',
      turnMoment: null,
      myMatchup: null,
      weeklyBoard: [{ kind: 'infection', victimRosterId: 'me', infectorRosterId: null } as never],
    })
    render(<ZombieInfectionNight summary={s} onBack={() => {}} />)
    expect(screen.getByText('by the infection')).toBeTruthy()
  })
})

function salarySummary(): SalaryCapSummary {
  return {
    config: {
      mode: 'dynasty', startupCap: 250, capGrowthPercent: 5, contractMinYears: 1, contractMaxYears: 4, rookieContractYears: 3,
      minimumSalary: 1, deadMoneyEnabled: true, deadMoneyPercentPerYear: 25, rolloverEnabled: true, rolloverMax: 25,
      extensionsEnabled: true, franchiseTagEnabled: true, startupDraftType: 'auction', futureDraftType: 'linear',
      auctionHoldback: 0, weightedLotteryEnabled: false, offseasonPhase: null,
    },
    ledger: { rosterId: 'r', capYear: 2026, totalCapHit: 231.6, deadMoneyHit: 6, rolloverUsed: 0, capSpace: 18.4 },
    futureProjection: [
      { capYear: 2026, capCeiling: 250, totalCapHit: 231.6, deadMoney: 6, projectedSpace: 18.4, contractCount: 10 },
      { capYear: 2027, capCeiling: 262.5, totalCapHit: 196, deadMoney: 0, projectedSpace: 66.5, contractCount: 8 },
    ],
    contracts: [], expiringCount: 0, extensionCandidatesCount: 0, tagCandidatesCount: 0, deadMoneyTotal: 6, rookieContractCount: 0, events: [], lottery: null,
  }
}

describe('Salary cap bid check', () => {
  it('turns red and blocks the bid once it goes over the cap', () => {
    render(<SalaryCapBidCheck summary={salarySummary()} onBack={() => {}} waiversHref="/w" />)
    expect(screen.getByText('Fits under the cap every year.')).toBeTruthy()
    const raise = screen.getByLabelText('Raise salary by $1')
    for (let i = 0; i < 12; i++) fireEvent.click(raise)
    expect(screen.getByText(/Over the cap in 2026/)).toBeTruthy()
    const cont = screen.getByTestId('salary-bid-continue') as HTMLButtonElement
    expect(cont.tagName).toBe('BUTTON')
    expect(cont.disabled).toBe(true)
  })
})

describe('Devy promotion day', () => {
  const item = {
    rightsId: 'r1', devyPlayerId: 'p1', name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', classLabel: 'Jr',
    draftEligibleYear: 2027, state: 'DECLARED', declared: true, production: 90, promotionEligible: false, promotedProPlayerId: null,
  }
  it('is a preview until the rights are promotion-eligible and mapped; taxi is not offered', () => {
    render(<DevyPromotionMoment leagueId="L" item={item} devySlots={{ used: 6, total: 6 }} proRoster={{ used: 22, total: 24 }} onBack={() => {}} onPromoted={() => {}} />)
    expect((screen.getByTestId('devy-promote') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Taxi squad/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
