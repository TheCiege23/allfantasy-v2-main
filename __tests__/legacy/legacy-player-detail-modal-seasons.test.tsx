import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * components/PlayerDetailModal.tsx — the legacy modal's game-log season picker.
 *
 * The picker was the literal list 2025..2022 with 2025 selected, so once the 2026 season started it
 * could not be selected at all. The season is now derived from the clock.
 */

vi.mock('@/components/player-card/PlayerCardAnalytics', () => ({ default: () => null }))
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatInTimezone: () => '' }) }))

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.includes('/api/legacy/player-profile')) {
    return { json: async () => ({ ok: true, bio: { name: 'DeVonta Smith', position: 'WR', team: 'PHI', sleeperId: '7525' }, news: [] }) }
  }
  if (url.includes('/api/legacy/player-game-logs')) {
    return { json: async () => ({ ok: true, gameLogs: [] }) }
  }
  return { json: async () => ({}) }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-11T15:00:00Z'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function gameLogBodies(): Array<{ season?: string }> {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).includes('/api/legacy/player-game-logs'))
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')))
}

describe('legacy PlayerDetailModal game-log seasons', () => {
  it('offers the current season (2026) and opens on it', async () => {
    const { default: PlayerDetailModal } = await import('@/components/PlayerDetailModal')
    render(<PlayerDetailModal isOpen onClose={() => {}} playerName="DeVonta Smith" playerId="7525" position="WR" team="PHI" />)

    fireEvent.click(await screen.findByText('Game Logs'))

    expect(await screen.findByRole('button', { name: '2026' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '2023' })).toBeTruthy()
    await waitFor(() => expect(gameLogBodies().length).toBeGreaterThan(0))
    expect(gameLogBodies()[0]!.season).toBe('2026')
  })

  it('sends position and team so the server can verify a name-only lookup', async () => {
    const { default: PlayerDetailModal } = await import('@/components/PlayerDetailModal')
    render(<PlayerDetailModal isOpen onClose={() => {}} playerName="DeVonta Smith" position="CB" team="CAR" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const profileCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/legacy/player-profile'))
    expect(JSON.parse(String(profileCall?.[1]?.body))).toMatchObject({ player_name: 'DeVonta Smith', position: 'CB', team: 'CAR' })
  })
})
