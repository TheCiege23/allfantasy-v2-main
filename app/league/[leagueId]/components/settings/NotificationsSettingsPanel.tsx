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
  const [tradeAlerts, setTradeAlerts] = useState(p.tradeAlerts !== false)
  const [waiverResults, setWaiverResults] = useState(p.waiverResults !== false)
  const [lineupLockReminders, setLineupLockReminders] = useState(p.lineupLockReminders !== false)
  const [playoffRace, setPlayoffRace] = useState(p.playoffRace !== false)
  const [commissionerBroadcasts, setCommissionerBroadcasts] = useState(p.commissionerBroadcasts !== false)

  useEffect(() => {
    const n = readPrefs(settingsSnapshot)
    setTradeAlerts(n.tradeAlerts !== false)
    setWaiverResults(n.waiverResults !== false)
    setLineupLockReminders(n.lineupLockReminders !== false)
    setPlayoffRace(n.playoffRace !== false)
    setCommissionerBroadcasts(n.commissionerBroadcasts !== false)
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

      <p className="mb-2 text-[11px] leading-relaxed text-white/40">
        Toggles are stored on the league settings snapshot and can be read by notification routers and in-league surfaces.
      </p>

      <div className="space-y-2">
        <SettingsSectionLabel>League activity</SettingsSectionLabel>
        <SettingsToggleRow
          label="Trade alerts"
          checked={tradeAlerts}
          disabled={disabled}
          onChange={(v) => {
            setTradeAlerts(v)
            push({ tradeAlerts: v })
          }}
        />
        <SettingsToggleRow
          label="Waiver results"
          checked={waiverResults}
          disabled={disabled}
          onChange={(v) => {
            setWaiverResults(v)
            push({ waiverResults: v })
          }}
        />
        <SettingsToggleRow
          label="Lineup lock reminders"
          checked={lineupLockReminders}
          disabled={disabled}
          onChange={(v) => {
            setLineupLockReminders(v)
            push({ lineupLockReminders: v })
          }}
        />
        <SettingsToggleRow
          label="Playoff race & clinch"
          checked={playoffRace}
          disabled={disabled}
          onChange={(v) => {
            setPlayoffRace(v)
            push({ playoffRace: v })
          }}
        />
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
