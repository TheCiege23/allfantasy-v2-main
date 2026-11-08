'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { SettingsRow, SettingsSection } from '@/app/league/[leagueId]/tabs/settings/components'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

type C2cAiPrefs = {
  campusScouting: boolean
  transition: boolean
  rosterBalance: boolean
  draftAi: boolean
  copilot: boolean
  weeklyRecaps: boolean
}

const lsKey = (leagueId: string) => `af-c2c-ai-prefs-${leagueId}`

export function C2CAIPanel({
  leagueId,
  hasAfSub,
  c2cConfig,
  isCommissioner = false,
}: {
  leagueId: string
  hasAfSub: boolean
  c2cConfig: C2CConfigClient | null
  isCommissioner?: boolean
}) {
  const [prefs, setPrefs] = useState<C2cAiPrefs>({
    campusScouting: true,
    transition: true,
    rosterBalance: true,
    draftAi: true,
    copilot: true,
    weeklyRecaps: true,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [out, setOut] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const { handleApiResponse, gate } = useAfSubGate('commissioner_c2c_scouting')
  const [teamCount, setTeamCount] = useState(12)
  const [experience, setExperience] = useState('mixed')
  const [chatMsg, setChatMsg] = useState('')
  const [week, setWeek] = useState(1)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(lsKey(leagueId))
      if (raw) {
        const p = JSON.parse(raw) as Partial<C2cAiPrefs>
        setPrefs((prev) => ({ ...prev, ...p }))
      }
    } catch {
      /* ignore */
    }
  }, [leagueId])

  const persistPrefs = useCallback(
    (next: C2cAiPrefs) => {
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
      const res = await fetch('/api/c2c/ai', {
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

  const sportPair = c2cConfig?.sportPair ?? 'NFL_CFB'

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 md:px-6" data-testid="c2c-ai-panel">
      {!hasAfSub ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-100">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            AF Commissioner Subscription gates C2C AI execution — toggles are local preferences only until AfSub is
            active.
          </span>
          <SubscriptionGateBadge
            featureId="commissioner_c2c_scouting"
            onClick={() => gate('commissioner_c2c_scouting')}
          />
        </div>
      ) : null}

      <SettingsSection id="c2c-ai" title="C2C AI preferences">
        <SettingsRow
          label="Campus scouting"
          control={
            <input
              type="checkbox"
              checked={prefs.campusScouting}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, campusScouting: e.target.checked })}
              data-testid="c2c-ai-campus"
            />
          }
        />
        <SettingsRow
          label="Transition projections"
          control={
            <input
              type="checkbox"
              checked={prefs.transition}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, transition: e.target.checked })}
              data-testid="c2c-ai-transition"
            />
          }
        />
        <SettingsRow
          label="Roster balance"
          control={
            <input
              type="checkbox"
              checked={prefs.rosterBalance}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, rosterBalance: e.target.checked })}
              data-testid="c2c-ai-balance"
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
              data-testid="c2c-ai-draft"
            />
          }
        />
        <SettingsRow
          label="Commissioner copilot"
          control={
            <input
              type="checkbox"
              checked={prefs.copilot}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, copilot: e.target.checked })}
              data-testid="c2c-ai-copilot"
            />
          }
        />
        <SettingsRow
          label="Weekly recaps"
          control={
            <input
              type="checkbox"
              checked={prefs.weeklyRecaps}
              disabled={!hasAfSub}
              onChange={(e) => void persistPrefs({ ...prefs, weeklyRecaps: e.target.checked })}
              data-testid="c2c-ai-recaps"
            />
          }
        />
      </SettingsSection>

      {locked ? (
        <p className="text-[12px] text-amber-200/90">Upgrade to run C2C AI endpoints from this panel.</p>
      ) : null}

      <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Run tools (AF Commissioner)</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() =>
              void run('setup_rec', {
                sportPair,
                teamCount,
                experience,
              })
            }
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-[12px] font-semibold text-cyan-100 disabled:opacity-40"
          >
            {busy === 'setup_rec' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Setup advisor'}
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
            onClick={() => void run('campus_rankings')}
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            Campus rankings
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
            onClick={() => void run('weekly_recap', { week })}
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            Weekly recap
          </button>
          <button
            type="button"
            disabled={!hasAfSub || busy !== null}
            onClick={() =>
              void run('draft_advice', {
                draftType: c2cConfig?.startupDraftFormat ?? 'combined',
                pickNumber: 1,
              })
            }
            className="rounded-lg border border-white/[0.1] px-3 py-2 text-[12px] text-white/85 disabled:opacity-40"
          >
            Draft advice (smoke test)
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-white/50">
            Teams (setup)
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
              <option value="new">New leagues</option>
              <option value="mixed">Mixed</option>
              <option value="experienced">Experienced</option>
              <option value="competitive">Competitive</option>
            </select>
          </label>
          <label className="text-[11px] text-white/50">
            Recap week
            <input
              type="number"
              min={1}
              max={24}
              value={week}
              onChange={(e) => setWeek(Number(e.target.value) || 1)}
              className="mt-1 w-full rounded border border-white/[0.1] bg-black/30 px-2 py-1 text-[13px] text-white"
            />
          </label>
        </div>
        {isCommissioner ? (
          <div className="space-y-2 border-t border-white/[0.06] pt-3">
            <p className="text-[11px] text-white/45">Commissioner copilot</p>
            <textarea
              value={chatMsg}
              onChange={(e) => setChatMsg(e.target.value)}
              placeholder="Ask Chimmy about C2C settings…"
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
