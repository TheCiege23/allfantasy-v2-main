import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationsCenter } from '@/components/core-app/screens/NotificationsCenter'
import type { NotificationsCenterData } from '@/lib/core-app/notificationsCenter'
const account = vi.hoisted(() => ({ id: 'A' }))
vi.mock('@/components/providers/ClientSyncAccountProvider', () => ({ useClientSyncAccount: () => account.id }))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))
vi.mock('@/components/core-app/screens/NotificationRowMute', () => ({ NotificationRowMute: () => null }))
const data = (viewerId = 'A', leagueId: string | null = null): NotificationsCenterData => ({
  viewerId, leagueId, actToday: [], rest: [{ id: viewerId, kind: 'trades', title: `Notice ${viewerId}`, detail: 'Trade updated', createdAt: '2026-10-04T12:00:00Z', read: false, severity: 'info' }],
  unread: 1, listed: 1, olderNotListed: 0, mentionsAvailable: false,
  counts: { all: 1, trades: 1, waivers: 0, lineups: 0, mentions: 0, commissioner: 0, drafts: 0 },
  push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
})
beforeEach(() => { account.id = 'A' })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('hides the previous account while its server snapshot is stale', () => {
  const view = render(<NotificationsCenter data={data()} />)
  account.id = 'B'
  view.rerender(<NotificationsCenter data={data()} />)
  expect(screen.queryByText('Notice A')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('Loading')
  view.rerender(<NotificationsCenter data={data('B')} />)
  expect(screen.getByText('Notice B')).toBeTruthy()
})
it('ignores a late receipt after switching leagues', async () => {
  let resolve!: (value: unknown) => void
  const request = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r }))
  vi.stubGlobal('fetch', request)
  const view = render(<NotificationsCenter data={data('A', 'league1')} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  view.rerender(<NotificationsCenter data={data('A', 'league2')} />)
  await act(async () => { resolve({ ok: true, json: async () => ({ success: true }) }) })
  expect(screen.getByText(/1 waiting in this league/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled).toBe(false)
  expect(JSON.parse(request.mock.calls[0][1].body).leagueId).toBe('league1')
})
it('preserves unread state on a malformed success acknowledgement and permits retry', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', request)
  render(<NotificationsCenter data={data()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(screen.getByText(/1 waiting/)).toBeTruthy()
  request.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy())
})
it('restores server unread totals when a fresh snapshot arrives after mark-all', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }))
  const view = render(<NotificationsCenter data={data()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy())
  view.rerender(<NotificationsCenter data={{ ...data(), unread: 3 }} />)
  expect(screen.getByText(/3 waiting/)).toBeTruthy()
})
