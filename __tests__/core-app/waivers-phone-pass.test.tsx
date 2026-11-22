/**
 * Waivers on a phone (2026-11-07). Live at 375px the screen was 2,925px: Competitive Edge listed all
 * eleven rivals and Worth adding carried six coverage notes. Rivals show the top three at every width;
 * on a phone the notes fold behind "How this list was built". Previewed live: 2,925 -> 2,015px.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { RIVALS_PREVIEW, WaiverCompetitiveEdge } from '@/components/core-app/screens/WaiverCompetitiveEdge'
import { buildWaiverEdge } from '@/lib/competitive-edge/waiverEdge'

afterEach(cleanup)

const access = {
  depth: 'competitive_edge',
  unlocked: true,
  hasPlan: true,
  preLaunchFree: false,
  startsAt: '2026-10-15T04:00:00.000Z',
  planName: 'AF Pro',
  label: 'Competitive Edge',
  upgradePath: '/pro',
} as never

function edgeWith(rivalCount: number) {
  const managers = [{ teamExternalId: '0', name: 'You', faabRemaining: 40 }]
  const claims: Array<{ teamExternalId: string; position: string; bid: number; atIso: string }> = []
  for (let i = 1; i <= rivalCount; i++) {
    managers.push({ teamExternalId: String(i), name: `Rival ${i}`, faabRemaining: 50 })
    for (let c = 0; c <= rivalCount - i; c++) {
      claims.push({ teamExternalId: String(i), position: 'RB', bid: 1, atIso: `2026-09-0${(c % 9) + 1}T00:00:00.000Z` })
    }
  }
  return buildWaiverEdge({
    season: 2026,
    usesFaab: true,
    claims,
    managers,
    viewerTeamExternalId: '0',
    asOf: '2026-09-25T12:44:20.000Z',
    stale: false,
  })
}

const rivals = () => document.querySelectorAll('#af-wv-edge-rivals > li').length

describe('Competitive Edge rivals', () => {
  it('shows the first three, then every rival behind one button, and back', () => {
    const edge = edgeWith(6)
    render(<WaiverCompetitiveEdge access={access} edge={{ available: true, data: edge }} />)
    const total = edge.rivals.length
    expect(total).toBeGreaterThan(RIVALS_PREVIEW)
    expect(rivals()).toBe(RIVALS_PREVIEW)
    const more = screen.getByRole('button', { name: `Show all ${total} managers` })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe('af-wv-edge-rivals')
    fireEvent.click(more)
    expect(rivals()).toBe(total)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer managers' }))
    expect(rivals()).toBe(RIVALS_PREVIEW)
  })

  it('adds no button when the rivals already fit', () => {
    const edge = edgeWith(2)
    render(<WaiverCompetitiveEdge access={access} edge={{ available: true, data: edge }} />)
    expect(rivals()).toBe(edge.rivals.length)
    expect(document.querySelector('.af-wv-edge-more')).toBeNull()
  })
})

describe('Worth adding notes on a phone', () => {
  it('fold only inside a top-level phone query, and the toggle is hidden everywhere else', () => {
    const code = readFileSync(resolve(process.cwd(), 'components/core-app/af-waivers.css'), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const start = code.lastIndexOf('@media (max-width: 640px) {')
    const before = code.slice(0, start)
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
    expect(before).toMatch(/\.af-core \.af-wlb-notes-toggle \{\s*display: none;\s*\}\s*$/)
    const block = code.slice(start)
    expect(block).toMatch(/\.af-core \.af-wlb-notes:not\(\[data-open\]\) \{\s*display: none;/)
    expect(block).toMatch(/\.af-core \.af-wlb-notes-toggle \{\s*display: flex;/)
  })

  it('wraps the notes in one controllable region with its toggle', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'components/core-app/WaiverLineupBoard.tsx'), 'utf8')
    expect(tsx).toContain('className="af-wlb-notes-toggle"')
    expect(tsx).toContain('aria-controls="af-wlb-notes"')
    expect(tsx).toContain('<div className="af-wlb-notes" id="af-wlb-notes" data-open={notesOpen || undefined}>')
  })
})
