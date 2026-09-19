import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LineupVerification } from '@/components/core-app/LineupVerification'
import { verificationAge } from '@/lib/core-app/lineupVerification'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })
describe('lineup verification', () => {
  it('shows the source week and successful check time, ages it, and refreshes', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T15:00:00Z'))
    render(<LineupVerification verification={{ source: 'Sleeper', checkedAt: '2026-09-19T15:00:00Z', week: 2, slots: [] }} />)
    expect(screen.getByText('Sleeper · Week 2')).toBeInTheDocument()
    expect(screen.getByText('Checked just now')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(300000))
    expect(screen.getByText('Checked 5 min ago')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Refresh before making a lineup decision')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lineup' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('never invents a verification time on a failed read', () => {
    render(<LineupVerification verification={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lineup advice is paused')
    expect(document.querySelector('time')).toBeNull()
    expect(verificationAge('invalid', Date.now())).toBe('Verification time unavailable')
  })
  it('names the flagged starter, source week, designation and exact slot link', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T15:01:00Z'))
    const data = { allLeagues: [{ id: 'league', name: 'Cup', platform: 'sleeper', priority: 'urgent', hurtStarters: 1,
      flaggedStarters: [{ playerId: '123', name: 'Player A', status: 'Out', slot: 'FLEX', index: 3 }],
      lineupVerification: { checkedAt: '2026-09-19T15:00:00Z', week: 2, source: 'Sleeper', slots: [] },
    }] } as unknown as Dash34Data
    const issue = mergeDash34Issues([], data)[0]
    expect(issue.title).toBe('Player A · FLEX · Out — Cup')
    expect(issue.meta).toContain('Week 2')
    expect(issue.meta).toContain('Checked 15:00 UTC · 2026-09-19')
    expect(issue.action?.href).toBe('/core/my-team?league=league#lineup-player-123')
  })
})
