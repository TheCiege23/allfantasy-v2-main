import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * Which rows on /core/notifications carry the Mute control (2026-09-14).
 *
 * Stored rows with a league: yes. "Act today" rows: no — they are deadlines derived from
 * league state, not notifications anyone sent, so a mute would silence nothing. Rows
 * with no league: no — there is no league to mute.
 */

// Device-only cards (push permission, PWA install) are not what is under test.
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))

import NotificationsCenter from '@/components/core-app/screens/NotificationsCenter'
import type { NotificationRow, NotificationsCenterData } from '@/lib/core-app/notificationsCenter'

const row = (over: Partial<NotificationRow>): NotificationRow => ({
  id: 'r',
  kind: 'trades',
  title: 'T',
  detail: 'D',
  category: null,
  leagueId: 'L1',
  leagueName: 'Dynasty',
  platform: 'sleeper',
  createdAt: '2026-09-14T00:00:00Z',
  read: false,
  severity: 'info',
  action: null,
  ...over,
})

const data = {
  actToday: [row({ id: 'issue:1', title: 'Lineup locks soon', kind: 'lineups' })],
  rest: [
    row({ id: 's1', title: 'Trade offer waiting', category: 'trade_proposals' }),
    row({ id: 's2', title: 'Account notice', leagueId: null, leagueName: null, kind: 'all' }),
  ],
  counts: { all: 3, trades: 1, waivers: 0, lineups: 1, mentions: 0, commissioner: 0, drafts: 0 },
  unread: 2,
  listed: 2,
  olderNotListed: 0,
  push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
  leagueId: null,
  mentionsAvailable: false,
} as unknown as NotificationsCenterData

describe('the Mute control is on the rows it can act on', () => {
  it('stored league rows get it; act-today and league-less rows do not', () => {
    render(<NotificationsCenter data={data} />)
    const item = (title: string) => screen.getByText(title).closest('li') as HTMLElement

    expect(within(item('Trade offer waiting')).queryByRole('button', { name: 'Mute' })).not.toBeNull()
    expect(within(item('Lineup locks soon')).queryByRole('button', { name: 'Mute' })).toBeNull()
    expect(within(item('Account notice')).queryByRole('button', { name: 'Mute' })).toBeNull()
  })
})
