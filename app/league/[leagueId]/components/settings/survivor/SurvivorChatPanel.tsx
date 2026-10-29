'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'
import { SurvivorShareCardsSetting } from './SurvivorShareCardsSetting'

export function SurvivorChatPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const d = !canEdit

  const [faqSeededAt, setFaqSeededAt] = useState<string | null>(null)
  const [faqLoading, setFaqLoading] = useState(true)
  const [faqPosting, setFaqPosting] = useState(false)
  const [faqMessage, setFaqMessage] = useState<string | null>(null)

  const loadFaq = useCallback(async () => {
    setFaqLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as { config?: { faqSeededAt?: string | null } | null }
      setFaqSeededAt(data.config?.faqSeededAt ?? null)
    } finally {
      setFaqLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    loadFaq()
  }, [loadFaq])

  async function postFaq() {
    if (d) return
    setFaqPosting(true)
    setFaqMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/seed-faq`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: Boolean(faqSeededAt) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFaqMessage(typeof data?.error === 'string' ? data.error : 'Could not post FAQ')
        return
      }
      setFaqMessage('FAQ posted to league chat and pinned.')
      await loadFaq()
    } catch {
      setFaqMessage('Network error')
    } finally {
      setFaqPosting(false)
    }
  }

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">
        Post the dynamic FAQ to league chat so everyone knows how this island runs. It gets pinned, so nobody gets to say they missed it.
      </p>

      <SettingsSection id="sv-faq" title="League chat FAQ">
        <SettingsRow
          label="Survivor + Exile FAQ"
          description={
            faqLoading
              ? 'Loading status…'
              : faqSeededAt
                ? `Already posted ${new Date(faqSeededAt).toLocaleString()} — pin is idempotent; use if you changed settings.`
                : 'Not posted yet. Posts to league chat as a commissioner announcement and pins it (built from your Survivor settings).'
          }
          control={
            <button
              type="button"
              onClick={() => postFaq()}
              disabled={d || faqPosting}
              className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-4 py-2 text-xs text-[#ffd7e5] hover:bg-cyan-950/55 disabled:opacity-40"
              data-testid="survivor-post-faq"
            >
              {faqPosting ? 'Posting…' : faqSeededAt ? 'Post FAQ again' : 'Post FAQ & pin'}
            </button>
          }
        />
        {faqMessage && <p className="text-xs text-[#ffb8d1]/90">{faqMessage}</p>}
      </SettingsSection>

      <SurvivorShareCardsSetting leagueId={leagueId} canEdit={canEdit} />

      <p className="text-xs text-white/50">Island, tribe, Exile and jury channel access follows each manager’s current game state. Custom chat-permission overrides are not available yet.</p>
    </div>
  )
}
