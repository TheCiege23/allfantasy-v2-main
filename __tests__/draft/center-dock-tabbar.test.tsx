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
  it('reads Queue, Chimmy, Chat (+ Commish Edit for a commissioner); Intel and AF Legacy merged into Chimmy (2026-11-19)', () => {
    const { unmount } = render(<DraftCenterDockTabBar active="queue" onSelect={vi.fn()} showIntel showCommish redraftSnake={false} />)
    expect(labels()).toEqual(['Queue', 'Chimmy', 'Chat', 'Commish Edit'])
    unmount()
    render(<DraftCenterDockTabBar active="queue" onSelect={vi.fn()} showIntel={false} showCommish={false} redraftSnake={false} />)
    expect(labels()).toEqual(['Queue', 'Chimmy', 'Chat'])
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

describe('room v2 tablet panel tabs (portrait, 768–1023px)', () => {
  it('leads with Players; while it is selected no dock tab reads as selected', () => {
    const onPlayers = vi.fn()
    const onSelect = vi.fn()
    render(
      <DraftCenterDockTabBar
        active="queue"
        onSelect={onSelect}
        showIntel
        showCommish={false}
        redraftSnake={false}
        playersTab={{ label: 'Players', selected: true, onSelect: onPlayers }}
        testIdBase="draft-tablet"
      />,
    )
    expect(labels()).toEqual(['Players', 'Queue', 'Chimmy', 'Chat'])
    expect(screen.getByTestId('draft-tablet-dock-tabbar')).toBeTruthy()
    expect(screen.getByTestId('draft-tablet-tab-players').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('draft-tablet-tab-queue').getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByTestId('draft-tablet-tab-chat'))
    expect(onSelect).toHaveBeenCalledWith('chat')
  })

  it('the page shows one panel at a time below 1024px and both from 1024px', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
    expect(src).toMatch(/<div className="shrink-0 lg:hidden" data-testid="draft-tablet-panel-tabs">/)
    expect(src).toMatch(/\$\{tabletPanel === 'players' \? 'max-lg:border-r-0' : 'max-lg:hidden'\}`\}\s*data-testid="draft-bottom-dock-pool"/)
    expect(src).toMatch(/xl:hidden \$\{tabletPanel === 'dock' \? '' : 'max-lg:hidden'\}/)
    // Any dock tab change (a tap, Ask Chimmy, the commissioner editor) brings the dock forward.
    expect(src).toMatch(/setCenterDockTabState\(tab\)\s*setTabletPanel\('dock'\)/)
  })
})
