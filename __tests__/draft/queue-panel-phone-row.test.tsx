/**
 * Phone Queue tab (2026-10-29). Measured at Pixel 7 size before this change: a 252px header and
 * 88px rows in a half-height tray showed 0.8 of a queued player, and a touch swipe on the list
 * moved nothing. After: the tray opens full, the list scrolls (102px on the same swipe), the
 * header is 204px and rows are 60px — 6.4 rows visible. Every change here is max-sm / max-md,
 * or a base the existing sm:/lg: classes override, so md+ is untouched.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { QueuePanel } from '@/components/app/draft-room/QueuePanel'

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
const queue = [
  { playerName: 'Example Guard', position: 'PG', team: 'OKC', playerId: 'p0' },
  { playerName: 'Example Wing', position: 'SF', team: 'BOS', playerId: 'p1' },
]

describe('QueuePanel on a phone', () => {
  it('keeps each row on one meta line and hides the drag grip and team badge below md', () => {
    render(
      <QueuePanel queue={queue} playerMetaById={{ p0: { adp: 3 }, p1: { adp: 9 } }} canDraft onRemove={() => {}}
        onReorder={() => {}} autoPickFromQueue={false} onAutoPickFromQueueChange={() => {}} awayMode={false}
        onAwayModeChange={() => {}} presentationVariant="redraft_snake" />,
    )
    const row = screen.getByTestId('draft-queue-item-0')
    const grip = row.querySelector('svg.lucide-grip-vertical')?.parentElement ?? null
    expect(classes(grip)).toContain('max-md:hidden')
    // The avatar draws its own "OKC" fallback; the team BADGE is the bordered chip in the meta line.
    const team = [...row.querySelectorAll('span')].find((el) => el.textContent === 'OKC' && el.className.includes('py-[1px]')) ?? null
    expect(classes(team)).toContain('max-md:hidden')
    expect(classes(team?.parentElement ?? null)).toEqual(expect.arrayContaining(['max-md:flex-nowrap', 'max-md:overflow-hidden']))
    // ↑ / ↓ stay — on a phone they are the only way to reorder.
    expect(screen.getByTestId('draft-queue-move-down-0')).toBeTruthy()
  })

  it('puts search and sort side by side on a phone and scrolls the position pills', () => {
    render(
      <QueuePanel queue={queue} canDraft onRemove={() => {}} onReorder={() => {}} autoPickFromQueue={false}
        onAutoPickFromQueueChange={() => {}} awayMode={false} onAwayModeChange={() => {}} />,
    )
    const grid = screen.getByTestId('draft-queue-search').parentElement!
    expect(classes(grid)).toEqual(expect.arrayContaining(['grid-cols-2', 'sm:grid-cols-2', 'lg:grid-cols-3']))
    expect(classes(screen.getByTestId('draft-queue-position-filter'))).toEqual(
      expect.arrayContaining(['max-sm:order-last', 'max-sm:col-span-2', 'max-sm:flex-nowrap', 'max-sm:overflow-x-auto']),
    )
  })
})
