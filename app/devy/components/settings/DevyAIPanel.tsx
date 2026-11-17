'use client'

import { useCallback, useEffect, useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { SettingsRow, SettingsSection } from '@/app/league/[leagueId]/tabs/settings/components'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { useAfSubGate } from '@/hooks/useAfSubGate'

type DevyPrefs = {
  scouting: boolean
  draftAi: boolean
  setupAdvisor: boolean
  importAssist: boolean
  commissionerCopilot: boolean
  autoSummaries: boolean
}

const lsKey = (leagueId: string) => `af-devy-ai-prefs-${leagueId}`

export function DevyAIPanel({
  leagueId,
  hasAfSub,
  isCommissioner = false,
}: {
  leagueId: string
  hasAfSub: boolean
  isCommissioner?: boolean
}) {
  const [prefs, setPrefs] = useState<DevyPrefs>({
    scouting: true,
    draftAi: true,
    setupAdvisor: true,
    importAssist: true,
    commissionerCopilot: true,
    autoSummaries: true,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [out, setOut] = useState<string | null>(null)
  const [teamCount, setTeamCount] = useState(12)
  const [experience, setExperience] = useState('mixed')
  const [familiarity, setFamiliarity] = useState('mixed')
  const [chatMsg, setChatMsg] = useState('')
  const [seasonY, setSeasonY] = useState(new Date().getFullYear())
  const [locked, setLocked] = useState(false)
  const { handleApiResponse, gate } = useAfSubGate('commissioner_devy_scouting')

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(lsKey(leagueId))
      if (raw) {
        const p = JSON.parse(raw) as Partial<DevyPrefs>
        setPrefs((prev) => ({ ...prev, ...p }))
      }
    } catch {
      /* ignore */
    }
  }, [leagueId])

  const persistPrefs = useCallback(
    (next: DevyPrefs) => {
      setPrefs(next)
      try {
        window.localStorage.setItem(lsKey(leagueId), JSON.stringify(next))
      } catch {
        /* ignore */
      }
    },
    [leagueId],
  )

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action)
    setLocked(false)
    setOut(null)
    try {
      const res = await fetch('/api/devy/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, action, ...extra }),
      })
      if (!(await handleApiResponse(res))) {
        setLocked(true)
        return
      }
      const data = await res.json().catch(() => ({}))
      setOut(JSON.stringify(data, null, 2))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 md:px-6">
      {!hasAfSub ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-100">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Devy AI runs with AF Commissioner. Until then, these toggles are saved as preferences only.
          </span>
          <SubscriptionGateBadge
            featureId="commissioner_devy_scouting"
            onClick={() => gate('commissioner_devy_scouting')}
          />
        </div>
      ) : null}

      <SettingsSection id="devy-ai" title="Devy AI">
        <SettingsRow
          label="Devy scouting tools"
          control={
            <input
              type="checkbox"
              checked={prefs.scouting}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, scouting: e.target.checked })}
            />
          }
        />
        <SettingsRow
          label="Draft AI"
          control={
            <input
              type="checkbox"
              checked={prefs.draftAi}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, draftAi: e.target.checked })}
            />
          }
        />
        <SettingsRow
          label="Setup advisor"
          control={
            <input
              type="checkbox"
              checked={prefs.setupAdvisor}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, setupAdvisor: e.target.checked })}
            />
          }
        />
        <SettingsRow
          label="Import assistant"
          control={
            <input
              type="checkbox"
              checked={prefs.importAssist}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, importAssist: e.target.checked })}
            />
          }
        />
        <SettingsRow
          label="Commissioner copilot"
          control={
            <input
              type="checkbox"
              checked={prefs.commissionerCopilot}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, commissionerCopilot: e.target.checked })}
            />
          }
        />
        <SettingsRow
          label="Auto summaries"
          control={
            <input
              type="checkbox"
              checked={prefs.autoSummaries}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, autoSummaries: e.target.checked })}
            />
          }
        />
      </SettingsSection>

      {locked ? (
        <p className="text-[12px] text-amber-200/90">Upgrade to run Devy AI endpoints from this panel.</p>
      ) : null}

      <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Run tools (AF Commissioner)</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() =>
              void run('setup_recommendation', {
                teamCount,
                leagueExperience: experience,
                managerFamiliarity: familiarity,
              })
            }
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-[12px] font-semibold text-cyan-100 disabled:opacity-40"
          >
            {busy === 'setup_recommendation' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Setup recommendation'}
          </button>
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() => void run('breakout_alerts')}
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            Breakout alerts
          </button>
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() => void run('constitution')}
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            League constitution
          </button>
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() => void run('annual_report', { season: seasonY })}
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            Annual report
          </button>
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() => void run('draft_advice', { draftType: 'startup', pick: 1, managerId: undefined })}
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            Draft advice (smoke test)
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-white/50">
            Teams
            <input
              type="number"
              min={8}
              max={32}
              value={teamCount}
              onChange={(e) => setTeamCount(Number(e.target.value) || 12)}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[13px] text-white"
            />
          </label>
          <label className="text-[11px] text-white/50">
            Experience
            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[13px] text-white"
            >
              <option value="first-time">First-time devy</option>
              <option value="mixed">Mixed</option>
              <option value="experienced">Experienced</option>
            </select>
          </label>
          <label className="text-[11px] text-white/50">
            Familiarity
            <select
              value={familiarity}
              onChange={(e) => setFamiliarity(e.target.value)}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[13px] text-white"
            >
              <option value="first-time">First-time</option>
              <option value="mixed">Mixed</option>
              <option value="experienced">Experienced</option>
            </select>
          </label>
        </div>
        <label className="block text-[11px] text-white/50">
          Annual report season
          <input
            type="number"
            value={seasonY}
            onChange={(e) => setSeasonY(Number(e.target.value) || new Date().getFullYear())}
            className="mt-1 w-full max-w-[140px] rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[13px] text-white"
          />
        </label>
        {isCommissioner ? (
          <div className="space-y-2 border-t border-white/[0.06] pt-3">
            <p className="text-[11px] text-white/45">Commissioner copilot</p>
            <textarea
              value={chatMsg}
              onChange={(e) => setChatMsg(e.target.value)}
              placeholder="Ask Chimmy about devy settings…"
              rows={2}
              className="w-full rounded-lg border border-white/[0.1] bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/35"
            />
            <button
              type="button"
              disabled={!hasAfSub || busy !== null || !chatMsg.trim()}
              onClick={() => void run('commissioner_chat', { message: chatMsg.trim() })}
              className="rounded-lg border border-violet-500/35 bg-violet-500/10 px-3 py-2 text-[12px] font-semibold text-violet-100 disabled:opacity-40"
            >
              Send to Chimmy
            </button>
          </div>
        ) : null}
      </div>

      {out ? (
        <pre className="max-h-[320px] overflow-auto rounded-lg border border-white/[0.08] bg-black/40 p-3 text-[11px] text-white/70">
          {out}
        </pre>
      ) : null}
    </div>
  )
}
