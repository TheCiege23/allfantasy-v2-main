'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  HOLD_FLAGGED_TRADES_LABELS,
  HOLD_FLAGGED_TRADES_MODES,
  holdModeFromResponse,
  type HoldFlaggedTradesMode,
} from '@/lib/integrity/holdFlaggedTradesMode'

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
    /** Hold flagged trades for commissioner review (lib/integrity/holdFlaggedTrades.ts). Default: serious flags only. */
    holdFlaggedTrades?: boolean
    holdFlaggedTradesMode?: HoldFlaggedTradesMode
    /** False in an imported league: its trades go through on the host, so there is nothing to hold. */
    holdFlaggedTradesSupported?: boolean
    tankingWaiverPatternCheck: boolean
    /** Anti-tanking penalties (League.settings, lib/integrity/tankingPenalties.ts). Default: warning, then a 1st-round pick. */
    tankingPenalties?: {
      enabled: boolean
      penalty?: 'forfeit_pick' | 'lottery_odds' | 'faab'
      pickAtStrike: number
      pickRound: number
      lotteryOddsCutPct?: number
      faabPercent?: number
    }
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
          holdFlaggedTradesMode: holdModeFromResponse(data.settings),
          ...(data.settings.tankingPenalties ? { tankingPenalties: data.settings.tankingPenalties } : {}),
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
  const pen = s.tankingPenalties
  const setPenalty = (patch: Partial<NonNullable<typeof pen>>) =>
    setData((d) =>
      d && d.settings.tankingPenalties ? { ...d, settings: { ...d.settings, tankingPenalties: { ...d.settings.tankingPenalties, ...patch } } } : d
    )
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
        <div>
          <p className="text-white/80">Hold flagged trades for my review</p>
          <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Hold flagged trades">
            {HOLD_FLAGGED_TRADES_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={holdModeFromResponse(s) === m}
                onClick={() => setData((d) => (d ? { ...d, settings: { ...d.settings, holdFlaggedTradesMode: m, holdFlaggedTrades: m !== 'off' } } : d))}
                className={`rounded-lg border px-2 py-1 text-[11px] ${
                  holdModeFromResponse(s) === m ? 'border-emerald-400/40 bg-emerald-500/15' : 'border-white/15'
                }`}
              >
                {HOLD_FLAGGED_TRADES_LABELS[m].label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-white/45">{HOLD_FLAGGED_TRADES_LABELS[holdModeFromResponse(s)].detail}</p>
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

          {pen ? (
            <div className="mt-3 rounded-lg border border-white/[0.08] p-2" data-testid="tanking-penalties">
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={pen.enabled}
                  onChange={(e) => setPenalty({ enabled: e.target.checked })}
                />
                Penalties: a warning first, then a penalty
              </label>
              <p className="mt-1 text-[11px] text-white/45">
                A flag only warns the manager. Confirming a flag (Escalate) is a strike. At the strike below, the team pays the penalty you
                choose.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                <label className="flex items-center gap-1">
                  Penalty
                  <select
                    data-testid="tanking-penalty-kind"
                    value={pen.penalty ?? 'forfeit_pick'}
                    disabled={!pen.enabled}
                    onChange={(e) => setPenalty({ penalty: e.target.value as 'forfeit_pick' | 'lottery_odds' | 'faab' })}
                    className="rounded border border-white/15 bg-transparent px-1"
                  >
                    <option value="forfeit_pick">Lose a draft pick</option>
                    <option value="lottery_odds">Worse rookie-lottery odds</option>
                    <option value="faab">Lose FAAB</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  At strike
                  <select
                    value={pen.pickAtStrike}
                    disabled={!pen.enabled}
                    onChange={(e) => setPenalty({ pickAtStrike: Number(e.target.value) })}
                    className="rounded border border-white/15 bg-transparent px-1"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1 (no warning)' : n}
                      </option>
                    ))}
                  </select>
                </label>
                {(pen.penalty ?? 'forfeit_pick') === 'forfeit_pick' ? (
                  <label className="flex items-center gap-1">
                    Round of the pick
                    <select
                      value={pen.pickRound}
                      disabled={!pen.enabled}
                      onChange={(e) => setPenalty({ pickRound: Number(e.target.value) })}
                      className="rounded border border-white/15 bg-transparent px-1"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {pen.penalty === 'lottery_odds' ? (
                  <label className="flex items-center gap-1">
                    Odds cut
                    <select
                      data-testid="tanking-lottery-cut"
                      value={pen.lotteryOddsCutPct ?? 50}
                      disabled={!pen.enabled}
                      onChange={(e) => setPenalty({ lotteryOddsCutPct: Number(e.target.value) })}
                      className="rounded border border-white/15 bg-transparent px-1"
                    >
                      {[25, 50, 75, 100].map((n) => (
                        <option key={n} value={n}>
                          {n === 100 ? 'All (left out of the lottery)' : `${n}%`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {pen.penalty === 'faab' ? (
                  <label className="flex items-center gap-1">
                    FAAB taken
                    <select
                      data-testid="tanking-faab-percent"
                      value={pen.faabPercent ?? 25}
                      disabled={!pen.enabled}
                      onChange={(e) => setPenalty({ faabPercent: Number(e.target.value) })}
                      className="rounded border border-white/15 bg-transparent px-1"
                    >
                      {[10, 25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}% of the budget
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-white/45">
                {pen.penalty === 'lottery_odds'
                  ? 'Applies to the next rookie-draft lottery that has not been drawn yet. Only matters if your rookie draft order is a lottery.'
                  : pen.penalty === 'faab'
                    ? 'Taken from what the team has left, never below $0. Only matters if your league uses FAAB waivers.'
                    : 'The team loses its own pick in that round, from the nearest draft it still holds one.'}
              </p>
            </div>
          ) : null}

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
