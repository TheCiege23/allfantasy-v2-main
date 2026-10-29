import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExileTokenProgress, ExileTokenToast, exileProgressLine } from '@/components/league/survivor/ExileTokens'
import { ExileTokenWallet } from '@/components/league/survivor/ExileTokenWallet'

const imgs = () => [...document.querySelectorAll('[role="img"] img')].map(img => img.getAttribute('src'))

beforeEach(() => { try { window.localStorage.clear() } catch { /* ignore */ } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('progress row', () => {
  it('fills coins up to the balance, then empty slots up to the return count, with a gold bar', () => {
    render(<ExileTokenProgress balance={2} required={3} cap={5} />)
    expect(imgs()).toEqual(['/survivor/exile/token-coin.svg', '/survivor/exile/token-coin.svg', '/survivor/exile/token-empty.svg'])
    expect(screen.getByText('1 more token to return to the game. You can hold up to 5.')).toBeTruthy()
    expect((document.querySelector('[aria-hidden="true"] > div') as HTMLElement).style.width).toBe('66.66666666666666%')
    // The count chip uses the simplified icon, never the full coin, at 16px.
    const icon = screen.getByText((_, el) => el?.textContent === '2 / 3' && el.tagName === 'SPAN').querySelector('img')
    expect(icon?.getAttribute('src')).toBe('/survivor/exile/token-icon.svg')
    expect(icon?.getAttribute('width')).toBe('16')
  })
  it('copy for none, some and enough', () => {
    expect(exileProgressLine(0, 3)).toBe('No tokens. Win your week to earn one.')
    expect(exileProgressLine(1, 3)).toBe('2 more tokens to return to the game.')
    expect(exileProgressLine(3, 3)).toBe('You have 3 tokens. You can return to the game.')
  })
  it('pops the newest coin in when a token was just earned', () => {
    render(<ExileTokenProgress balance={3} required={3} popLast />)
    expect(imgs()[2]).toBe('/survivor/exile/token-coin-earned.svg')
  })
})

describe('weekly result toasts', () => {
  it('token earned', () => {
    render(<ExileTokenToast result={{ id: 'e', week: 6, weeklyScore: 131.2, bossScore: 118.4, tokenEarned: 1, tokenWiped: false }} balance={2} required={3} />)
    expect(screen.getByText('Token earned · week 6')).toBeTruthy()
    expect(screen.getByText('You won Exile Island with 131.2')).toBeTruthy()
    expect(screen.getByText(/2 of 3 tokens. One more week/)).toBeTruthy()
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/survivor/exile/token-coin-earned.svg')
  })
  it('tokens wiped', () => {
    render(<ExileTokenToast result={{ id: 'w', week: 6, weeklyScore: 97, bossScore: 118.4, tokenEarned: 0, tokenWiped: true }} balance={0} required={3} />)
    expect(screen.getByText('Tokens wiped · week 6')).toBeTruthy()
    expect(screen.getByText('The Exile boss beat you 118.4 to 97.0')).toBeTruthy()
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/survivor/exile/token-coin-wiped.svg')
  })
  it('renders nothing for a week with no token change', () => {
    const { container } = render(<ExileTokenToast result={{ id: 'n', week: 6, weeklyScore: 90, bossScore: 80, tokenEarned: 0, tokenWiped: false }} balance={1} required={3} />)
    expect(container.textContent).toBe('')
  })
})

describe('wallet', () => {
  const payload = { user: { tokenBalance: 2, playerState: 'exile' }, returnRules: { enabled: true, week: 12, tokensRequired: 3, resolved: false, slots: 1 }, tokenCap: 5,
    latestResult: { id: 'entry-6', week: 6, weeklyScore: 131.2, bossScore: 118.4, tokenEarned: 1, tokenWiped: false } }
  it('shows the earned toast from the viewer\'s latest Exile week, the cap and the progress row; dismissal sticks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })))
    render(<ExileTokenWallet leagueId="league-1" />)
    expect(await screen.findByText('You won Exile Island with 131.2')).toBeTruthy()
    expect(screen.getByText('Cap 5')).toBeTruthy()
    expect(screen.getByText('Return at 3 tokens')).toBeTruthy()
    expect(screen.getByText(/1 more token to return to the game/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('You won Exile Island with 131.2')).toBeNull()
    cleanup()
    render(<ExileTokenWallet leagueId="league-1" />)
    expect(await screen.findByText(/1 more token to return/)).toBeTruthy()
    expect(screen.queryByText('You won Exile Island with 131.2')).toBeNull()
  })
})
