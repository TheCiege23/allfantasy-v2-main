'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsRow, SettingsSection, Toggle } from '../../../tabs/settings/components'

/**
 * Commissioner toggle for Survivor share cards (`shareCardsEnabled`, default on). Off hides the
 * share UI for everyone and makes every public moment page and card image return 404. It can be
 * changed at any point in the season — it is not one of the rules that lock at the draft.
 */
export function SurvivorShareCardsSetting({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/state`, { credentials: 'include' })
      const data = (await res.json().catch(() => ({}))) as { settings?: { shareCardsEnabled?: boolean } }
      setEnabled(data.settings?.shareCardsEnabled !== false)
    } catch {
      setEnabled(true)
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  async function save(next: boolean) {
    if (!canEdit) return
    setSaving(true)
    setMessage(null)
    const previous = enabled
    setEnabled(next)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/update-settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { shareCardsEnabled: next } }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; settings?: { shareCardsEnabled?: boolean } }
      if (!res.ok) throw new Error(data.error ?? 'Could not save share card setting')
      setEnabled(data.settings?.shareCardsEnabled ?? next)
      setMessage(next ? 'Share cards are on.' : 'Share cards are off. Moment pages now return “not found”.')
    } catch (error) {
      setEnabled(previous)
      setMessage(error instanceof Error ? error.message : 'Could not save share card setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection id="sv-share-cards" title="Share cards">
      <SettingsRow
        label="Allow share cards"
        description="Managers can turn big moments into images and public link pages. Turn this off for a private league; existing links stop working."
        control={<Toggle checked={enabled ?? true} onChange={value => void save(value)} disabled={!canEdit || saving || enabled == null} />}
      />
      {message && <p role="status" className="text-xs text-amber-200/90">{message}</p>}
    </SettingsSection>
  )
}
