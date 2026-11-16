/**
 * The settings window's notification switches (2026-11-15): only the one a sender reads is offered.
 * Trade, waiver, lineup and playoff-race switches were saved and read by nothing; members control those alerts.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { NotificationsSettingsPanel } from '@/app/league/[leagueId]/components/settings/NotificationsSettingsPanel'

describe('the Notifications tab', () => {
  it('offers commissioner broadcasts only, and says where members set the rest', () => {
    render(<NotificationsSettingsPanel settingsSnapshot={{}} canEdit save={vi.fn(async () => undefined)} />)
    expect(screen.getByText('Commissioner broadcasts')).toBeTruthy()
    for (const gone of ['Trade alerts', 'Waiver results', 'Lineup lock reminders', 'Playoff race & clinch']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.getByTestId('notifications-member-owned').textContent).toMatch(/their own/)
  })

  it('turning broadcasts off saves the key the announcement sender reads, keeping other stored keys', () => {
    const save = vi.fn(async () => undefined)
    render(<NotificationsSettingsPanel settingsSnapshot={{ leagueNotificationPrefs: { tradeAlerts: false } }} canEdit save={save} />)
    fireEvent.click(screen.getByText('Commissioner broadcasts'))
    expect(save).toHaveBeenCalledWith({ settingsMerge: { leagueNotificationPrefs: { tradeAlerts: false, commissionerBroadcasts: false } } })
  })
})
