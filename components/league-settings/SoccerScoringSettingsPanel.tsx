'use client'

/**
 * components/league-settings/SoccerScoringSettingsPanel.tsx
 * Soccer Commissioner Scoring Settings — tabbed panel matching NFL/NBA/NHL style.
 *
 * Tabs: Outfield | Goalkeeping | Discipline | Bonuses | Misc | Advanced (premium)
 *
 * Commissioner = editable. Non-commissioner = read-only.
 * Preset selector, scrollable stat rows, helper text, Save/Reset controls.
 * Advanced analytics tab gated behind AF Commissioner Subscription.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Lock, RotateCcw } from 'lucide-react'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import {
  SOCCER_SCORING_CATEGORIES,
  buildSoccerDefaultRulesFromCategories,
  type SoccerScoringCategory,
  type SoccerScoringRow,
} from '@/lib/soccer-scoring/SoccerScoringCategories'
import type { SoccerScoringPresetKey } from '@/lib/soccer-scoring/SoccerScoringPresets'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SoccerPreset {
  key: SoccerScoringPresetKey
  label: string
  description: string
  warning?: string
  rules: Record<string, number>
}

interface SoccerScoringConfig {
  presetKey: SoccerScoringPresetKey
  presetLabel: string
  source: string
  rules: Record<string, number>
  matchesPreset: boolean
  premiumFeaturesUsed: boolean
}

// ---------------------------------------------------------------------------
// Tab colour map
// ---------------------------------------------------------------------------

const TAB_COLORS: Record<string, string> = {
  outfield:    'border-green-500/40 bg-green-500/15 text-green-200',
  goalkeeping: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  discipline:  'border-red-500/40 bg-red-500/15 text-red-200',
  bonuses:     'border-blue-500/40 bg-blue-500/15 text-blue-200',
  misc:        'border-slate-400/40 bg-slate-400/15 text-slate-200',
  advanced:    'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
}

const GROUP_DIVIDERS: { label: string; ids: string[] }[] = [
  { label: 'Outfield / GK',      ids: ['outfield', 'goalkeeping'] },
  { label: 'Match Day',          ids: ['discipline', 'bonuses', 'misc'] },
  { label: 'Advanced Analytics', ids: ['advanced'] },
]

const PRESET_LABELS: Record<string, string> = {
  af_default:      'AllFantasy',
  fpl_compatible:  'FPL',
  espn_compatible: 'ESPN',
  yahoo_compatible: 'Yahoo',
  custom:          'Custom',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
  /** true = commissioner (can edit), false = read-only viewer */
  isCommissioner?: boolean
}

export function SoccerScoringSettingsPanel({
  leagueId,
  isCommissioner = false,
}: Props) {
  // ----- state -----
  const [presets, setPresets] = useState<SoccerPreset[]>([])
  const [config, setConfig] = useState<SoccerScoringConfig | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)

  const [selectedPreset, setSelectedPreset] =
    useState<SoccerScoringPresetKey>('af_default')
  const [editedRules, setEditedRules] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<string>('outfield')

  // ----- load config from API -----
  useEffect(() => {
    let active = true
    fetch(
      `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/soccer-scoring`,
      { cache: 'no-store' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setPresets(data.presets ?? [])
        setConfig(data.config ?? null)
        setIsPremium(data.isPremium ?? false)
        setSelectedPreset(
          (data.config?.presetKey ?? 'af_default') as SoccerScoringPresetKey,
        )
        const defaults = buildSoccerDefaultRulesFromCategories()
        setEditedRules({ ...defaults, ...(data.config?.rules ?? {}) })
      })
      .catch(() => {
        if (active) setError('Failed to load soccer scoring settings')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [leagueId])

  // ----- derived -----
  const currentPreset = useMemo(
    () => presets.find((p) => p.key === selectedPreset),
    [presets, selectedPreset],
  )
  const activeCategory = useMemo(
    () => SOCCER_SCORING_CATEGORIES.find((c) => c.id === activeTab),
    [activeTab],
  )
  const hasChanges = useMemo(() => {
    if (!config) return false
    const saved = { ...buildSoccerDefaultRulesFromCategories(), ...config.rules }
    return JSON.stringify(editedRules) !== JSON.stringify(saved)
  }, [editedRules, config])

  // ----- handlers -----
  const handlePresetChange = useCallback(
    (key: SoccerScoringPresetKey) => {
      if (key === 'custom' && !isPremium && isCommissioner) {
        setGateOpen(true)
        return
      }
      setSelectedPreset(key)
      const preset = presets.find((p) => p.key === key)
      if (preset) {
        const defaults = buildSoccerDefaultRulesFromCategories()
        setEditedRules({ ...defaults, ...preset.rules })
      }
    },
    [presets, isPremium, isCommissioner],
  )

  const handleRuleChange = useCallback(
    (statKey: string, rawValue: string) => {
      if (!isCommissioner) return
      const isPremiumRow = SOCCER_SCORING_CATEGORIES.find(
        (c) => c.id === 'advanced',
      )?.rows.some((r: SoccerScoringRow) => r.key === statKey)
      if (isPremiumRow && !isPremium) {
        setGateOpen(true)
        return
      }
      const value =
        rawValue === '' || rawValue === '-' ? 0 : parseFloat(rawValue) || 0
      setEditedRules((prev) => ({ ...prev, [statKey]: value }))
      setSelectedPreset('custom')
    },
    [isPremium, isCommissioner],
  )

  const save = useCallback(async () => {
    if (!leagueId) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/soccer-scoring`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          // Rules only for a custom table. The route treats any `rules` in the body as a premium
          // edit, so sending them with a plain preset switch refused every free commissioner.
          body: JSON.stringify(
            selectedPreset === 'custom'
              ? { presetKey: selectedPreset, rules: editedRules }
              : { presetKey: selectedPreset },
          ),
        },
      )
      const data = await res.json()
      if (data.error === 'premiumRequired') {
        setGateOpen(true)
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'Save failed')
        return
      }
      setConfig(data.config)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('Request failed')
    } finally {
      setSaving(false)
    }
  }, [leagueId, selectedPreset, editedRules])

  const resetToSaved = useCallback(() => {
    if (config) {
      const defaults = buildSoccerDefaultRulesFromCategories()
      setEditedRules({ ...defaults, ...config.rules })
      setSelectedPreset(config.presetKey)
    }
  }, [config])

  // ----- loading state -----
  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-white/50">
        Loading soccer scoring settings…
      </div>
    )
  }

  // ----- render -----
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">
          Soccer Scoring Settings
        </h3>
        <p className="mt-0.5 text-xs text-white/50">
          {isCommissioner
            ? 'Customize scoring values for your league. Changes apply league-wide.'
            : 'Scoring values for this league (read-only).'}
        </p>
      </div>

      {/* League-wide rule notice */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
        This scoring configuration applies to{' '}
        <span className="font-medium text-white/60">all players</span> and{' '}
        <span className="font-medium text-white/60">all roster positions</span>{' '}
        in this league.
      </div>

      {/* Preset selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Scoring Preset
        </label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              'af_default',
              'fpl_compatible',
              'espn_compatible',
              'yahoo_compatible',
              'custom',
            ] as SoccerScoringPresetKey[]
          ).map((key) => {
            const isCustomLocked =
              key === 'custom' && !isPremium && isCommissioner
            const active = selectedPreset === key
            return (
              <button
                key={key}
                type="button"
                disabled={!isCommissioner}
                onClick={() => handlePresetChange(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-green-500/40 bg-green-500/15 text-green-200'
                    : isCustomLocked
                      ? 'cursor-pointer border-white/5 bg-white/[0.02] text-white/30'
                      : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50'
                }`}
              >
                {PRESET_LABELS[key] ?? key}
                {isCustomLocked && (
                  <Lock className="ml-1 inline h-3 w-3 text-white/30" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Warning banner for external presets */}
      {currentPreset?.warning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-950/15 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-[11px] text-amber-200/80">
            <p>{currentPreset.warning}</p>
            <p className="mt-1 text-amber-200/60">
              AllFantasy specialty leagues are optimized for AF scoring templates.
            </p>
          </div>
        </div>
      )}

      {/* Non-commissioner read-only banner */}
      {!isCommissioner && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
          Only the commissioner can edit scoring settings.
        </div>
      )}

      {/* ===== Category tab pills with group dividers ===== */}
      <div className="space-y-1.5">
        {GROUP_DIVIDERS.map(({ label: groupLabel, ids }) => {
          const cats = SOCCER_SCORING_CATEGORIES.filter((c) =>
            ids.includes(c.id),
          )
          if (cats.length === 0) return null
          const isPremiumGroup = groupLabel === 'Advanced Analytics'
          return (
            <div key={groupLabel}>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/20">
                {groupLabel}
              </p>
              <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-0.5">
                {cats.map((cat: SoccerScoringCategory) => {
                  const active = activeTab === cat.id
                  const colorClass = active
                    ? TAB_COLORS[cat.id] ??
                      'border-green-500/40 bg-green-500/15 text-green-200'
                    : 'border-transparent bg-white/[0.04] text-white/45 hover:bg-white/[0.07] hover:text-white/60'
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveTab(cat.id)}
                      className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${colorClass}`}
                    >
                      {cat.label}
                      {isPremiumGroup && !isPremium && (
                        <Lock className="h-3 w-3 opacity-60" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== Scoring rows for active tab ===== */}
      {activeCategory && (
        <div className="max-h-[52vh] space-y-0.5 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {/* Premium lock notice */}
          {activeCategory.id === 'advanced' && !isPremium && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-3 py-2.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              <div className="text-[11px] text-cyan-200/80">
                <p className="font-medium">Premium Feature</p>
                <p className="mt-0.5 text-cyan-200/60">
                  Advanced soccer analytics (xG, xA, xGI, progressive
                  passes/carries, PSxG, etc.) require an AF Commissioner
                  Subscription.
                </p>
                <button
                  type="button"
                  onClick={() => setGateOpen(true)}
                  className="mt-1.5 rounded-md bg-cyan-600/60 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-cyan-600/80"
                >
                  Upgrade
                </button>
              </div>
            </div>
          )}

          {/* Category stat count */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
              {activeCategory.label} ({activeCategory.rows.length} stats)
            </span>
            {isCommissioner && activeCategory.id !== 'advanced' && (
              <span className="text-[10px] text-white/25">
                Click value to edit
              </span>
            )}
          </div>

          {/* Stat rows */}
          {activeCategory.rows.map((row: SoccerScoringRow) => {
            const value = editedRules[row.key] ?? row.defaultValue
            const isEditable =
              isCommissioner &&
              (activeCategory.id !== 'advanced' || isPremium)
            const isNonZero = value !== 0

            return (
              <div
                key={row.key}
                className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-white/[0.03]"
              >
                {/* Label + helper */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-white/80">
                      {row.label}
                    </span>
                    {row.premium && (
                      <Lock className="h-3 w-3 text-cyan-400/60" />
                    )}
                  </div>
                  {row.helper && (
                    <p className="mt-0.5 text-[10px] text-white/30">
                      {row.helper}
                    </p>
                  )}
                </div>

                {/* Value input / display */}
                <div className="shrink-0">
                  {isEditable ? (
                    <input
                      type="number"
                      step="any"
                      value={value}
                      aria-label={row.label}
                      onChange={(e) =>
                        handleRuleChange(row.key, e.target.value)
                      }
                      className={`w-20 rounded-md border bg-white/5 px-2 py-1.5 text-right font-mono text-[12px] transition focus:border-green-500/50 focus:outline-none focus:ring-1 focus:ring-green-500/30 ${
                        isNonZero
                          ? 'border-white/15 text-white'
                          : 'border-white/10 text-white/30'
                      }`}
                    />
                  ) : (
                    <span
                      className={`inline-block w-20 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-right font-mono text-[12px] ${
                        isNonZero ? 'text-white' : 'text-white/30'
                      }`}
                    >
                      {value}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Preset description */}
      {currentPreset?.description && (
        <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" />
          <p className="text-[11px] text-white/40">
            {currentPreset.description}
          </p>
        </div>
      )}

      {/* ===== Save controls (commissioner only) ===== */}
      {isCommissioner && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
              Soccer scoring settings saved successfully.
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !hasChanges}
              onClick={save}
              className="flex-1 rounded-lg bg-green-600/80 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Scoring'}
            </button>
            <button
              type="button"
              disabled={saving || !hasChanges}
              onClick={resetToSaved}
              title="Reset to saved"
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-white/50 transition hover:bg-white/[0.06] disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Premium gate modal */}
      {gateOpen && (
        <SubscriptionGateModal
          featureId="advanced_scoring"
          isOpen={gateOpen}
          onClose={() => setGateOpen(false)}
        />
      )}
    </div>
  )
}

export default SoccerScoringSettingsPanel
