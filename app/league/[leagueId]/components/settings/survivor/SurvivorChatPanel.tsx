'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Toggle } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

export function SurvivorChatPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [tribeChat, setTribeChat] = useState(true)
  const [mergeChat, setMergeChat] = useState(true)
  const [exileChat, setExileChat] = useState(true)
  const [juryChat, setJuryChat] = useState(true)
  const [alliances, setAlliances] = useState(false)
  const [elimNoTribe, setElimNoTribe] = useState(true)
  const [exileReadMain, setExileReadMain] = useState(false)
  const [reunion, setReunion] = useState(true)
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
        Link league chat in league settings, then post the dynamic FAQ so everyone sees how this league runs.
      </p>

      <SettingsSection id="sv-faq" title="League chat FAQ">
        <SettingsRow
          label="Survivor + Exile FAQ"
          description={
            faqLoading
              ? 'Loading status…'
              : faqSeededAt
                ? `Already posted ${new Date(faqSeededAt).toLocaleString()} — pin is idempotent; use if you changed settings.`
                : 'Not posted yet. Posts as broadcast and pins (uses your league’s Survivor settings).'
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

      <SettingsSection id="sv-chat-create" title="Chat permissions">
        <SettingsRow label="Tribe chats auto-created" control={<Toggle checked={tribeChat} onChange={setTribeChat} disabled={d} />} />
        <SettingsRow label="Merge chat auto-created" control={<Toggle checked={mergeChat} onChange={setMergeChat} disabled={d} />} />
        <SettingsRow label="Exile chat auto-created" control={<Toggle checked={exileChat} onChange={setExileChat} disabled={d} />} />
        <SettingsRow label="Jury chat auto-created" control={<Toggle checked={juryChat} onChange={setJuryChat} disabled={d} />} />
        <SettingsRow label="Alliance chats allowed" control={<Toggle checked={alliances} onChange={setAlliances} disabled={d} />} />
      </SettingsSection>
      <SettingsSection id="sv-chat-rules" title="Chat access rules">
        <SettingsRow
          label="Eliminated lose tribe chat input"
          control={<Toggle checked={elimNoTribe} onChange={setElimNoTribe} disabled={d} />}
        />
        <SettingsRow
          label="Exile can read main island history"
          control={<Toggle checked={exileReadMain} onChange={setExileReadMain} disabled={d} />}
        />
        <SettingsRow label="Post-season full chat access" control={<Toggle checked={reunion} onChange={setReunion} disabled={d} />} />
      </SettingsSection>
    </div>
  )
}
