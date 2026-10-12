import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SurvivorVoteRevealScrolls, type RevealScroll } from '@/components/league/survivor/SurvivorVoteRevealScrolls'
import { ExileTokenWallet } from '@/components/league/survivor/ExileTokenWallet'
const scrolls: RevealScroll[] = [{ order:1, targetUserId:'a', targetName:'Manager A', status:'blocked_by_idol', isExtraVote:false },{ order:2,targetUserId:'b',targetName:'Manager B',status:'counts',isExtraVote:true }]
beforeEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(window, 'matchMedia', { configurable:true, value: () => ({ matches:true, addEventListener:vi.fn(),removeEventListener:vi.fn() }) }) })
describe('Published ceremony and real token rules', () => {
  it('keeps the parchment sealed until opened, then shows anonymous cancelled and extra votes', () => {
    render(<SurvivorVoteRevealScrolls scrolls={scrolls} eliminatedName="Manager B" isTie={false} tiePhase={null} />)
    expect(screen.queryByText('Manager A')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Break the seal'}))
    expect(screen.getByText('Idol · Does not count')).toBeTruthy()
    expect(screen.getByText(/Extra vote/)).toBeTruthy()
    expect(screen.getByText('Voted out')).toBeTruthy()
    expect(screen.queryByText(/voter/i)).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Replay'}))
    expect(screen.queryByText('Manager A')).toBeNull()
  })
  it('uses the saved deadline and minimum without promising an automatic return', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => ({ ok:true,json:async () => ({ user:{tokenBalance:5,playerState:'exile'},returnRules:{enabled:true,week:12,tokensRequired:4,resolved:false,slots:1} }) })))
    render(<ExileTokenWallet leagueId="league-1" />)
    expect(await screen.findByText(/One manager returns after Week 12/)).toBeTruthy()
    expect(screen.getByText(/You must still lead/)).toBeTruthy()
    expect(screen.queryByText(/cap|boss|convert/i)).toBeNull()
  })
})
