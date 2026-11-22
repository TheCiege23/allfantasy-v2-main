import { describe, expect, it, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DraftRightDockTabs } from '@/components/app/draft-room/DraftRightDockTabs'

/**
 * The right dock's Chimmy tab (xl+). Chimmy is a chat surface with its own requests, so its body
 * mounts on first open rather than with the dock; an "Ask Chimmy" button opens it without pinning.
 */

function Chimmy() {
  return <div data-testid="chimmy-body">Chimmy here</div>
}

function dock(props: Partial<Parameters<typeof DraftRightDockTabs>[0]> = {}) {
  return (
    <DraftRightDockTabs
      queueBody={<div>queue</div>}
      rosterBody={<div>roster</div>}
      chatBody={<div>chat</div>}
      {...props}
    />
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('DraftRightDockTabs — Chimmy', () => {
  it('offers no Chimmy tab without a body', () => {
    render(dock())
    expect(screen.queryByTestId('draft-right-dock-tab-chimmy')).toBeNull()
  })

  it('offers the tab with a body but does not mount Chimmy until it is opened', () => {
    render(dock({ chimmyBody: <Chimmy /> }))
    expect(screen.getByTestId('draft-right-dock-tab-chimmy')).toBeTruthy()
    expect(screen.queryByTestId('chimmy-body')).toBeNull()

    fireEvent.click(screen.getByTestId('draft-right-dock-tab-chimmy'))
    expect(screen.getByTestId('chimmy-body')).toBeTruthy()

    // Stays mounted after switching away, so the conversation survives.
    fireEvent.click(screen.getByTestId('draft-right-dock-tab-queue'))
    expect(screen.getByTestId('chimmy-body')).toBeTruthy()
    expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('queue')
  })

  it('opens on request from outside and can be left again', () => {
    const { rerender } = render(dock({ chimmyBody: <Chimmy /> }))
    expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('queue')

    act(() => {
      rerender(dock({ chimmyBody: <Chimmy />, openTabRequest: { tab: 'chimmy', key: 1 } }))
    })
    expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('chimmy')
    expect(screen.getByTestId('chimmy-body')).toBeTruthy()

    fireEvent.click(screen.getByTestId('draft-right-dock-tab-roster'))
    expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('roster')

    // The same button pressed again bumps the key and reopens Chimmy.
    act(() => {
      rerender(dock({ chimmyBody: <Chimmy />, openTabRequest: { tab: 'chimmy', key: 2 } }))
    })
    expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('chimmy')
  })

  it('falls back to the default tab when a stored Chimmy preference meets a dock without it', () => {
    window.localStorage.setItem('af:draft-right-dock-active-tab', 'chimmy')
    render(dock())
    expect(screen.getByTestId('draft-right-dock').getAttribute('data-active-tab')).toBe('queue')
  })
})
