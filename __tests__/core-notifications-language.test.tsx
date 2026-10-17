import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { NotificationsCenterData } from '@/lib/core-app/notificationsCenter'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))
vi.mock('@/components/core-app/screens/NotificationRowMute', () => ({ NotificationRowMute: () => null }))

import { NotificationsCenter } from '@/components/core-app/screens/NotificationsCenter'

const data: NotificationsCenterData = {
  actToday: [], rest: [],
  counts: { all: 0, trades: 0, waivers: 0, lineups: 0, mentions: 0, commissioner: 0, drafts: 0 },
  unread: 0, listed: 0, olderNotListed: 0, leagueId: null, mentionsAvailable: false,
  push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
}

describe('Spanish Core notifications', () => {
  it('translates the empty state and filter controls', () => {
    render(<NotificationsCenter data={data} />)
    expect(screen.getByRole('heading', { name: 'Notificaciones' })).toBeTruthy()
    expect(screen.getByText('No tienes avisos pendientes.')).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Filtrar notificaciones' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Intercambios/ }))
    expect(screen.getByText('Nada en Intercambios.')).toBeTruthy()
  })
})
