'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type IntegrityApi = {
  settings: {
    id: string
    leagueId: string
    collusionSensitivity: string
    tankingMonitorEnabled: boolean
    tankingSensitivity: string
    tankingStartWeek: number | null
    tankingIllegalLineupCheck: boolean
    tankingBenchPatternCheck: boolean
    /** Suspicious-trade alerts (League.settings, lib/integrity/tradeAlerts.ts). Absent = on. */
    tradeAlertsEnabled?: boolean
    /** Hold flagged trades for commissioner review (lib/integrity/holdFlaggedTrades.ts). Absent = off. */
    holdFlaggedTrades?: boolean
    /** False in an imported league: its trades go through on the host, so there is nothing to hold. */
    holdFlaggedTradesSupported?: boolean
    tankingWaiverPatternCheck: boolean
  }
  stats: {
    openCollusion: number
    openTanking: number
  }
}

export function IntegritySettingsPanel(props: {
  leagueId: string
  hasAccess: boolean
  upgradeUrl?: string
}) {
  const { leagueId, hasAccess, upgradeUrl = '/commissioner-upgrade?highlight=integrity_monitoring' } = props
  const [data, setData] = useState<IntegrityApi | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!hasAccess) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/integrity`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as IntegrityApi & { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to load integrity settings')
      setData(json)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Load failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [hasAccess, leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!data) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/integrity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collusionSensitivity: data.settings.collusionSensitivity,
          tankingMonitorEnabled: data.settings.tankingMonitorEnabled,
          tankingSensitivity: data.settings.tankingSensitivity,
          tankingStartWeek: data.settings.tankingStartWeek,
          tankingIllegalLineupCheck: data.settings.tankingIllegalLineupCheck,
          tankingBenchPatternCheck: data.settings.tankingBenchPatternCheck,
          tankingWaiverPatternCheck: data.settings.tankingWaiverPatternCheck,
          tradeAlertsEnabled: data.settings.tradeAlertsEnabled !== false,
          holdFlaggedTrades: data.settings.holdFlaggedTrades === true,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { settings?: IntegrityApi['settings']; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      if (json.settings) {
        setData((d) => (d ? { ...d, settings: { ...d.settings, ...json.settings } } : d))
      }
      toast.success('Integrity settings saved.')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!hasAccess) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1328] p-4 mt-4">
        <h4 className="text-sm font-bold text-white">🔍 Integrity Monitoring</h4>
        <p className="mt-1 text-xs text-white/50">
          Automatically detect collusion and tanking with AI. Requires AF Commissioner subscription.
        </p>
        <Link
          href={upgradeUrl}
          className="mt-3 inline-flex rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/15"
        >
          Upgrade to AF Commissioner →
        </Link>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1328] p-4 mt-4 text-xs text-white/45">
        Loading integrity settings…
      </div>
    )
  }

  const s = data.settings
  const stats = data.stats

  return (
    <div className="rounded-xl border border-cyan-500/15 bg-[#081226] p-4 mt-4" data-testid="integrity-settings-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-white">🔍 Integrity Monitoring</h4>
          {(stats.openCollusion > 0 || stats.openTanking > 0) && (
            <p className="mt-1 text-[11px] text-amber-200/90">
              {stats.openCollusion} open collusion · {stats.openTanking} open tanking
            </p>
          )}
        </div>
        <Link
          href={`/league/${leagueId}/commissioner/integrity`}
          className="text-[11px] font-semibold text-cyan-300 hover:underline"
        >
          View All Flags →
        </Link>
      </div>

      <div className="mt-4 space-y-4 text-xs text-white/80">
        <div>
          <p className="font-semibold text-white">ANTI-COLLUSION</p>
          <p className="mt-1 text-white/50">
            Always active for entitled commissioner leagues. Analyzes trades for value imbalances — no chat access.
          </p>
          <p className="mt-2 text-[11px] text-white/45">Sensitivity</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['low', 'medium', 'high'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setData((d) => (d ? { ...d, settings: { ...d.settings, collusionSensitivity: k } } : d))}
                className={`rounded-lg border px-2 py-1 text-[11px] capitalize ${
                  s.collusionSensitivity === k ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100' : 'border-white/15'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-white/80">Alert me when a trade is flagged</p>
          <button
            type="button"
            aria-pressed={s.tradeAlertsEnabled !== false}
            aria-label="Suspicious trade alerts"
            onClick={() =>
              setData((d) => (d ? { ...d, settings: { ...d.settings, tradeAlertsEnabled: d.settings.tradeAlertsEnabled === false } } : d))
            }
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              s.tradeAlertsEnabled !== false ? 'border-emerald-400/40 bg-emerald-500/15' : 'border-white/15'
            }`}
          >
            {s.tradeAlertsEnabled !== false ? 'On' : 'Off'}
          </button>
        </div>

        {s.holdFlaggedTradesSupported === false ? (
          <p className="text-[11px] text-white/45" data-testid="integrity-hold-unsupported">
            Holding flagged trades is not available in an imported league: its trades go through on the league&apos;s own
            platform. Completed trades are still checked, and a flagged one alerts you.
          </p>
        ) : (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-white/80">Hold flagged trades for my review</p>
            <p className="text-[11px] text-white/45">A flagged trade waits for you to approve or veto it instead of going through.</p>
          </div>
          <button
            type="button"
            aria-pressed={s.holdFlaggedTrades === true}
            aria-label="Hold flagged trades"
            onClick={() =>
              setData((d) => (d ? { ...d, settings: { ...d.settings, holdFlaggedTrades: d.settings.holdFlaggedTrades !== true } } : d))
            }
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              s.holdFlaggedTrades === true ? 'border-emerald-400/40 bg-emerald-500/15' : 'border-white/15'
            }`}
          >
            {s.holdFlaggedTrades === true ? 'On' : 'Off'}
          </button>
        </div>
        )}

        <div className="border-t border-white/[0.06] pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-white">ANTI-TANKING</p>
            <button
              type="button"
              onClick={() =>
                setData((d) =>
                  d ? { ...d, settings: { ...d.settings, tankingMonitorEnabled: !d.settings.tankingMonitorEnabled } } : d
                )
              }
              className={`rounded-lg border px-2 py-1 text-[11px] ${
                s.tankingMonitorEnabled ? 'border-emerald-400/40 bg-emerald-500/15' : 'border-white/15'
              }`}
            >
              {s.tankingMonitorEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <p className="mt-1 text-white/50">Monitors weekly lineup snapshots for suspicious patterns (when redraft data exists).</p>

          <label className="mt-2 flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={s.tankingIllegalLineupCheck}
              onChange={(e) =>
                setData((d) =>
                  d ? { ...d, settings: { ...d.settings, tankingIllegalLineupCheck: e.target.checked } } : d
                )
              }
            />
            Flag starting OUT / IR / doubtful when alternatives exist
          </label>
          <label className="mt-1 flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={s.tankingBenchPatternCheck}
              onChange={(e) =>
                setData((d) =>
                  d ? { ...d, settings: { ...d.settings, tankingBenchPatternCheck: e.target.checked } } : d
                )
              }
            />
            Flag benching significantly better projections
          </label>
          <label className="mt-1 flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={s.tankingWaiverPatternCheck}
              onChange={(e) =>
                setData((d) =>
                  d ? { ...d, settings: { ...d.settings, tankingWaiverPatternCheck: e.target.checked } } : d
                )
              }
            />
            Flag suspicious waiver drops (experimental)
          </label>

          <p className="mt-2 text-[11px] text-white/45">Sensitivity</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['low', 'medium', 'high'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setData((d) => (d ? { ...d, settings: { ...d.settings, tankingSensitivity: k } } : d))}
                className={`rounded-lg border px-2 py-1 text-[11px] capitalize ${
                  s.tankingSensitivity === k ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100' : 'border-white/15'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-white/45">Start monitoring week</span>
            <input
              type="number"
              min={1}
              max={18}
              className="w-16 rounded border border-white/15 bg-black/30 px-2 py-1 text-[11px]"
              value={s.tankingStartWeek ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                setData((d) => (d ? { ...d, settings: { ...d.settings, tankingStartWeek: v } } : d))
              }}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 w-full rounded-xl border border-cyan-400/35 bg-cyan-500/15 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
