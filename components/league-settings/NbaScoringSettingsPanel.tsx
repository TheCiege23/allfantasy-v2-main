'use client'

/**
 * components/league-settings/NbaScoringSettingsPanel.tsx
 * NBA Commissioner Scoring Settings — full tabbed UI.
 * 10 category tabs (General, Shooting, Free Throws, Three-Point, Rebounds,
 * Playmaking, Defense, Discipline, Bonuses, Advanced)
 * + premium Advanced section. Commissioner editable, non-commissioner read-only.
 * Preset selector, scrollable stat rows, helper text, Save/Reset controls.
 *
 * ONE NBA LEAGUE = ONE NBA SCORING SYSTEM
 * The same scoring config is used across ALL NBA league types (Redraft, Dynasty,
 * Keeper, Best Ball, Salary Cap, Guillotine, Survivor, Zombie, Tournament,
 * Big Brother, Devy, C2C, etc.). Specialty league mechanics are separate.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lock, AlertTriangle, Info, RotateCcw } from 'lucide-react'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import {
  NBA_SCORING_CATEGORIES,
  NBA_PREMIUM_SCORING,
  type NbaScoringCategory,
  type NbaScoringRow,
} from '@/lib/nba-scoring/NbaScoringCategories'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PresetKey = 'af_default' | 'sleeper_default' | 'espn_default' | 'yahoo_default' | 'custom'

interface NbaScoringPreset {
  key: PresetKey
  label: string
  description: string
  warning?: string
  rules: Record<string, number>
}

interface NbaScoringConfig {
  presetKey: PresetKey
  presetLabel: string
  source: string
  rules: Record<string, number>
  matchesPreset: boolean
  premiumFeaturesUsed: boolean
}

// ---------------------------------------------------------------------------
// Tab pill colour map — visually distinguishes categories
// ---------------------------------------------------------------------------

const TAB_COLORS: Record<string, string> = {
  general:      'border-blue-500/40 bg-blue-500/15 text-blue-200',
  shooting:     'border-orange-500/40 bg-orange-500/15 text-orange-200',
  free_throws:  'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  three_point:  'border-violet-500/40 bg-violet-500/15 text-violet-200',
  rebounds:     'border-amber-500/40 bg-amber-500/15 text-amber-200',
  playmaking:   'border-pink-500/40 bg-pink-500/15 text-pink-200',
  defense:      'border-red-500/40 bg-red-500/15 text-red-200',
  discipline:   'border-slate-400/40 bg-slate-400/15 text-slate-200',
  bonuses:      'border-yellow-500/40 bg-yellow-500/15 text-yellow-200',
  advanced:     'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
}

const PRESET_LABELS: Record<string, string> = {
  af_default: 'AllFantasy',
  sleeper_default: 'Sleeper',
  espn_default: 'ESPN',
  yahoo_default: 'Yahoo',
  custom: 'Custom',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
  /** true = commissioner (can edit), false = read-only viewer */
  isCommissioner?: boolean
}

export function NbaScoringSettingsPanel({ leagueId, isCommissioner = false }: Props) {
  // ----- state -----
  const [presets, setPresets] = useState<NbaScoringPreset[]>([])
  const [config, setConfig] = useState<NbaScoringConfig | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)

  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('af_default')
  const [editedRules, setEditedRules] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<string>('general')

  // All categories: 9 standard + 1 premium
  const allCategories: NbaScoringCategory[] = useMemo(
    () => [...NBA_SCORING_CATEGORIES, NBA_PREMIUM_SCORING],
    [],
  )

  // ----- load config from API -----
  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/nba-scoring`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setPresets(data.presets ?? [])
        setConfig(data.config ?? null)
        setIsPremium(data.isPremium ?? false)
        setSelectedPreset(data.config?.presetKey ?? 'af_default')
        // Merge loaded rules with defaults so every key has a value
        const defaults: Record<string, number> = {}
        for (const cat of allCategories) for (const r of cat.rows) defaults[r.key] = r.defaultValue
        setEditedRules({ ...defaults, ...(data.config?.rules ?? {}) })
      })
      .catch(() => { if (active) setError('Failed to load scoring settings') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId, allCategories])

  // ----- derived -----
  const currentPreset = useMemo(() => presets.find((p) => p.key === selectedPreset), [presets, selectedPreset])
  const activeCategory = useMemo(() => allCategories.find((c) => c.id === activeTab), [allCategories, activeTab])

  const hasChanges = useMemo(() => {
    if (!config) return false
    return JSON.stringify(editedRules) !== JSON.stringify(config.rules)
  }, [editedRules, config])

  // ----- handlers -----
  const handlePresetChange = useCallback((key: PresetKey) => {
    if (key === 'custom' && !isPremium && isCommissioner) {
      setGateOpen(true)
      return
    }
    setSelectedPreset(key)
    const preset = presets.find((p) => p.key === key)
    if (preset) {
      // Merge preset rules with current edited rules (preset overrides known keys)
      setEditedRules((prev) => ({ ...prev, ...preset.rules }))
    }
  }, [presets, isPremium, isCommissioner])

  const handleRuleChange = useCallback((statKey: string, value: number) => {
    if (!isCommissioner) return
    if (!isPremium) {
      // Check if this is a premium row
      const isPremiumRow = NBA_PREMIUM_SCORING.rows.some((r) => r.key === statKey)
      if (isPremiumRow) { setGateOpen(true); return }
    }
    setEditedRules((prev) => {
      const next = { ...prev, [statKey]: value }
      setSelectedPreset('custom')
      return next
    })
  }, [isPremium, isCommissioner])

  const save = useCallback(async () => {
    if (!leagueId) return
    setSaving(true); setError(null); setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/nba-scoring`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Rules only for a custom table. The route treats any `rules` in the body as a premium
        // edit, so sending them with a plain preset switch refused every free commissioner.
        body: JSON.stringify(
          selectedPreset === 'custom'
            ? { presetKey: selectedPreset, rules: editedRules }
            : { presetKey: selectedPreset },
        ),
      })
      const data = await res.json()
      if (data.error === 'premiumRequired') { setGateOpen(true); return }
      if (!res.ok) { setError(data.error ?? 'Save failed'); return }
      setConfig(data.config)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch { setError('Request failed') }
    finally { setSaving(false) }
  }, [leagueId, selectedPreset, editedRules])

  const resetToSaved = useCallback(() => {
    if (config) {
      setEditedRules(config.rules)
      setSelectedPreset(config.presetKey)
    }
  }, [config])

  // ----- loading state -----
  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-white/50">
        Loading NBA scoring settings...
      </div>
    )
  }

  // ----- render -----
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">NBA Scoring Settings</h3>
        <p className="mt-0.5 text-xs text-white/50">
          {isCommissioner
            ? 'Set custom scoring values for your NBA league. Changes apply league-wide across all matchups, standings, and projections.'
            : 'Scoring values for this league (read-only).'}
        </p>
      </div>

      {/* Preset selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Scoring Preset</label>
        <div className="flex flex-wrap gap-2">
          {(['af_default', 'sleeper_default', 'espn_default', 'yahoo_default', 'custom'] as PresetKey[]).map(
            (key) => {
              const isCustomLocked = key === 'custom' && !isPremium && isCommissioner
              const active = selectedPreset === key
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!isCommissioner}
                  onClick={() => handlePresetChange(key)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                      : isCustomLocked
                        ? 'border-white/5 bg-white/[0.02] text-white/30 cursor-pointer'
                        : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50'
                  }`}
                >
                  {PRESET_LABELS[key]}
                  {isCustomLocked && <Lock className="ml-1 inline h-3 w-3 text-white/30" />}
                </button>
              )
            },
          )}
        </div>
      </div>

      {/* Warning banner for external presets */}
      {currentPreset?.warning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-950/15 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-[11px] text-amber-200/80">
            <p>{currentPreset.warning}</p>
            <p className="mt-1 text-amber-200/60">AllFantasy specialty leagues are optimized for AF scoring templates.</p>
          </div>
        </div>
      )}

      {/* Non-commissioner read-only banner */}
      {!isCommissioner && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
          Only the commissioner can edit scoring settings.
        </div>
      )}

      {/* ===== Category tab pills ===== */}
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {allCategories.map((cat) => {
          const active = activeTab === cat.id
          const isPremiumTab = cat.id === 'advanced'
          const colorClass = active
            ? TAB_COLORS[cat.id] ?? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
            : 'border-transparent bg-white/[0.04] text-white/45 hover:bg-white/[0.07] hover:text-white/60'

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveTab(cat.id)}
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition ${colorClass}`}
            >
              {cat.label}
              {isPremiumTab && !isPremium && <Lock className="h-3 w-3 opacity-60" />}
            </button>
          )
        })}
      </div>

      {/* ===== Scoring rows for active tab ===== */}
      {activeCategory && (
        <div className="max-h-[52vh] space-y-0.5 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {/* Premium lock overlay */}
          {activeCategory.id === 'advanced' && !isPremium && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-3 py-2.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              <div className="text-[11px] text-cyan-200/80">
                <p className="font-medium">Premium Feature</p>
                <p className="mt-0.5 text-cyan-200/60">Advanced scoring metrics require a premium subscription.</p>
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
              <span className="text-[10px] text-white/25">Click value to edit</span>
            )}
          </div>

          {/* Stat rows */}
          {activeCategory.rows.map((row: NbaScoringRow) => {
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
                    <span className="text-[12px] text-white/80">{row.label}</span>
                    {row.premium && <Lock className="h-3 w-3 text-cyan-400/60" />}
                  </div>
                  {row.helper && (
                    <p className="mt-0.5 text-[10px] text-white/30">{row.helper}</p>
                  )}
                </div>

                {/* Value input / display */}
                <div className="shrink-0">
                  {isEditable ? (
                    <input
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) => handleRuleChange(row.key, parseFloat(e.target.value) || 0)}
                      className={`w-20 rounded-md border bg-white/5 px-2 py-1.5 text-right font-mono text-[12px] transition focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 ${
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
          <p className="text-[11px] text-white/40">{currentPreset.description}</p>
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
              NBA scoring settings saved successfully. Changes apply league-wide.
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !hasChanges}
              onClick={save}
              className="flex-1 rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : 'Save Scoring'}
            </button>
            {hasChanges && (
              <button
                type="button"
                onClick={resetToSaved}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/60 hover:bg-white/10 transition"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      <SubscriptionGateModal
        isOpen={gateOpen}
        onClose={() => setGateOpen(false)}
        featureId="advanced_scoring"
        featureLabel="Advanced NBA Scoring Customization"
      />
    </div>
  )
}
