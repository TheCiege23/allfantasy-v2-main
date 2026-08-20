'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { dispatchStateRefreshEvent } from '@/lib/state-consistency/state-events'
import type { LeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { getScoringSettingsLayout, type ScoringLayoutRow } from '@/lib/scoring-defaults/scoring-settings-layout'
import { templateStatKeyFromUiKey } from '@/lib/league/scoring-stat-metadata'

const ACCENT = 'bg-[#ff3d81]/15 text-[#ffb8d1] border border-[#ff3d81]/35'
const PILL_INACTIVE = 'border border-white/[0.1] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]'

function isYardStatKey(uiKey: string): boolean {
  return /yard|yards|_ya_|per_yd/i.test(uiKey)
}

function liveYardHelper(pointsPerUnit: number): string | null {
  if (!Number.isFinite(pointsPerUnit) || pointsPerUnit === 0) return null
  const perYd = pointsPerUnit
  const ydsPerPt = 1 / perYd
  if (!Number.isFinite(ydsPerPt)) return null
  return `1 point every ${ydsPerPt.toFixed(0)} yards (${perYd.toFixed(perYd < 0.1 ? 3 : 2)} per yard)`
}

type RuleState = { statKey: string; pointsValue: number; enabled: boolean; defaultPointsValue: number; defaultEnabled: boolean }

export function CommissionerScoringSettingsPanel({
  leagueId,
  sport,
  canEdit,
  scoringConfig,
}: {
  leagueId: string
  sport: string
  canEdit: boolean
  scoringConfig: LeagueScoringConfig | null
}) {
  const [primaryTab, setPrimaryTab] = useState(() => {
    const l = getScoringSettingsLayout(sport)
    return l.primaryTabs[0]?.id ?? (l.moreTabs?.[0]?.id ?? 'scoring')
  })
  const [moreTab, setMoreTab] = useState(() => {
    const l = getScoringSettingsLayout(sport)
    return l.moreTabs?.[0]?.id ?? 'st_defense'
  })
  const [rulesByKey, setRulesByKey] = useState<Map<string, RuleState>>(new Map())
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const layout = useMemo(() => getScoringSettingsLayout(sport), [sport])

  const syncFromConfig = useCallback((cfg: LeagueScoringConfig) => {
    const m = new Map<string, RuleState>()
    for (const r of cfg.rules) {
      m.set(r.statKey, {
        statKey: r.statKey,
        pointsValue: r.pointsValue,
        enabled: r.enabled,
        defaultPointsValue: r.defaultPointsValue,
        defaultEnabled: r.defaultEnabled,
      })
    }
    setRulesByKey(m)
    setDirty(false)
  }, [])

  useEffect(() => {
    if (scoringConfig) syncFromConfig(scoringConfig)
  }, [scoringConfig, syncFromConfig])

  const structured = useMemo(() => {
    const hasRows =
      layout.primaryTabs.some((t) => t.rows.length > 0) ||
      (layout.moreTabs?.some((t) => t.rows.length) ?? false)
    return hasRows
  }, [layout])

  const fallbackRows: ScoringLayoutRow[] = useMemo(() => {
    if (!scoringConfig || structured) return []
    return scoringConfig.rules.map((r) => ({
      uiKey: r.statKey,
      label: r.statKey.replace(/_/g, ' '),
    }))
  }, [scoringConfig, structured])

  const primaryTabs = useMemo(() => {
    const base = layout.primaryTabs
    if (layout.moreTabs?.length) {
      return [...base, { id: '__more__', label: 'More', rows: [] as ScoringLayoutRow[] }]
    }
    return base
  }, [layout])

  useEffect(() => {
    const first = primaryTabs[0]?.id
    if (first && !primaryTabs.some((t) => t.id === primaryTab)) {
      setPrimaryTab(first)
    }
  }, [primaryTab, primaryTabs])

  const resolveTemplateKey = useCallback(
    (uiKey: string) => templateStatKeyFromUiKey(sport, uiKey),
    [sport],
  )

  const getRule = useCallback(
    (uiKey: string): RuleState | undefined => {
      const tk = resolveTemplateKey(uiKey)
      return (
        rulesByKey.get(tk) ??
        (scoringConfig
          ? (() => {
              const base = scoringConfig.rules.find((r) => r.statKey === tk)
              if (!base) return undefined
              return {
                statKey: base.statKey,
                pointsValue: base.pointsValue,
                enabled: base.enabled,
                defaultPointsValue: base.defaultPointsValue,
                defaultEnabled: base.defaultEnabled,
              }
            })()
          : undefined)
      )
    },
    [resolveTemplateKey, rulesByKey, scoringConfig],
  )

  const setEnabled = useCallback(
    (uiKey: string, enabled: boolean) => {
      const tk = resolveTemplateKey(uiKey)
      const prev =
        rulesByKey.get(tk) ??
        (scoringConfig ? scoringConfig.rules.find((r) => r.statKey === tk) : undefined)
      if (!prev) return
      setRulesByKey((m) => {
        const next = new Map(m)
        const prevWithDefaults = prev as Partial<RuleState>
        next.set(tk, {
          statKey: tk,
          pointsValue: prev.pointsValue,
          enabled,
          defaultPointsValue: prevWithDefaults.defaultPointsValue ?? prev.pointsValue,
          defaultEnabled: prevWithDefaults.defaultEnabled ?? true,
        })
        return next
      })
      setDirty(true)
    },
    [resolveTemplateKey, rulesByKey, scoringConfig],
  )

  const setPoints = useCallback((uiKey: string, raw: string) => {
    const tk = resolveTemplateKey(uiKey)
    const prev =
      rulesByKey.get(tk) ??
      (scoringConfig
        ? scoringConfig.rules.find((r) => r.statKey === tk)
        : undefined)
    if (!prev) return
    const trimmed = raw.trim()
    const n = trimmed === '' || trimmed === '-' ? 0 : Number(trimmed)
    if (!Number.isFinite(n)) return
    setRulesByKey((m) => {
      const next = new Map(m)
      const prevWithDefaults = prev as Partial<RuleState>
      const merged: RuleState = {
        statKey: tk,
        pointsValue: n,
        enabled: prev.enabled,
        defaultPointsValue: prevWithDefaults.defaultPointsValue ?? prev.pointsValue,
        defaultEnabled: prevWithDefaults.defaultEnabled ?? true,
      }
      next.set(tk, merged)
      return next
    })
    setDirty(true)
  }, [resolveTemplateKey, rulesByKey, scoringConfig])

  async function save() {
    if (!scoringConfig || !canEdit || saving) return
    setSaving(true)
    try {
      const rules = scoringConfig.rules.map((r) => {
        const st = rulesByKey.get(r.statKey)
        return {
          statKey: r.statKey,
          pointsValue: st?.pointsValue ?? r.pointsValue,
          enabled: st?.enabled ?? r.enabled,
        }
      })
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/scoring`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json?.error === 'string' ? json.error : 'Failed to save scoring')
        return
      }
      toast.success('Scoring saved')
      setDirty(false)
      if (json?.rules) {
        syncFromConfig(json as LeagueScoringConfig)
      }
      window.dispatchEvent(new CustomEvent('af-league-settings-saved', { detail: { leagueId } }))
      dispatchStateRefreshEvent({
        domain: 'leagues',
        leagueId,
        reason: 'scoring_rules_updated',
        source: 'CommissionerScoringSettingsPanel',
      })
      dispatchStateRefreshEvent({
        domain: 'ai',
        leagueId,
        reason: 'scoring_rules_updated',
        source: 'CommissionerScoringSettingsPanel',
      })
    } finally {
      setSaving(false)
    }
  }

  const activePrimary = primaryTabs.find((t) => t.id === primaryTab)
  const showMore = primaryTab === '__more__'

  const rowsToRender: ScoringLayoutRow[] = useMemo(() => {
    if (!structured && fallbackRows.length) return fallbackRows
    if (showMore && layout.moreTabs?.length) {
      const sub = layout.moreTabs.find((t) => t.id === moreTab)
      return sub?.rows ?? []
    }
    return activePrimary?.rows ?? []
  }, [structured, fallbackRows, showMore, layout.moreTabs, moreTab, activePrimary])

  const readOnlyBanner = !canEdit ? (
    <p className="border-b border-white/[0.06] px-6 py-3 text-[12px] text-white/45">View-only — commissioner or co-commissioner can edit.</p>
  ) : null

  if (!scoringConfig) {
    return (
      <div className="flex min-h-[200px] items-center justify-center px-6 text-[13px] text-white/50">
        Loading scoring rules…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="commissioner-scoring-settings-panel">
      <div className="shrink-0 border-b border-white/[0.06] px-6 pb-4 pt-5">
        <h3 className="text-[17px] font-semibold tracking-tight text-white">Scoring Settings</h3>
        <p className="mt-1 text-[12px] text-white/45">Custom values apply to live scoring, standings, projections, and AI</p>
        <p className="mt-2 text-[11px] text-white/35">
          {scoringConfig.sport}
          {scoringConfig.leagueVariant ? ` · ${scoringConfig.leagueVariant}` : ''} · {scoringConfig.formatType} ·{' '}
          {scoringConfig.templateId}
        </p>
      </div>

      {readOnlyBanner}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-28 pt-4 [scrollbar-width:thin]">
        <div className="sticky top-0 z-10 -mx-6 mb-4 border-b border-white/[0.06] bg-[#080c14]/95 px-6 pb-3 pt-1 backdrop-blur-sm">
          <div className="flex flex-wrap gap-1.5">
            {primaryTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                disabled={!tab.rows.length && tab.id !== '__more__'}
                onClick={() => {
                  setPrimaryTab(tab.id)
                  if (tab.id === '__more__') setMoreTab(layout.moreTabs?.[0]?.id ?? 'misc')
                }}
                className={clsx(
                  'min-h-[32px] rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  primaryTab === tab.id ? 'bg-white text-[#0a0f18]' : PILL_INACTIVE,
                  !tab.rows.length && tab.id !== '__more__' && 'opacity-40',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {showMore && layout.moreTabs && layout.moreTabs.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/[0.04] pt-2">
              {layout.moreTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMoreTab(tab.id)}
                  className={clsx(
                    'min-h-[28px] rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
                    moreTab === tab.id ? ACCENT : PILL_INACTIVE,
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-0 border-b border-white/[0.06] pb-6">
          {rowsToRender.map((row) => {
            const st = getRule(row.uiKey)
            if (!st) return null
            const val = st.pointsValue
            const helper = row.helper
            const yardLive = isYardStatKey(row.uiKey) ? liveYardHelper(val) : null
            return (
              <div
                key={`${row.uiKey}-${row.label}`}
                className="flex flex-col gap-1.5 border-t border-white/[0.05] py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-white/90">{row.label}</p>
                  {helper ? <p className="mt-0.5 text-[10px] text-white/40">{helper}</p> : null}
                  {yardLive ? <p className="mt-1 text-[10px] text-white/35">{yardLive}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/45">
                    <input
                      type="checkbox"
                      checked={st.enabled}
                      disabled={!canEdit}
                      aria-label={`${row.label} scoring enabled`}
                      onChange={(e) => setEnabled(row.uiKey, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border border-white/25 bg-[#070a10] text-[#ff3d81] focus:ring-[#ff3d81]/40 disabled:opacity-50"
                    />
                    On
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={!canEdit || !st.enabled}
                    aria-label={`${row.label} points`}
                    className="h-8 w-[4.5rem] rounded-md border border-white/[0.12] bg-[#070a10] px-2 text-right text-[12px] font-medium tabular-nums text-white shadow-inner placeholder:text-white/20 focus:border-[#ff3d81]/45 focus:outline-none focus:ring-1 focus:ring-[#ff3d81]/30 disabled:opacity-45"
                    value={Number.isFinite(val) ? String(val) : ''}
                    onChange={(e) => setPoints(row.uiKey, e.target.value)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.08] bg-[#060910]/95 px-6 py-3.5 backdrop-blur-md">
        <button
          type="button"
          disabled={!canEdit || saving || !dirty}
          onClick={() => void save()}
          className="mx-auto flex w-full max-w-md items-center justify-center rounded-xl bg-gradient-to-r from-[#ff3d81]/85 to-sky-600/90 px-5 py-2.5 text-[12px] font-bold uppercase tracking-wide text-[#041018] shadow-lg shadow-[#ff3d81]/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty ? <p className="mt-2 text-center text-[10px] text-amber-200/65">Unsaved scoring changes</p> : null}
      </div>
    </div>
  )
}
