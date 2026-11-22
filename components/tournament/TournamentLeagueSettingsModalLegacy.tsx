'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'structure', label: 'Tournament structure' },
  { id: 'draft', label: 'Draft' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'roster', label: 'Roster' },
  { id: 'commissioner', label: 'Commissioner' },
  { id: 'ai', label: 'Chimmy & automation' },
] as const

type Tab = (typeof TABS)[number]['id']

type HubSnap = {
  visibility: string
  waitlistEnabled: boolean
  maxWaitlist: number | null
}

/**
 * Legacy tournament settings — universal hub PATCH via `/api/tournament/[id]/legacy-settings`.
 */
export function TournamentLeagueSettingsModalLegacy({
  open,
  onClose,
  tournamentId,
  hubSnapshot,
  canEdit,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  tournamentId: string
  hubSnapshot?: HubSnap
  canEdit: boolean
  onSaved: () => void
}) {
  const [tab, setTab] = useState<Tab>('general')
  const [mode, setMode] = useState<'universal' | 'override'>('universal')
  const [waitlistEnabled, setWaitlistEnabled] = useState(false)
  const [maxWaitlist, setMaxWaitlist] = useState<string>('100')
  const [visibility, setVisibility] = useState('unlisted')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !hubSnapshot) return
    setWaitlistEnabled(hubSnapshot.waitlistEnabled)
    setMaxWaitlist(hubSnapshot.maxWaitlist != null ? String(hubSnapshot.maxWaitlist) : '100')
    setVisibility(typeof hubSnapshot.visibility === 'string' ? hubSnapshot.visibility : 'unlisted')
  }, [open, hubSnapshot])

  async function saveHub() {
    if (!canEdit) return
    setSaving(true)
    setSaveError(null)
    try {
      const max = parseInt(maxWaitlist, 10)
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/legacy-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hubSettings: {
            waitlistEnabled,
            maxWaitlist: Number.isFinite(max) && max > 0 ? max : 100,
            visibility,
          },
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof j.error === 'string' ? j.error : 'Save failed')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-0 backdrop-blur-md md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tournament-league-settings-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0a1228] shadow-2xl md:h-[88vh] md:rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div>
            <h2 id="tournament-league-settings-title" className="text-base font-bold text-white">
              Tournament league settings
            </h2>
            <p className="text-xs text-white/50">
              {mode === 'universal' ? 'Universal template (all sub-leagues)' : 'Individual league override'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1.5 ${mode === 'universal' ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/55'}`}
                onClick={() => setMode('universal')}
              >
                Universal
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1.5 ${mode === 'override' ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/55'}`}
                onClick={() => setMode('override')}
              >
                Override
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-white/55 hover:bg-white/10 hover:text-white"
              data-testid="tournament-league-settings-close"
            >
              Close
            </button>
          </div>
        </div>

        {!canEdit ? (
          <div className="p-6 text-sm text-amber-200/90">
            You can view settings, but only the creator or staff with <strong>manage settings</strong> can save changes.
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:px-3 md:py-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-2 text-left text-xs font-semibold md:text-sm ${
                  tab === t.id ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/90'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {tab === 'general' && (
              <section className="space-y-4 text-sm text-white/80">
                <p>
                  Hub visibility and waitlist are stored on the tournament record. Saving applies to all sub-leagues
                  unless you use per-league overrides (future).
                </p>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-white/45">Hub visibility</label>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                    disabled={!canEdit}
                    className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white disabled:opacity-50"
                  >
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={waitlistEnabled}
                    onChange={(e) => setWaitlistEnabled(e.target.checked)}
                    disabled={!canEdit}
                    className="rounded border-white/20"
                  />
                  <span>Enable waitlist when feeder leagues are full</span>
                </label>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-white/45">Max waitlist size</label>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={maxWaitlist}
                    onChange={(e) => setMaxWaitlist(e.target.value)}
                    disabled={!canEdit}
                    className="w-full max-w-xs rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white disabled:opacity-50"
                  />
                </div>
                {saveError ? (
                  <p className="text-sm text-rose-300" role="alert">
                    {saveError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canEdit || saving}
                    onClick={() => void saveHub()}
                    className="rounded-xl border border-cyan-500/35 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save hub settings'}
                  </button>
                  <Link href={`/tournament/${tournamentId}`} className="text-sm text-cyan-400/90 hover:text-cyan-300">
                    Open tournament hub →
                  </Link>
                </div>
              </section>
            )}
            {tab === 'structure' && (
              <p className="text-sm text-white/70">
                Participant pool and phase timing live in tournament settings — use hub or commissioner APIs. Structural
                edits may be blocked after lock.
              </p>
            )}
            {tab === 'draft' && (
              <p className="text-sm text-white/70">
                Per-league draft rooms control snake/auction and timers. Tournament-wide defaults follow creation
                settings.
              </p>
            )}
            {tab === 'scoring' && (
              <p className="text-sm text-white/70">
                Scoring is sport-aware per feeder league. Tiebreakers: wins, then points for.
              </p>
            )}
            {tab === 'roster' && (
              <p className="text-sm text-white/70">
                Phase-specific benches and IR follow tournament round records.
              </p>
            )}
            {tab === 'commissioner' && (
              <p className="text-sm text-white/70">
                Assign tournament-wide staff via the Members tab (creator). Mini-commissioners remain per feeder league
                in the API.
              </p>
            )}
            {tab === 'ai' && (
              <p className="text-sm text-white/70">
                Chimmy recap and announcements run from the Operations console.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
