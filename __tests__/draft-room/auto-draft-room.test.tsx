// @vitest-environment jsdom
/**
 * Reported from a live full-auto draft (production, 2026-11-25):
 *   - "the timer is still showing, its an auto draft for everyone, there shouldnt be a timer"
 *   - "I cant see the draft queue. it doesnt fit on the screen on PC"
 *   - "there is no line in the player pool that tells me when my next pick is"
 *   - "the manager names have blended into the draft board, I don't know who picks when and when I pick"
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({ LazyDraftImage: () => null }))

import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { DraftBoardCell, type DraftBoardCellPick } from '@/components/app/draft-room/DraftBoardCell'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { QUEUE_FILTERS_MIN_PLAYERS, QueuePanel } from '@/components/app/draft-room/QueuePanel'
import { SleeperPoolTable, nextPickLineRowIndex } from '@/components/app/draft-room/SleeperPoolTable'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

describe('the top bar in an auto draft', () => {
  const bar = (over: Record<string, unknown> = {}) => (
    <DraftTopBar
      {...({
        leagueName: 'middie NCAAB Test', sport: 'NCAAB', draftType: 'snake', teamCount: 54, rounds: 12,
        currentManagerOnClock: "TheCiege26's Team", pickLabel: '7.29', overallPickNumber: 353,
        timerStatus: 'running', timerRemainingSeconds: 86, timerEndAtIso: new Date(Date.now() + 86_000).toISOString(),
        timerSeconds: 90, isCommissioner: false, draftStatus: 'in_progress', isCurrentUserOnClock: true,
        ...over,
      } as never)}
    />
  )

  it('shows a running pick clock in an ordinary draft (control)', () => {
    render(bar())
    expect(screen.getByTestId('draft-topbar-clock')).toBeTruthy()
    expect(screen.queryByTestId('draft-topbar-auto-drafting')).toBeNull()
    expect(screen.getByTestId('draft-topbar-on-clock-manager').parentElement!.getAttribute('data-on-clock-self')).toBe('true')
  })

  it('shows progress and no clock, even while the server keeps a timer running', () => {
    render(bar({ autoDraft: true }))
    expect(screen.queryByTestId('draft-topbar-clock')).toBeNull()
    expect(screen.queryByTestId('draft-topbar-timer-value')).toBeNull()
    const pill = screen.getByTestId('draft-topbar-auto-drafting')
    expect(pill.textContent).toBe('Auto-draftingPick 353 of 648')
    expect(pill.getAttribute('title')).toBe('Every pick is made automatically, so there is no pick clock.')
  })

  it('does not tell a manager they are on the clock: their own turn is "Your auto pick", with no pulse', () => {
    render(bar({ autoDraft: true }))
    const chip = screen.getByTestId('draft-topbar-on-clock-manager').parentElement!
    expect(chip.getAttribute('data-on-clock-self')).toBeNull()
    expect(classes(chip)).not.toContain('animate-pulse')
    expect(chip.textContent).toBe("TheCiege26's TeamYour auto pick")
    cleanup()
    render(bar({ autoDraft: true, isCurrentUserOnClock: false, currentManagerOnClock: 'Open Team 9' }))
    expect(screen.getByTestId('draft-topbar-on-clock-manager').parentElement!.textContent).toBe('Open Team 9Auto pick')
  })

  it('replaces the "N seconds per pick" line with "Auto-drafting", and says Paused when paused', () => {
    render(bar({ autoDraft: true }))
    expect(screen.getByTestId('draft-topbar-timer-summary').textContent).toBe('Auto-drafting')
    cleanup()
    render(bar({ autoDraft: true, draftStatus: 'paused', timerStatus: 'paused' }))
    const pill = screen.getByTestId('draft-topbar-auto-drafting')
    expect(pill.getAttribute('data-paused')).toBe('true')
    expect(pill.textContent).toContain('Paused')
  })

  it('leaves the pre-draft bar alone', () => {
    render(bar({ autoDraft: true, draftStatus: 'pre_draft', timerStatus: 'none', overallPickNumber: null }))
    expect(screen.queryByTestId('draft-topbar-auto-drafting')).toBeNull()
  })
})

describe('the Queue tab', () => {
  const players = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ playerName: `Player ${i + 1}`, position: i % 2 ? 'G' : 'F', team: 'UCF', playerId: `p${i}` }))
  const panel = (n: number, over: Record<string, unknown> = {}) => (
    <QueuePanel
      {...({
        queue: players(n), canDraft: false, onRemove: () => {}, onReorder: () => {}, onAiReorder: () => {},
        onAiReorderEnabledChange: () => {}, autoPickFromQueue: false, onAutoPickFromQueueChange: () => {},
        awayMode: false, onAwayModeChange: () => {}, ...over,
      } as never)}
    />
  )

  it('shows the players first: a short queue has no search, sort or position rows above it', () => {
    render(panel(2))
    expect(screen.queryByTestId('draft-queue-filters')).toBeNull()
    expect(screen.queryByTestId('draft-queue-search')).toBeNull()
    expect(screen.getByTestId('draft-queue-item-0')).toBeTruthy()
    expect(screen.getByTestId('draft-queue-item-1')).toBeTruthy()
  })

  it('brings search, sort and positions back once the queue is long enough to need them', () => {
    render(panel(QUEUE_FILTERS_MIN_PLAYERS - 1))
    expect(screen.queryByTestId('draft-queue-filters')).toBeNull()
    cleanup()
    render(panel(QUEUE_FILTERS_MIN_PLAYERS))
    expect(screen.getByTestId('draft-queue-search')).toBeTruthy()
    expect(screen.getByTestId('draft-queue-sort')).toBeTruthy()
    expect(screen.getByTestId('draft-queue-position-filter')).toBeTruthy()
  })

  it('folds the switches away in every room, closed until opened', () => {
    for (const presentationVariant of ['default', 'redraft_snake'] as const) {
      render(panel(2, { presentationVariant }))
      const options = screen.getByTestId('draft-queue-ai-options')
      expect(options.tagName).toBe('DETAILS')
      expect(options.hasAttribute('open')).toBe(false)
      // One copy of each switch, inside the fold.
      expect(screen.getAllByTestId('draft-queue-away-toggle')).toHaveLength(1)
      expect(options.contains(screen.getByTestId('draft-queue-away-toggle'))).toBe(true)
      expect(options.contains(screen.getByTestId('draft-queue-ai-reorder'))).toBe(true)
      cleanup()
    }
  })

  it('in an auto draft says how the queue is used and drops the switches that are always on', () => {
    render(panel(2, { autoDraft: true, autopickSlot: <div data-testid="autopick-me" /> }))
    expect(screen.getByTestId('draft-queue-auto-draft-note').textContent).toBe('Auto draft: your queue is drafted first, top to bottom.')
    expect(screen.queryByTestId('autopick-me')).toBeNull()
    expect(screen.queryByTestId('draft-queue-autopick-toggle')).toBeNull()
    expect(screen.queryByTestId('draft-queue-autopick-toggle-header')).toBeNull()
    expect(screen.queryByTestId('draft-queue-away-toggle')).toBeNull()
    expect(screen.getByTestId('draft-queue-ai-reorder')).toBeTruthy()
    cleanup()
    // Control: an ordinary draft keeps them.
    render(panel(2))
    expect(screen.queryByTestId('draft-queue-auto-draft-note')).toBeNull()
    expect(screen.getByTestId('draft-queue-away-toggle')).toBeTruthy()
    expect(screen.getByTestId('draft-queue-autopick-toggle')).toBeTruthy()
  })
})

describe('the next-pick line in the player list', () => {
  const rows = ['a', 'b', 'c', 'd', 'e']

  it('sits above the row reached after that many available players', () => {
    expect(nextPickLineRowIndex(rows, 3, () => false)).toBe(3)
    expect(nextPickLineRowIndex(rows, 1, () => false)).toBe(1)
  })

  it('does not count players already drafted', () => {
    expect(nextPickLineRowIndex(rows, 2, (r) => r === 'a' || r === 'c')).toBe(4)
  })

  it('draws nothing when the viewer is up now, or the list is too short to reach their pick', () => {
    expect(nextPickLineRowIndex(rows, 0, () => false)).toBeNull()
    expect(nextPickLineRowIndex(rows, 5, () => false)).toBeNull()
    expect(nextPickLineRowIndex(rows, 40, () => false)).toBeNull()
    expect(nextPickLineRowIndex(rows, Number.NaN, () => false)).toBeNull()
  })

  const table = (nextPickLine: unknown) => (
    <SleeperPoolTable
      {...({
        filtered: rows.map((id, i) => ({ id, name: `Player ${id}`, position: 'G', team: 'UCF', adp: i + 1 })),
        draftedNames: new Set(), selectedPlayer: null, isPlayerQueued: () => false, isPlayerDrafted: () => false,
        canDraft: false, useAiAdp: false, draftSport: 'NCAAB', onDraftRequest: () => {}, onAddToQueue: () => {},
        onPlayerSelect: () => {}, onCompareTap: () => {}, scrollRef: { current: null }, compareAnchor: null,
        disableVirtualization: true, rowHeight: 60, nextPickLine,
      } as never)}
    />
  )

  it('is drawn across the table at that row, with the pick and how many go before it', () => {
    const copy = draftRoomHeaderMessages.en
    render(table({ picksAway: 2, text: copy.nextPickLine('8.26', 2), title: copy.nextPickLineTitle }))
    const line = screen.getByTestId('sleeper-pool-next-pick-line')
    expect(line.getAttribute('role')).toBe('separator')
    expect(line.getAttribute('data-row-index')).toBe('2')
    expect(line.style.top).toBe('120px')
    expect(line.textContent).toBe('Your pick 8.26 · 2 picks before it')
    expect(classes(line)).toContain('pointer-events-none')
  })

  it('is absent without a next pick (control)', () => {
    render(table(null))
    expect(screen.queryByTestId('sleeper-pool-next-pick-line')).toBeNull()
  })

  it('says "1 pick", not "1 picks"', () => {
    expect(draftRoomHeaderMessages.en.nextPickLine('2.01', 1)).toBe('Your pick 2.01 · 1 pick before it')
    expect(draftRoomHeaderMessages.es.nextPickLine('2.01', 1)).toBe('Tu selección 2.01 · 1 selección antes')
  })
})

describe('the board', () => {
  const slotOrder = [1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))
  const board = (over: Record<string, unknown> = {}) => (
    <DraftBoard {...({ picks: [], slotOrder, teamCount: 3, rounds: 2, draftType: 'snake', thirdRoundReversal: false, ...over } as never)} />
  )

  it('keeps the manager names on a solid row above the tiles, which sit in their own lower layer', () => {
    render(board())
    const header = classes(screen.getByTestId('draft-board-team-header'))
    expect(header).toContain('z-20')
    expect(header).toContain('bg-[#0b1428]')
    // Glass let the tiles show straight through the names on a manager's browser.
    expect(header.some((c) => c.startsWith('backdrop-blur'))).toBe(false)
    expect(header.filter((c) => c.startsWith('bg-')).some((c) => /\/\d+$/.test(c) || c.includes('rgba('))).toBe(false)
    const rounds = classes(screen.getByTestId('draft-board-rounds'))
    expect(rounds).toEqual(expect.arrayContaining(['relative', 'z-0', 'isolate']))
  })

  it("marks the viewer's own column with YOU, and nobody else's", () => {
    render(board({ currentUserRosterId: 'r2' }))
    const mine = screen.getByTestId('draft-board-team-header-slot-2')
    expect(mine.getAttribute('data-viewer')).toBe('true')
    expect(screen.getAllByTestId('draft-board-team-header-you')).toHaveLength(1)
    expect(mine.contains(screen.getByTestId('draft-board-team-header-you'))).toBe(true)
    expect(screen.getByTestId('draft-board-team-header-slot-1').getAttribute('data-viewer')).toBeNull()
  })

  it("labels the viewer's picks still to come, in every round", () => {
    render(board({ currentUserRosterId: 'r2' }))
    // Snake, 3 teams: slot 2 holds 1.02 (overall 2) and 2.02 (overall 5).
    expect(screen.getByTestId('draft-board-cell-your-pick-2').textContent).toBe('Your pick')
    expect(screen.getByTestId('draft-board-cell-your-pick-5').textContent).toBe('Your pick')
    expect(screen.queryByTestId('draft-board-cell-your-pick-1')).toBeNull()
    expect(screen.queryByTestId('draft-board-cell-your-pick-3')).toBeNull()
  })

  it('shows no "Your pick" to a viewer without a team', () => {
    render(board())
    expect(document.querySelector('[data-testid^="draft-board-cell-your-pick-"]')).toBeNull()
    expect(screen.queryByTestId('draft-board-team-header-you')).toBeNull()
  })

  const pick = (over: Partial<DraftBoardCellPick> = {}): DraftBoardCellPick => ({
    overall: 5, round: 2, slot: 2, pickLabel: '2.02', playerName: '', position: '', team: '', playerId: null,
    playerImageUrl: null, sport: 'NCAAB', injuryStatus: null, byeWeek: null, displayName: 'Team 2', ...over,
  } as DraftBoardCellPick)

  it('outlines an upcoming pick of the viewer in white; a made pick never says "Your pick"', () => {
    render(<DraftBoardCell pick={pick()} isEmpty viewerUpcomingLabel="Your pick" />)
    expect(classes(screen.getByTestId('draft-board-cell-5'))).toEqual(expect.arrayContaining(['ring-2', 'ring-inset', 'ring-white/80']))
    cleanup()
    render(<DraftBoardCell pick={pick()} isEmpty />)
    expect(classes(screen.getByTestId('draft-board-cell-5'))).not.toContain('ring-inset')
    cleanup()
    render(<DraftBoardCell pick={pick({ playerName: 'A. Carson', position: 'G', team: 'USA' })} isEmpty={false} viewerUpcomingLabel="Your pick" />)
    expect(screen.queryByTestId('draft-board-cell-your-pick-5')).toBeNull()
  })
})
