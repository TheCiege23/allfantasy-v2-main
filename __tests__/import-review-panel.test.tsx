import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const beacon = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: beacon }))

import { ImportReviewPanel } from '@/components/import/ImportReviewPanel'
import { buildImportReview } from '@/lib/league-import/review/buildImportReview'
import type { ImportReviewPreviewInput } from '@/lib/league-import/review/types'

function preview(): ImportReviewPreviewInput {
  return {
    league: { name: 'Sunday Funday', sport: 'NFL', season: 2026, teamCount: 3, settings: { ppr: true } },
    managers: [
      { rosterId: '1', teamName: 'Team One', displayName: 'Owner 1', players: ['p1', 'p2'], starters: ['p1'], reserve: [], taxi: [] },
      { rosterId: '2', teamName: 'Team Two', displayName: '', players: ['p3'], starters: [], reserve: [], taxi: [] },
    ],
    rosterPositions: ['QB', 'BN'],
    playerMap: {
      p1: { name: 'Alpha QB', position: 'QB', team: 'BUF' },
      p2: { name: 'Bravo RB', position: 'RB', team: 'KC' },
      p3: { name: 'Charlie WR', position: 'WR', team: 'DAL' },
    },
    draftPickCount: 0,
    matchupWeeks: 0,
    reviewFacts: { rosterSize: 2 },
  }
}

const review = () =>
  buildImportReview({ platform: 'sleeper', preview: preview(), playerMatches: { p1: true, p2: true, p3: false } })

beforeEach(() => beacon.mockClear())
afterEach(cleanup)

describe('ImportReviewPanel', () => {
  it('shows what came across and every warning', () => {
    render(<ImportReviewPanel review={review()} provider="sleeper" onConfirm={vi.fn()} onRerun={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText('Review your import')).toBeInTheDocument()
    expect(screen.getByText('Sunday Funday')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByTestId('import-review-warning-fewer_teams_than_declared')).toBeInTheDocument()
    expect(screen.getByTestId('import-review-warning-team_no_owner')).toBeInTheDocument()
    expect(screen.getByTestId('import-review-warning-players_unmatched')).toHaveTextContent('Charlie WR')
  })

  it('requires an acknowledgement before confirming over open warnings', () => {
    const onConfirm = vi.fn()
    render(<ImportReviewPanel review={review()} provider="sleeper" onConfirm={onConfirm} onRerun={vi.fn()} onBack={vi.fn()} />)
    const confirm = screen.getByTestId('import-commit') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('import-review-ack').querySelector('input')!)
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith(null)
  })

  it('sends in-place fixes with the confirmation and records the fix (codes only)', () => {
    const onConfirm = vi.fn()
    render(<ImportReviewPanel review={review()} provider="sleeper" onConfirm={onConfirm} onRerun={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Owner name for Team Two'), { target: { value: 'Jamie' } })
    fireEvent.change(screen.getByLabelText('Team name for Team One'), { target: { value: 'Night Owls' } })
    expect(screen.getByTestId('import-review-warning-team_no_owner')).toHaveTextContent('Fixed')
    fireEvent.click(screen.getByTestId('import-review-ack').querySelector('input')!)
    fireEvent.click(screen.getByTestId('import-commit'))
    expect(onConfirm).toHaveBeenCalledWith({ teamNames: { '1': 'Night Owls' }, ownerNames: { '2': 'Jamie' }, playerMatches: undefined })

    const fixed = beacon.mock.calls.filter(([event]) => event === 'product.import_review.warning_fixed')
    expect(fixed).toEqual([['product.import_review.warning_fixed', { provider: 'sleeper', code: 'team_no_owner', fix: 'owner' }]])
    // No league, team, owner or player names in any analytics payload.
    const payloads = JSON.stringify(beacon.mock.calls)
    for (const secret of ['Sunday Funday', 'Jamie', 'Night Owls', 'Charlie', 'Team One']) expect(payloads).not.toContain(secret)
  })

  it('blocks confirmation outright when nothing came across', () => {
    const empty = buildImportReview({ platform: 'espn', preview: { ...preview(), managers: [] }, playerMatches: {} })
    render(<ImportReviewPanel review={empty} provider="espn" onConfirm={vi.fn()} onRerun={vi.fn()} onBack={vi.fn()} />)
    expect((screen.getByTestId('import-commit') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('import-review-ack')).toBeNull()
    expect(screen.getByText(/Fix the problem marked “must fix”/)).toBeInTheDocument()
  })

  it('re-runs the import and expands a roster', () => {
    const onRerun = vi.fn()
    render(<ImportReviewPanel review={review()} provider="sleeper" onConfirm={vi.fn()} onRerun={onRerun} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('import-review-rerun'))
    expect(onRerun).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /2 players/ }))
    expect(screen.getByText('Bravo RB')).toBeInTheDocument()
  })

  it('shows changes since the last import on a re-import', () => {
    const r = buildImportReview({
      platform: 'sleeper',
      preview: preview(),
      playerMatches: { p1: true, p2: true, p3: true },
      previous: {
        lastImportedAt: '2026-10-01T00:00:00Z',
        teams: [
          { teamId: '1', teamName: 'Team One', ownerName: 'Owner 1' },
          { teamId: '2', teamName: 'Team Two', ownerName: '' },
        ],
        rosters: { '1': ['p1'], '2': ['p3'] },
        settings: {},
      },
    })
    render(<ImportReviewPanel review={r} provider="sleeper" onConfirm={vi.fn()} onRerun={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByTestId('import-review-changes')).toHaveTextContent('1 players added')
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText('Bravo RB')).toBeInTheDocument()
  })

  it('embedded: reports readiness and fixes to the host instead of owning the import button', () => {
    const onReviewStateChange = vi.fn()
    render(
      <ImportReviewPanel embedded review={review()} provider="sleeper" onRerun={vi.fn()} onReviewStateChange={onReviewStateChange} />,
    )
    expect(screen.queryByTestId('import-commit')).toBeNull()
    expect(screen.queryByTestId('import-review-not-imported')).toBeNull()
    expect(onReviewStateChange.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, overrides: null })

    fireEvent.change(screen.getByLabelText('Owner name for Team Two'), { target: { value: 'Jamie' } })
    fireEvent.click(screen.getByTestId('import-review-ack').querySelector('input')!)
    const last = onReviewStateChange.mock.calls.at(-1)?.[0]
    expect(last).toMatchObject({ ready: true, overrides: { ownerNames: { '2': 'Jamie' } } })

    last.markConfirmed()
    expect(beacon.mock.calls.some(([e]) => e === 'product.import_review.confirmed')).toBe(true)
    cleanup()
    // Confirmed through the host, so unmounting is not an abandonment.
    expect(beacon.mock.calls.some(([e]) => e === 'product.import_review.abandoned')).toBe(false)
  })
})
