import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ZombieTurnOverlay } from '@/components/zombie/ZombieTurnOverlay'
import { ZombieBashingCard } from '@/components/zombie/ZombieBashingCard'
import type { ZombieMatchupView } from '@/lib/zombie/zombieMatchupBoard'

const CTX = { reviveSerums: 3, serums: 1, lossToZombieInfects: true, zombieTradeBlocked: true }
const TURNED = { kind: 'turned' as const, week: 3, opponentName: 'Rotters', myScore: 900, opponentScore: 1000, key: 'turned:3' }

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('ZombieTurnOverlay', () => {
  it('announces the turn with the real numbers, then never again once dismissed', () => {
    const { unmount } = render(<ZombieTurnOverlay leagueId="L1" moment={TURNED} ctx={CTX} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText("Rotters got you, 1,000 to 900. You're a Zombie now.")).toBeTruthy()
    expect(screen.getByText('Collect 3 serums to come back as a Survivor — you have 1.')).toBeTruthy()
    expect(screen.getByText("You keep your roster and your points. Zombies can't trade.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Join the horde' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    render(<ZombieTurnOverlay leagueId="L1" moment={TURNED} ctx={CTX} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a new moment even after an old one was seen', () => {
    window.localStorage.setItem('af_zombie_turn_seen_L1', 'turned:2')
    render(<ZombieTurnOverlay leagueId="L1" moment={TURNED} ctx={CTX} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes on Escape', () => {
    render(<ZombieTurnOverlay leagueId="L1" moment={TURNED} ctx={CTX} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem('af_zombie_turn_seen_L1')).toBe('turned:3')
  })

  it('never names a hidden infector', () => {
    render(<ZombieTurnOverlay leagueId="L1" moment={{ ...TURNED, opponentName: null }} ctx={CTX} />)
    expect(screen.getByText("The infection got you, 1,000 to 900. You're a Zombie now.")).toBeTruthy()
  })

  it('shows nothing without a moment', () => {
    render(<ZombieTurnOverlay leagueId="L1" moment={null} ctx={CTX} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

const RULES = { bashingThreshold: 128, maulingThreshold: 211, bashShare: 0.25, maulShare: 0.5 }
const view = (over: Partial<ZombieMatchupView>): ZombieMatchupView => ({
  id: 'm1',
  home: { rosterId: 'A', name: 'Brain Drain', status: 'Survivor', score: 1300 },
  away: { rosterId: 'B', name: 'Rotters', status: 'Zombie', score: 1000 },
  final: true,
  margin: 300,
  leader: 'home',
  atRisk: null,
  outcome: { kind: 'mauling', final: true },
  transfer: { fromRosterId: 'B', toRosterId: 'A', amount: 500 },
  mySide: null,
  ...over,
})

describe('ZombieBashingCard', () => {
  it("states the engine's transfer for a final mauling, with the share", () => {
    render(<ZombieBashingCard m={view({})} rules={RULES} />)
    expect(screen.getByText('Mauled!')).toBeTruthy()
    expect(screen.getByText('Rotters hands 500 Outbreak Points to Brain Drain — 50% of their week.')).toBeTruthy()
    expect(screen.getByText('Bash 128')).toBeTruthy()
    expect(screen.getByText('Maul 211')).toBeTruthy()
  })

  it('an infection moves the whole week', () => {
    render(
      <ZombieBashingCard
        m={view({ margin: 100, outcome: { kind: 'infection', final: true }, transfer: { fromRosterId: 'B', toRosterId: 'A', amount: 1000 } })}
        rules={RULES}
      />,
    )
    expect(screen.getByText('Rotters turned — their whole week (1,000) goes to Brain Drain.')).toBeTruthy()
  })

  it('before the week ends it says what is on pace — and promises no item or loot', () => {
    const { container } = render(
      <ZombieBashingCard m={view({ final: false, margin: 150, outcome: { kind: 'bashing', final: false }, transfer: null })} rules={RULES} />,
    )
    expect(screen.getByText('Brain Drain is on pace for a bashing — 128+ when the week ends.')).toBeTruthy()
    expect(container.textContent).not.toMatch(/loot|serum|knife|weapon/i)
  })

  it('a close final moves nothing', () => {
    render(<ZombieBashingCard m={view({ margin: 20, outcome: null, transfer: null })} rules={RULES} />)
    expect(screen.getByText('Final. No blowout, so no points change hands.')).toBeTruthy()
  })
})
