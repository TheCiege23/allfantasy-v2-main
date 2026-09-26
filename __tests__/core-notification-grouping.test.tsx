import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { groupNotificationRows } from '@/lib/core-app/notificationGroups'
import { NotificationsCenter } from '@/components/core-app/screens/NotificationsCenter'
import type { NotificationRow, NotificationsCenterData } from '@/lib/core-app/notificationsCenter'

vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))
vi.mock('@/components/core-app/screens/NotificationRowMute', () => ({ NotificationRowMute: () => null }))
vi.mock('next/link', () => ({ default: ({ onClick, children, ...props }: any) => <a {...props} onClick={(event) => { event.preventDefault(); onClick?.(event) }}>{children}</a> }))

const row = (id: string, overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id, kind: 'lineups', title: 'Check your lineup', detail: 'A starter is out',
  leagueId: 'league1', leagueName: 'League', platform: 'sleeper',
  createdAt: '2026-09-26T12:00:00Z', read: false, severity: 'warn',
  action: { label: 'Review lineup', href: '/core/my-team?league=league1', external: false },
  ...overrides,
})
const data = (): NotificationsCenterData => ({
  actToday: [], rest: [row('n1'), row('n2')],
  counts: { all: 2, trades: 0, waivers: 0, lineups: 2, mentions: 0, drafts: 0, commissioner: 0 },
  unread: 2, listed: 2, olderNotListed: 0, leagueId: null, mentionsAvailable: false,
  push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('notification grouping and read receipts', () => {
  it('collapses matching notices but preserves different days, leagues and reasons', () => {
    const source = [row('a', { read: true }), row('b'), row('c', { leagueId: 'other' }), row('d', { detail: 'A different starter' }), row('e', { createdAt: '2026-09-25T12:00:00Z' })]
    const grouped = groupNotificationRows(source)
    expect(grouped).toHaveLength(4)
    expect(grouped[0].relatedIds).toEqual(['a', 'b'])
    expect(grouped[0].read).toBe(false)
    expect(source[0].read).toBe(true)
    expect(source[0].relatedIds).toBeUndefined()
  })
  it('marks every underlying receipt when a grouped action is clicked', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', request)
    render(<NotificationsCenter data={data()} />)
    expect(screen.getAllByRole('link', { name: 'Review lineup' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('link', { name: 'Review lineup' }))
    await waitFor(() => expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy())
    expect(JSON.parse(request.mock.calls[0][1].body).ids).toEqual(['n1', 'n2'])
  })
  it('keeps unread notices and offers retry after a failed receipt request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<NotificationsCenter data={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Please try again'))
    expect(screen.getByText(/2 waiting/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('keeps mark-all within the selected league, including receipts outside the loaded window', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', request)
    render(<NotificationsCenter data={{ ...data(), leagueId: 'league1', unread: 90, olderNotListed: 88 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.getByText('Nothing is waiting on you in this league.')).toBeTruthy())
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ ids: 'all', leagueId: 'league1' })
  })
})
