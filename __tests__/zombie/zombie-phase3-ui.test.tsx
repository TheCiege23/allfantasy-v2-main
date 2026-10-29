import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ send: vi.fn(async () => true) }))
vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'L1' }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }))
vi.mock('@/app/zombie/components/chimmy/useZombieDmCommand', () => ({
  useZombieDmCommand: () => ({ isSending: false, feedback: null, sendCommand: h.send }),
}))

import ZombieArmoryPage from '@/app/zombie/[leagueId]/items/page'
import { ZombieWhispererLair } from '@/components/zombie/ZombieWhispererLair'
import { shareMoment } from '@/components/zombie/ZombieTurnOverlay'

const RULES = { reviveThreshold: 3, serumMaxHold: 5, weaponShieldThreshold: 900, weaponAmbushThreshold: 1050, weaponAxeMargin: 90 }
const item = (id: string, itemType: string, over: Record<string, unknown> = {}) => ({
  id,
  itemType,
  itemLabel: itemType,
  isUsed: false,
  isExpired: false,
  acquiredAt: '2026-10-25T12:00:00Z',
  acquiredReason: null,
  activationState: 'ready',
  ...over,
})

let payload: Record<string, unknown> = {}
beforeEach(() => {
  h.send.mockClear()
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as never
})
afterEach(cleanup)

describe('The Armory', () => {
  it('shows weapons with how the engine awards them, and offers no way to spend one', async () => {
    payload = { items: [item('k1', 'weapon_knife'), item('b1', 'weapon_bomb')], teamStatus: 'Survivor', rules: RULES, history: [], resolution: null, isCommissionerView: false }
    const { container } = render(<ZombieArmoryPage />)
    await screen.findByTestId('armory-weapons')
    expect(screen.getByText('Score 900+ in a week')).toBeTruthy()
    expect(screen.getByText('Win a matchup by 90+')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Use via|Detonate|Protect Ally/i)
  })

  it('a Survivor holding a serum can register the shield — the one live weapon-side action', async () => {
    payload = { items: [item('s1', 'serum')], teamStatus: 'Survivor', rules: RULES, history: [], resolution: null, isCommissionerView: false }
    render(<ZombieArmoryPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Shield me this week' }))
    await waitFor(() => expect(h.send).toHaveBeenCalledWith('@Chimmy use serum protect myself'))
  })

  it('shows a registered shield instead of offering another', async () => {
    payload = { items: [item('s1', 'serum', { activationState: 'pending_activation', activatesAtWeek: 4 })], teamStatus: 'Survivor', rules: RULES, history: [], resolution: null, isCommissionerView: false }
    render(<ZombieArmoryPage />)
    expect(await screen.findByText(/Registered for week 4/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Shield me this week' })).toBeNull()
  })

  it('a Zombie with enough serums can revive; with too few is told how many more', async () => {
    payload = { items: [item('s1', 'serum'), item('s2', 'serum'), item('s3', 'serum')], teamStatus: 'Zombie', rules: RULES, history: [], resolution: null, isCommissionerView: false }
    render(<ZombieArmoryPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revive — spend 3 serums' }))
    await waitFor(() => expect(h.send).toHaveBeenCalledWith('@Chimmy revive'))
    cleanup()
    payload = { ...payload, items: [item('s1', 'serum')] }
    render(<ZombieArmoryPage />)
    expect(await screen.findByText('2 more to come back as a Survivor.')).toBeTruthy()
  })

  it("a commissioner looking at someone else's armory gets no actions", async () => {
    payload = { items: [item('s1', 'serum')], teamStatus: 'Survivor', rules: RULES, history: [], resolution: null, isCommissionerView: true }
    render(<ZombieArmoryPage />)
    await screen.findByTestId('armory-serums')
    expect(screen.queryByRole('button', { name: 'Shield me this week' })).toBeNull()
  })
})

describe('ZombieWhispererLair', () => {
  it('a secret Whisperer sees their horde and holdings, with no action to take', () => {
    const { container } = render(<ZombieWhispererLair isPublic={false} horde={['Rotters', 'Ghouls']} ambushes={3} />)
    expect(screen.getByText('Nobody knows you are the Whisperer. Keep it that way.')).toBeTruthy()
    expect(screen.getByText('Your horde · 2 turned')).toBeTruthy()
    expect(screen.getByText('Rotters')).toBeTruthy()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('shareMoment', () => {
  const MOMENT = { kind: 'turned' as const, week: 3, opponentName: 'Rotters', myScore: 1, opponentScore: 2, key: 'k' }
  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it("uses the device's share sheet with the league page — never an invite link", async () => {
    const share = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    expect(await shareMoment(MOMENT, 'L1', 'Tip-Off Outbreak')).toBe('shared')
    expect(share).toHaveBeenCalledWith({
      title: 'Zombie league',
      text: 'I turned in week 3 in Tip-Off Outbreak. The horde grows. 🧟',
      url: `${window.location.origin}/league/L1`,
    })
  })

  it('falls back to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await shareMoment(MOMENT, 'L1', null)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(`I turned in week 3. The horde grows. 🧟 ${window.location.origin}/league/L1`)
  })
})
