/**
 * The draft room's dock tabs below 1280px (components/app/draft-room/DraftCenterDockTabBar.tsx).
 * Layout is measured in a browser by e2e/draft-board-coverage.spec.ts (no label clipped or wrapped at
 * 240 / 300 / 400px); this pins which tabs show, the selection, and the one-row classes that make it so.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { DraftCenterDockTabBar } from '@/components/app/draft-room/DraftCenterDockTabBar'

const labels = () => screen.getAllByRole('tab').map((t) => t.textContent)

describe('DraftCenterDockTabBar', () => {
  it('shows Intel outside an auction and Commish Edit to a commissioner', () => {
    const { unmount } = render(<DraftCenterDockTabBar active="queue" onSelect={vi.fn()} showIntel showCommish redraftSnake={false} />)
    expect(labels()).toEqual(['Queue', 'Intel', 'Chat', 'AF Legacy', 'Commish Edit'])
    unmount()
    render(<DraftCenterDockTabBar active="queue" onSelect={vi.fn()} showIntel={false} showCommish={false} redraftSnake={false} />)
    expect(labels()).toEqual(['Queue', 'Chat', 'AF Legacy'])
  })

  it('keeps the room’s test ids, marks the active tab and reports a click', () => {
    const onSelect = vi.fn()
    render(<DraftCenterDockTabBar active="chat" onSelect={onSelect} showIntel showCommish redraftSnake />)
    expect(screen.getByTestId('draft-bottom-tab-chat').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('draft-bottom-tab-queue').getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByTestId('draft-bottom-tab-commish'))
    expect(onSelect).toHaveBeenCalledWith('commish')
  })

  it('is one scrolling row whose tabs never shrink below their label', () => {
    render(<DraftCenterDockTabBar active="queue" onSelect={vi.fn()} showIntel showCommish redraftSnake={false} />)
    const bar = screen.getByTestId('draft-bottom-dock-tabbar')
    expect(bar.className).toMatch(/\bflex\b/)
    expect(bar.className).toMatch(/overflow-x-auto/)
    expect(bar.className).not.toMatch(/grid-cols-/)
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).toMatch(/whitespace-nowrap/)
  })

  it('is what the live room renders below xl', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
    expect(src).toMatch(/<DraftCenterDockTabBar\b/)
    expect(src).not.toMatch(/data-testid="draft-bottom-tab-queue"/) // the inline grid is gone
  })
})
