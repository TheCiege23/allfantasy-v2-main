'use client'

/**
 * C2C commissioner settings panel: startup format, roster sizes, draft rounds, best ball, standings. PROMPT 2/6.
 */

import { useEffect, useState } from 'react'

interface C2CConfig {
  leagueId: string
  sport: string
  startupFormat: string
  mergedStartupDraft: boolean
  separateStartupCollegeDraft: boolean
  collegeRosterSize: number
  collegeActiveLineupSlots?: Record<string, number> | null
  taxiSize: number
  rookieDraftRounds: number
  collegeDraftRounds: number
  bestBallPro: boolean
  bestBallCollege: boolean
  standingsModel: string
  mergedRookieCollegeDraft: boolean
  nflCollegeExcludeKDST: boolean
  promotionTiming: string
  maxPromotionsPerYear: number | null
  earlyDeclareBehavior: string
  returnToSchoolHandling: string
  rookiePickTradeRules: string
  collegePickTradeRules: string
  collegeScoringUntilDeadline: boolean
  proBenchSize: number
  proIRSize: number
  startupDraftType: string
  rookieDraftType: string
  collegeDraftType: string
  hybridProWeight?: number
  hybridPlayoffQualification?: string
  hybridChampionshipTieBreaker?: string
  collegeFAEnabled?: boolean
  collegeFAABSeparate?: boolean
  collegeFAABBudget?: number | null
}

interface MergedDevyC2CCommissionerSettingsProps {
  leagueId: string
}

export function MergedDevyC2CCommissionerSettings({ leagueId }: MergedDevyC2CCommissionerSettingsProps) {
  const [config, setConfig] = useState<C2CConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    async function fetchConfig() {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/merged-devy-c2c/config`, { cache: 'no-store' })
        if (!active) return
        if (res.ok) {
          const data = await res.json()
          setConfig(data.config ?? null)
        }
      } catch {
        if (active) setConfig(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchConfig()
    return () => { active = false }
  }, [leagueId])

  const patch = async (updates: Partial<C2CConfig>) => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/merged-devy-c2c/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'err', text: (data as { error?: string }).error ?? 'Update failed' })
        return
      }
      setMessage({ type: 'ok', text: 'Saved' })
      if (data.config) setConfig(data.config)
    } catch {
      setMessage({ type: 'err', text: 'Update failed' })
    } finally {
      setSaving(false)
    }
  }

  if (loading || !config) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-medium text-white">C2C commissioner settings</h3>
        <p className="mt-1 text-xs text-white/50">{loading ? 'Loading…' : 'Unable to load C2C settings. Please try again.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="text-base font-semibold text-white">C2C commissioner settings</h3>
      {message && (
        <p className={`text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-amber-400'}`}>
          {message.text}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-white/80">
          <span className="block text-white/50">Startup format</span>
          <select
            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
            value={config.mergedStartupDraft ? 'merged' : config.separateStartupCollegeDraft ? 'separate' : 'merged'}
            onChange={(e) => {
              const v = e.target.value
              patch({
                startupFormat: v,
                mergedStartupDraft: v === 'merged',
                separateStartupCollegeDraft: v === 'separate',
              })
            }}
            disabled={saving}
          >
            <option value="merged">Merged (pro + college in one draft)</option>
            <option value="separate">Separate (pro then college)</option>
          </select>
        </label>
        <label className="block text-sm text-white/80">
          <span className="block text-white/50">Standings model</span>
          <select
            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
            value={config.standingsModel}
            onChange={(e) => patch({ standingsModel: e.target.value })}
            disabled={saving}
          >
            <option value="unified">Unified</option>
            <option value="separate">Separate college + pro</option>
            <option value="hybrid">Hybrid championship</option>
          </select>
        </label>
      </div>

      <fieldset className="rounded-lg border border-white/10 p-3" disabled={saving}>
        <legend className="px-1 text-sm text-white/80">College active lineup slots</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(config.sport === 'NFL' || config.sport === 'NCAAF' ? ['QB', 'RB', 'WR', 'TE', 'FLEX'] : ['G', 'F', 'C', 'FLEX']).map((slot) => (
            <label key={slot} className="block text-sm text-white/70">
              {slot}
              <input
                type="number" min={0} max={20} step={1}
                className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
                value={config.collegeActiveLineupSlots?.[slot] ?? 0}
                onChange={(e) => {
                  const value = Math.max(0, Math.min(20, Math.trunc(Number(e.target.value) || 0)))
                  setConfig((c) => c ? { ...c, collegeActiveLineupSlots: { ...c.collegeActiveLineupSlots, [slot]: value } } : null)
                }}
              />
            </label>
          ))}
        </div>
        <button type="button" className="mt-3 rounded border border-white/20 px-3 py-2 text-sm text-white" onClick={() => patch({ collegeActiveLineupSlots: config.collegeActiveLineupSlots })}>
          Save college lineup
        </button>
      </fieldset>
      <label className="block text-sm text-white/80">
        <span className="block text-white/50">Maximum promotions per team per year (blank for unlimited)</span>
        <input
          type="number" min={0} max={100} step={1}
          className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
          value={config.maxPromotionsPerYear ?? ''}
          onChange={(e) => {
            const value = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.trunc(Number(e.target.value) || 0)))
            setConfig((c) => c ? { ...c, maxPromotionsPerYear: value } : null)
          }}
          onBlur={() => patch({ maxPromotionsPerYear: config.maxPromotionsPerYear })}
          disabled={saving}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm text-white/80">
          <span className="block text-white/50">College roster size</span>
          <input
            type="number"
            min={1}
            max={50}
            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
            value={config.collegeRosterSize}
            onChange={(e) => setConfig((c) => (c ? { ...c, collegeRosterSize: Number(e.target.value) || 0 } : null))}
            onBlur={() => patch({ collegeRosterSize: config.collegeRosterSize })}
            disabled={saving}
          />
        </label>
        <label className="block text-sm text-white/80">
          <span className="block text-white/50">Taxi size</span>
          <input
            type="number"
            min={0}
            max={20}
            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
            value={config.taxiSize}
            onChange={(e) => setConfig((c) => (c ? { ...c, taxiSize: Number(e.target.value) || 0 } : null))}
            onBlur={() => patch({ taxiSize: config.taxiSize })}
            disabled={saving}
          />
        </label>
        <label className="block text-sm text-white/80">
          <span className="block text-white/50">Rookie draft rounds</span>
          <input
            type="number"
            min={1}
            max={10}
            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
            value={config.rookieDraftRounds}
            onChange={(e) => setConfig((c) => (c ? { ...c, rookieDraftRounds: Number(e.target.value) || 0 } : null))}
            onBlur={() => patch({ rookieDraftRounds: config.rookieDraftRounds })}
            disabled={saving}
          />
        </label>
        <label className="block text-sm text-white/80">
          <span className="block text-white/50">College draft rounds</span>
          <input
            type="number"
            min={1}
            max={10}
            className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
            value={config.collegeDraftRounds}
            onChange={(e) => setConfig((c) => (c ? { ...c, collegeDraftRounds: Number(e.target.value) || 0 } : null))}
            onBlur={() => patch({ collegeDraftRounds: config.collegeDraftRounds })}
            disabled={saving}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={config.bestBallPro}
            onChange={(e) => patch({ bestBallPro: e.target.checked })}
            disabled={saving}
            className="rounded border-white/20"
          />
          Best ball (pro)
        </label>
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={config.bestBallCollege}
            onChange={(e) => patch({ bestBallCollege: e.target.checked })}
            disabled={saving}
            className="rounded border-white/20"
          />
          Best ball (college)
        </label>
        {config.sport === 'NFL' && (
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={config.nflCollegeExcludeKDST}
              onChange={(e) => patch({ nflCollegeExcludeKDST: e.target.checked })}
              disabled={saving}
              className="rounded border-white/20"
            />
            Exclude K/DST from college pool
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={config.mergedRookieCollegeDraft}
            onChange={(e) => patch({ mergedRookieCollegeDraft: e.target.checked })}
            disabled={saving}
            className="rounded border-white/20"
          />
          Merged rookie + college draft
        </label>
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={config.collegeFAEnabled ?? false}
            onChange={(e) => patch({ collegeFAEnabled: e.target.checked })}
            disabled={saving}
            className="rounded border-white/20"
          />
          College free agency enabled
        </label>
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={config.collegeFAABSeparate ?? false}
            onChange={(e) => patch({ collegeFAABSeparate: e.target.checked })}
            disabled={saving}
            className="rounded border-white/20"
          />
          Separate college FAAB budget
        </label>
      </div>

      {config.standingsModel === 'hybrid' && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm text-white/80">
            <span className="block text-white/50">Pro weight (hybrid) %</span>
            <input
              type="number"
              min={0}
              max={100}
              className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
              value={config.hybridProWeight ?? 60}
              onChange={(e) => setConfig((c) => (c ? { ...c, hybridProWeight: Number(e.target.value) || 0 } : null))}
              onBlur={() => patch({ hybridProWeight: config.hybridProWeight ?? 60 })}
              disabled={saving}
            />
          </label>
          <label className="block text-sm text-white/80">
            <span className="block text-white/50">Playoff qualification</span>
            <select
              className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
              value={config.hybridPlayoffQualification ?? 'weighted'}
              onChange={(e) => patch({ hybridPlayoffQualification: e.target.value })}
              disabled={saving}
            >
              <option value="weighted">Weighted</option>
              <option value="pro_only">Pro only</option>
              <option value="college_only">College only</option>
              <option value="combined">Combined</option>
            </select>
          </label>
          <label className="block text-sm text-white/80">
            <span className="block text-white/50">Championship tie-breaker</span>
            <select
              className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
              value={config.hybridChampionshipTieBreaker ?? 'total_points'}
              onChange={(e) => patch({ hybridChampionshipTieBreaker: e.target.value })}
              disabled={saving}
            >
              <option value="total_points">Total points</option>
              <option value="pro_first">Pro first</option>
              <option value="college_first">College first</option>
              <option value="head_to_head">Head to head</option>
            </select>
          </label>
          {config.collegeFAABSeparate && (
            <label className="block text-sm text-white/80">
              <span className="block text-white/50">College FAAB budget</span>
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1.5 text-white"
                value={config.collegeFAABBudget ?? ''}
                onChange={(e) => setConfig((c) => (c ? { ...c, collegeFAABBudget: e.target.value === '' ? null : Number(e.target.value) } : null))}
                onBlur={() => patch({ collegeFAABBudget: config.collegeFAABBudget ?? null })}
                disabled={saving}
                placeholder="Optional"
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
