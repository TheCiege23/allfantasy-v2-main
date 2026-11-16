'use client'

import { useEffect, useState } from 'react'
import { SettingsPanelHeading, SettingsSectionLabel, SettingsToggleRow } from './settings-ui'

type Prefs = {
  tradeAlerts?: boolean
  waiverResults?: boolean
  lineupLockReminders?: boolean
  playoffRace?: boolean
  commissionerBroadcasts?: boolean
}

function readPrefs(snapshot: Record<string, unknown>): Prefs {
  const raw = snapshot.leagueNotificationPrefs
  return raw && typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Prefs) : {}
}

export function NotificationsSettingsPanel({
  settingsSnapshot,
  canEdit,
  save,
}: {
  settingsSnapshot: Record<string, unknown>
  canEdit: boolean
  save: (partial: Record<string, unknown>) => Promise<void>
}) {
  const disabled = !canEdit
  const p = readPrefs(settingsSnapshot)
  const [commissionerBroadcasts, setCommissionerBroadcasts] = useState(p.commissionerBroadcasts !== false)

  useEffect(() => {
    setCommissionerBroadcasts(readPrefs(settingsSnapshot).commissionerBroadcasts !== false)
  }, [settingsSnapshot])

  const push = (next: Prefs) => {
    const prev = readPrefs(settingsSnapshot)
    void save({
      settingsMerge: {
        leagueNotificationPrefs: {
          ...prev,
          ...next,
        },
      },
    })
  }

  return (
    <div className="min-h-0 flex-1 space-y-6 px-6 py-6 text-[13px] text-white/85" data-testid="settings-notifications-panel">
      <SettingsPanelHeading
        title="Notifications"
        subtitle="League-level notification defaults. Delivery still respects each member’s account and device settings."
      />

      {/*
        🛑 FOUR OF THESE FIVE SWITCHES DID NOTHING (2026-11-15). Trade alerts, waiver results, lineup lock reminders and
        playoff race were saved and never read by any sender. The first three are each manager's own alerts (an offer
        to them, their claim, their lineup), so a league-wide switch would hide things members must act on; members
        already turn them on or off per league in their own notification settings. Only the broadcast switch, which
        the announcement sender reads, is offered here.
      */}
      <p className="mb-2 text-[11px] leading-relaxed text-white/40" data-testid="notifications-member-owned">
        Trade, waiver and lineup alerts belong to each manager, who can turn them on or off for this league in their own
        notification settings.
      </p>

      <div className="space-y-2">
        <SettingsSectionLabel>League announcements</SettingsSectionLabel>
        <SettingsToggleRow
          label="Commissioner broadcasts"
          checked={commissionerBroadcasts}
          disabled={disabled}
          onChange={(v) => {
            setCommissionerBroadcasts(v)
            push({ commissionerBroadcasts: v })
          }}
        />
      </div>
    </div>
  )
}
