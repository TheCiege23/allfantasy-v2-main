'use client'

/**
 * [NEW] components/league-settings/PlayoffSettingsEditor.tsx
 * Commissioner playoff settings editor with premium gating.
 * Shows sport-specific playoff stage options; premium options are visible but greyed out.
 * Clicking locked options opens SubscriptionGateModal.
 */

import { useCallback, useEffect, useState } from 'react'
import { Lock, Trophy, ChevronRight, AlertTriangle, Check } from 'lucide-react'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

interface PlayoffStageOption {
  id: string
  label: string
  description: string
  shortensSeason: boolean
  additionalWeeks: number
  defaultEnabled: boolean
  premium: boolean
  timing?: string
  warning?: string
}

interface PlayoffConfig {
  sport: string
  includedStages: string[]
  startMode: string
  adjustedPlayoffStartWeek: number | null
  adjustedPlayoffWeeks: number | null
  premiumFeaturesUsed: boolean
}

interface ScheduleAdjustment {
  changes: string[]
  newRegularSeasonEndWeek: number
  newPlayoffStartWeek: number
  newPlayoffWeeks: number
  newChampionshipWeek: number
  totalWeeksChanged: number
}

export function PlayoffSettingsEditor({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [stages, setStages] = useState<PlayoffStageOption[]>([])
  const [config, setConfig] = useState<PlayoffConfig | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [sport, setSport] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [preview, setPreview] = useState<ScheduleAdjustment | null>(null)
  const [gateOpen, setGateOpen] = useState(false)

  const [pendingStages, setPendingStages] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/playoff-settings`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setStages(data.stages ?? [])
        setConfig(data.config ?? null)
        setIsPremium(data.isPremium ?? false)
        setSport(data.sport ?? '')
        setPendingStages(new Set(data.config?.includedStages ?? []))
      })
      .catch(() => { if (active) setError(t('lsEd.loadFailed')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  // Preview changes when pending stages change
  useEffect(() => {
    if (!config || pendingStages.size === 0 && config.includedStages.length === 0) {
      setPreview(null)
      return
    }
    const stageArray = [...pendingStages]
    if (JSON.stringify(stageArray.sort()) === JSON.stringify([...config.includedStages].sort())) {
      setPreview(null)
      return
    }
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/playoff-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includedStages: stageArray, preview: true }),
    })
      .then((r) => r.json())
      .then((data) => setPreview(data.adjustment ?? null))
      .catch(() => {})
  }, [pendingStages, config, leagueId])

  const toggleStage = useCallback((stageId: string, isPremiumStage: boolean) => {
    if (isPremiumStage && !isPremium) {
      setGateOpen(true)
      return
    }
    setPendingStages((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }, [isPremium])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/playoff-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includedStages: [...pendingStages] }),
      })
      const data = await res.json()
      if (data.error === 'premiumRequired') { setGateOpen(true); return }
      if (!res.ok) { setError(data.error ?? t('lsEd.saveFailed')); return }
      setConfig(data.config)
      setPreview(null)
      setSuccess(true)
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [leagueId, pendingStages])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">{t('lsEd.po.loading')}</div>

  const hasChanges = config && JSON.stringify([...pendingStages].sort()) !== JSON.stringify([...config.includedStages].sort())

  return (
    <div className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Trophy className="h-5 w-5 text-amber-400" />
          {t('lsEd.po.format').replace('{{sport}}', sport)}
        </h3>
        <p className="mt-1 text-xs text-white/50">
          {t('lsEd.po.intro')}
        </p>
      </div>

      {/* Default info */}
      {config && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/60">
          {t('lsEd.po.current').replace('{{value}}', config.includedStages.length === 0 ? t('lsEd.po.default') : t('lsEd.po.stagesEnabled').replace('{{n}}', String(config.includedStages.length)))}
          {config.adjustedPlayoffStartWeek && <span className="ml-2">{t('lsEd.po.startsWeek').replace('{{n}}', String(config.adjustedPlayoffStartWeek))}</span>}
        </div>
      )}

      {/* Stage toggles */}
      <div className="space-y-2">
        {stages.map((stage) => {
          const enabled = pendingStages.has(stage.id)
          const locked = stage.premium && !isPremium

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => toggleStage(stage.id, stage.premium)}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                locked
                  ? 'cursor-pointer border-white/5 bg-white/[0.01] opacity-60 hover:opacity-80'
                  : enabled
                    ? 'border-amber-500/30 bg-amber-950/15'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              {/* Toggle indicator */}
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                locked ? 'border border-white/20 bg-white/5' : enabled ? 'bg-amber-500/80' : 'border border-white/20 bg-white/5'
              }`}>
                {locked ? <Lock className="h-3 w-3 text-white/40" /> : enabled ? <Check className="h-3 w-3 text-white" /> : null}
              </div>

              {/* Label and description */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/90">{stage.label}</span>
                  {stage.premium && (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-300">
                      {t('lsEd.po.premium')}
                    </span>
                  )}
                  {stage.additionalWeeks > 0 && (
                    <span className="text-[11px] text-white/40">{t(stage.additionalWeeks === 1 ? 'lsEd.po.weekOne' : 'lsEd.po.weekMany').replace('{{n}}', String(stage.additionalWeeks))}</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-white/50">{stage.description}</p>
                {stage.timing && <p className="text-[11px] text-white/30">{t('lsEd.po.timing').replace('{{timing}}', stage.timing)}</p>}
                {stage.warning && enabled && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300/80">
                    <AlertTriangle className="h-3 w-3" /> {stage.warning}
                  </p>
                )}
                {locked && (
                  <p className="mt-1 text-[11px] text-amber-300/60">
                    {t('lsEd.po.locked')} <ChevronRight className="inline h-3 w-3" />
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Schedule adjustment preview */}
      {preview && preview.changes.length > 0 && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-3">
          <p className="mb-2 text-xs font-medium text-cyan-200">{t('lsEd.po.impact')}</p>
          <ul className="space-y-1 text-[11px] text-white/60">
            {preview.changes.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-cyan-400">-</span> {c}
              </li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded bg-white/5 px-2 py-1">
              <p className="font-mono text-white">{preview.newPlayoffStartWeek}</p>
              <p className="text-white/40">{t('lsEd.po.playoffStart')}</p>
            </div>
            <div className="rounded bg-white/5 px-2 py-1">
              <p className="font-mono text-white">{preview.newPlayoffWeeks}</p>
              <p className="text-white/40">{t('lsEd.po.playoffWeeks')}</p>
            </div>
            <div className="rounded bg-white/5 px-2 py-1">
              <p className="font-mono text-white">{preview.newChampionshipWeek}</p>
              <p className="text-white/40">{t('lsEd.po.championship')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{t('lsEd.po.saved')}</div>}

      {hasChanges && (
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg border border-amber-500/30 bg-amber-600/20 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-600/30 disabled:opacity-50"
        >
          {saving ? t('lsEd.saving') : t('lsEd.po.save')}
        </button>
      )}

      {/* Subscription gate modal */}
      <SubscriptionGateModal
        isOpen={gateOpen}
        onClose={() => setGateOpen(false)}
        featureId="advanced_playoff_setup"
        featureLabel={t('lsEd.po.gateLabel')}
      />
    </div>
  )
}
