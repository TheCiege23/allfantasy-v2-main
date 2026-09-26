import React, { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * 🛑 "THE CHAT BUBBLE STILL VANISHES FOR A MOMENT WHILE A PAGE LOADS" (handoff, 2026-09-25).
 *
 * Every /core screen change runs the same three states, because the screen param is part of the
 * `[[...screen]]` segment key and `loading.tsx` sits above the shell:
 *
 *   shell A  →  loading skeleton  →  shell B
 *
 * These tests drive exactly that sequence and ask the one question the report is about: is the
 * dock the SAME instance at the end? A stateful stand-in for CommsDock counts its mounts and holds
 * a draft in React state — what a half-typed message is — so a remount shows up as both.
 */

const dock = vi.hoisted(() => ({ mounts: 0 }))

vi.mock('@/components/core-app/comms/CommsDock', () => {
  function FakeDock(props: { pageLeagueId: string | null; shellKey?: string }) {
    const [draft, setDraft] = useState('')
    useEffect(() => {
      dock.mounts += 1
    }, [])
    return (
      <div data-testid="dock" data-league={props.pageLeagueId ?? ''} data-shell={props.shellKey ?? ''}>
        <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
    )
  }
  return { default: FakeDock, CommsDock: FakeDock }
})

import { CommsDockHold, CommsDockHost, ShellCommsDock } from '@/components/core-app/comms/CommsDockHost'

const LEAGUES = [{ id: 'L1', name: 'KBFL' }] as never

function Shell({ league, leagueFirst = false }: { league: string; leagueFirst?: boolean }) {
  return (
    <div className="af-shell">
      <ShellCommsDock leagues={LEAGUES} pageLeagueId={league} chimmyTokenCost={10} leagueFirst={leagueFirst} />
    </div>
  )
}

/** What Next.js renders under the layout at each moment of a navigation. */
function Page({ stage }: { stage: 'A' | 'loading' | 'B' | 'no-shell' }) {
  if (stage === 'A') return <Shell key="A" league="L1" />
  if (stage === 'B') return <Shell key="B" league="L2" />
  if (stage === 'loading') return <CommsDockHold />
  return <p>connect your leagues</p>
}

function renderAt(stage: Parameters<typeof Page>[0]['stage']) {
  const view = render(
    <CommsDockHost>
      <Page stage={stage} />
    </CommsDockHost>,
  )
  const go = (next: Parameters<typeof Page>[0]['stage']) =>
    act(() => {
      view.rerender(
        <CommsDockHost>
          <Page stage={next} />
        </CommsDockHost>,
      )
    })
  return { ...view, go }
}

beforeEach(() => {
  dock.mounts = 0
})
afterEach(() => cleanup())

describe('the chat bubble through a /core screen change', () => {
  it('stays mounted — the same instance — from shell A through the loading skeleton to shell B', () => {
    const { go } = renderAt('A')
    const first = screen.getByTestId('dock')
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'half-typed trade offer' } })

    go('loading')
    /* The load itself: the bubble is still on screen, still holding what was typed. */
    expect(screen.getByTestId('dock')).toBe(first)
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('half-typed trade offer')

    go('B')
    expect(screen.getByTestId('dock')).toBe(first)
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('half-typed trade offer')
    expect(dock.mounts).toBe(1)
  })

  it("takes the new screen's props once it lands, and tells the dock the shell changed", () => {
    const { go } = renderAt('A')
    const shellA = screen.getByTestId('dock').getAttribute('data-shell')
    expect(screen.getByTestId('dock').getAttribute('data-league')).toBe('L1')

    go('loading')
    /* Still showing where the user was until the new screen says otherwise. */
    expect(screen.getByTestId('dock').getAttribute('data-league')).toBe('L1')

    go('B')
    expect(screen.getByTestId('dock').getAttribute('data-league')).toBe('L2')
    /* A new `.af-shell` element — the docked drawer must re-mark it (CommsDock's `shellKey` effect). */
    expect(screen.getByTestId('dock').getAttribute('data-shell')).not.toBe(shellA)
  })

  it('also survives a direct swap with no loading state (a prefetched screen)', () => {
    const { go } = renderAt('A')
    const first = screen.getByTestId('dock')
    go('B')
    expect(screen.getByTestId('dock')).toBe(first)
    expect(dock.mounts).toBe(1)
  })

  /* connect-leagues and the signed-out landing never had a bubble; they must not inherit a stale one. */
  it('leaves when the next /core page has no shell', () => {
    const { go } = renderAt('A')
    go('no-shell')
    expect(screen.queryByTestId('dock')).toBeNull()
  })

  it('renders inside an af-core wrapper that mirrors league-first for the phone CSS rule', () => {
    render(
      <CommsDockHost>
        <Shell league="L1" leagueFirst />
      </CommsDockHost>,
    )
    const wrapper = screen.getByTestId('dock').parentElement!
    expect(wrapper.classList.contains('af-core')).toBe(true)
    expect(wrapper.hasAttribute('data-comms-host')).toBe(true)
    expect(wrapper.getAttribute('data-league-first')).toBe('true')
    expect(wrapper.style.display).toBe('contents')
    /* Outside the shell element — which is the point. */
    expect(wrapper.closest('.af-shell')).toBeNull()
  })

  /* A shell rendered without the layout (tests, previews) must still have a chat. */
  it('falls back to rendering the dock inline when there is no host', () => {
    render(<Shell league="L1" />)
    expect(screen.getByTestId('dock').closest('.af-shell')).not.toBeNull()
  })
})
