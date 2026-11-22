import React from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NotificationRow, NotificationsCenterData } from '@/lib/core-app/notificationsCenter'
import { survivorNotificationIcon, survivorNotificationKind } from '@/lib/core-app/survivorNotificationIcon'
import { SURVIVOR_NOTIFICATION_KINDS } from '@/lib/survivor/survivorNotificationCatalog'

vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))
vi.mock('@/components/core-app/screens/NotificationRowMute', () => ({ NotificationRowMute: () => null }))

import { NotificationsCenter } from '@/components/core-app/screens/NotificationsCenter'

/** Survivor rows on /core notifications wear an island icon by kind. Display only. */

afterEach(() => cleanup())

describe('survivorNotificationKind', () => {
  it('reads the kind out of a stored survivor:<kind> type, and nothing else', () => {
    expect(survivorNotificationKind('survivor:idol_found')).toBe('idol_found')
    expect(survivorNotificationKind('survivor:commissioner_chimmy_weekly_report')).toBe('commissioner_chimmy_weekly_report')
    expect(survivorNotificationKind('survivor:')).toBeNull()
    expect(survivorNotificationKind('trade_offer')).toBeNull()
    expect(survivorNotificationKind('survivor_ai')).toBeNull()
    expect(survivorNotificationKind(null)).toBeNull()
  })
})

describe('survivorNotificationIcon', () => {
  it('maps every kind Survivor emits to its icon', () => {
    expect(survivorNotificationIcon('votes_close_soon')).toBe('ballot')
    expect(survivorNotificationIcon('vote_reminder')).toBe('ballot')
    expect(survivorNotificationIcon('council_read')).toBe('torch')
    expect(survivorNotificationIcon('elimination')).toBe('skull')
    expect(survivorNotificationIcon('torch_out')).toBe('skull')
    expect(survivorNotificationIcon('immunity_won')).toBe('immunity')
    expect(survivorNotificationIcon('idol_found')).toBe('idol')
    expect(survivorNotificationIcon('challenge_posted')).toBe('challenge')
    expect(survivorNotificationIcon('challenge_closing')).toBe('challenge')
    expect(survivorNotificationIcon('tribe_swap')).toBe('swap')
    expect(survivorNotificationIcon('tribe_shuffle_recommendation')).toBe('swap')
    expect(survivorNotificationIcon('commissioner_tribes_rebalanced')).toBe('swap')
    expect(survivorNotificationIcon('merge_announced')).toBe('merge')
    expect(survivorNotificationIcon('back_from_exile')).toBe('exile')
    expect(survivorNotificationIcon('commissioner_exile_setup_failed')).toBe('exile')
    expect(survivorNotificationIcon('jury_vote_open')).toBe('jury')
    expect(survivorNotificationIcon('commissioner_jury_overdue')).toBe('jury')
    expect(survivorNotificationIcon('season_champion')).toBe('crown')
    expect(survivorNotificationIcon('commissioner_chimmy_weekly_report')).toBe('chimmy')
    expect(survivorNotificationIcon('steal_three')).toBe('raid')
    expect(survivorNotificationIcon('sit_out_nomination')).toBe('ballot')
    expect(survivorNotificationIcon('phase_change')).toBe('torch')
  })

  it('gives each of the eight catalog notifications a specific icon, never the fallback', () => {
    for (const kind of SURVIVOR_NOTIFICATION_KINDS) {
      expect(survivorNotificationIcon(kind), kind).not.toBeNull()
      expect(survivorNotificationIcon(kind), kind).not.toBe('alert')
    }
  })

  it('falls back by family, and draws nothing for no kind', () => {
    expect(survivorNotificationIcon('commissioner_scores_overdue')).toBe('alert')
    expect(survivorNotificationIcon('commissioner_automation_error')).toBe('alert')
    expect(survivorNotificationIcon('draft_cast_incomplete')).toBe('alert')
    expect(survivorNotificationIcon('something_new')).toBe('torch')
    expect(survivorNotificationIcon('')).toBeNull()
    expect(survivorNotificationIcon(undefined)).toBeNull()
  })
})

const row = (id: string, over: Partial<NotificationRow> = {}): NotificationRow => ({
  id, kind: 'all', title: 'The tribe has spoken', detail: 'Week 7 Council is ready to view.',
  leagueId: 'sv1', leagueName: 'Outcast Isles', platform: 'native',
  createdAt: '2026-10-31T12:00:00Z', read: false, severity: 'info',
  action: { label: 'Open league', href: '/core?league=sv1', external: false },
  ...over,
})
const data = (rest: NotificationRow[]): NotificationsCenterData => ({
  actToday: [], rest,
  counts: { all: rest.length, trades: 0, waivers: 0, lineups: 0, mentions: 0, drafts: 0, commissioner: 0 },
  unread: rest.length, listed: rest.length, olderNotListed: 0, leagueId: 'sv1', mentionsAvailable: false,
  push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
})

describe('Survivor rows in the notifications centre', () => {
  it('draws the kind’s icon and the island accent on a Survivor row only', () => {
    const { container } = render(
      <NotificationsCenter
        data={data([
          row('a', { survivorType: 'idol_found', title: 'You found a hidden idol' }),
          row('b', { survivorType: 'torch_out', title: 'Your torch is out' }),
          row('c', { title: 'Check your lineup', detail: 'A starter is out', leagueId: 'other', leagueName: 'Home league' }),
        ])}
      />,
    )
    const items = Array.from(container.querySelectorAll('li.af-nt-row')) as HTMLElement[]
    const byTitle = (t: string) => items.find((li) => li.textContent?.includes(t)) as HTMLElement
    const idol = byTitle('You found a hidden idol')
    expect(idol.getAttribute('data-survivor')).toBe('idol')
    expect(within(idol).getByTestId('survivor-notification-icon').querySelector('svg')?.getAttribute('data-sv-icon')).toBe('idol')
    expect(byTitle('Your torch is out').getAttribute('data-survivor')).toBe('skull')
    const plain = byTitle('Check your lineup')
    expect(plain.getAttribute('data-survivor')).toBeNull()
    expect(within(plain).queryByTestId('survivor-notification-icon')).toBeNull()
    // Content unchanged: the title, detail and action are the row's own.
    expect(within(idol).getByText('Week 7 Council is ready to view.')).toBeTruthy()
  })
})
