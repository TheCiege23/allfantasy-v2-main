/**
 * Room v2 header (2026-11): one pick pill with "You're up in N", Ask Chimmy in the row, the sound
 * toggle inside the ⋯ menu, and the board's cyan on-the-clock tile.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const value = () => {
    const t = (key: string) => dict.en[key] ?? key
    return { language: 'en', setLanguage: () => {}, t, tInterpolate: (key: string) => t(key) }
  }
  return { useLanguage: value, useOptionalLanguage: value }
})
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? '')} src={String(props.src ?? '')} />,
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => null }))

import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { DraftBoardCell } from '@/components/app/draft-room/DraftBoardCell'

const live = {
  leagueName: 'Sunday League',
  sport: 'NFL',
  draftType: 'snake',
  teamCount: 12,
  rounds: 11,
  currentManagerOnClock: 'Two-Point Try',
  pickLabel: '7.10',
  overallPickNumber: 82,
  timerStatus: 'running' as const,
  timerRemainingSeconds: 54,
  isCommissioner: false,
  draftStatus: 'in_progress',
}

describe('room v2 header', () => {
  it('puts pick, manager, clock and "you are up in N" in one pill', () => {
    render(<DraftTopBar {...live} picksUntilUser={2} />)
    const pill = screen.getByTestId('draft-topbar-center-slot')
    expect(pill.getAttribute('data-room-v2-pill')).toBe('true')
    expect(pill.textContent).toContain('7.10')
    expect(screen.getByTestId('draft-topbar-on-clock-manager').textContent).toBe('Two-Point Try')
    expect(pill.contains(screen.getByTestId('draft-topbar-clock'))).toBe(true)
    expect(screen.getByTestId('draft-topbar-up-in').textContent).toBe('You’re up in 2')
  })

  it('says "up next" for one pick, and nothing while you are on the clock or not drafting', () => {
    const { rerender } = render(<DraftTopBar {...live} picksUntilUser={1} />)
    expect(screen.getByTestId('draft-topbar-up-in').textContent).toBe('You’re up next')
    rerender(<DraftTopBar {...live} picksUntilUser={0} isCurrentUserOnClock />)
    expect(screen.queryByTestId('draft-topbar-up-in')).toBeNull()
    rerender(<DraftTopBar {...live} picksUntilUser={3} draftStatus="paused" />)
    expect(screen.queryByTestId('draft-topbar-up-in')).toBeNull()
  })

  it('the gear opens draft settings for everyone; Ask Chimmy is gone from the header (2026-11-19)', () => {
    const onOpenDraftRoomSettings = vi.fn()
    const { rerender } = render(<DraftTopBar {...live} isCommissioner={false} onOpenChimmy={vi.fn()} onOpenDraftRoomSettings={onOpenDraftRoomSettings} />)
    expect(screen.queryByTestId('draft-topbar-ask-chimmy')).toBeNull()
    fireEvent.click(screen.getByTestId('draft-topbar-settings'))
    expect(onOpenDraftRoomSettings).toHaveBeenCalledTimes(1)
    rerender(<DraftTopBar {...live} />)
    expect(screen.queryByTestId('draft-topbar-settings')).toBeNull()
  })

  it('a paused clock reads Paused and is not a Resume button; Resume is the one pill', () => {
    const onResume = vi.fn()
    render(<DraftTopBar {...live} isCommissioner draftStatus="paused" timerStatus="paused" onResume={onResume} onPause={vi.fn()} />)
    expect(screen.queryByTestId('draft-topbar-resume-draft')).toBeNull()
    expect(screen.getByTestId('draft-topbar-clock').tagName).toBe('DIV')
    fireEvent.click(screen.getByTestId('draft-topbar-resume-pill'))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('shows no league auto-pick pill (it lives in Draft settings)', () => {
    render(<DraftTopBar {...live} onToggleAutoPick={vi.fn()} />)
    expect(screen.queryByTestId('draft-topbar-autopick-pill')).toBeNull()
  })

  it('moves the sound toggle into the room menu', () => {
    render(<DraftTopBar {...live} />)
    expect(screen.queryByTestId('draft-topbar-timer-mute-toggle')).toBeNull()
    fireEvent.click(screen.getByTestId('draft-topbar-menu-toggle'))
    const menu = screen.getByTestId('draft-topbar-menu')
    const sound = screen.getByTestId('draft-topbar-timer-mute-toggle')
    expect(menu.contains(sound)).toBe(true)
    expect(sound.textContent).toContain('Sound')
    expect(sound.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(sound)
    expect(screen.getByTestId('draft-topbar-timer-mute-toggle').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('room v2 on-the-clock tile', () => {
  const pick = { overall: 82, round: 7, slot: 10, pickLabel: '7.10', playerName: null, position: null, team: null }

  it('the current empty pick says "On the clock" on a cyan tile', () => {
    render(<DraftBoardCell pick={pick as never} isEmpty isCurrentPick />)
    const cell = screen.getByTestId('draft-board-cell-82')
    // The league-type accent (room v2), cyan when the room sets none.
    expect(cell.className).toContain('ring-[color:var(--af-league-accent,#67e8f9)]')
    expect(cell.className).not.toContain('f6c445')
    expect(screen.getByTestId('draft-board-cell-on-clock-82').textContent).toBe('On the clock')
  })

  it('other empty picks carry no clock label', () => {
    render(<DraftBoardCell pick={pick as never} isEmpty />)
    expect(screen.queryByTestId('draft-board-cell-on-clock-82')).toBeNull()
  })
})
