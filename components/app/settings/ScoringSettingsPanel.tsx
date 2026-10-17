'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

type ScoringRuleConfig = {
  statKey: string
  pointsValue: number
  multiplier: number
  enabled: boolean
  defaultPointsValue: number
  defaultEnabled: boolean
  isOverridden: boolean
}

type ScoringConfig = {
  leagueId: string
  sport: string
  leagueVariant: string | null
  formatType: string
  templateId: string
  categoryScoring?: { mode: string; presetId: string; recordMode: string; categories: Array<{ id: string; label: string; direction: string }> }
  rules: ScoringRuleConfig[]
}

type EditableRule = {
  statKey: string
  pointsValue: number
  enabled: boolean
}

function toEditableRules(config: ScoringConfig): EditableRule[] {
  return config.rules.map((rule) => ({
    statKey: rule.statKey,
    pointsValue: rule.pointsValue,
    enabled: rule.enabled,
  }))
}

function formatStatLabel(statKey: string): string {
  return statKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase())
}

export default function ScoringSettingsPanel({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const { t } = useOptionalLanguage()
  const { data: config, loading, error, reload } = useLeagueSectionData<ScoringConfig>(
    leagueId,
    'scoring/config'
  )
  const [canEdit, setCanEdit] = useState(false)
  const [checkingEditPermission, setCheckingEditPermission] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<EditableRule[]>([])

  useEffect(() => {
    if (!leagueId) return
    let active = true
    setCheckingEditPermission(true)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/scoring?type=settings`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!active) return
        setCanEdit(res.ok)
      })
      .catch(() => {
        if (!active) return
        setCanEdit(false)
      })
      .finally(() => {
        if (!active) return
        setCheckingEditPermission(false)
      })
    return () => {
      active = false
    }
  }, [leagueId])

  useEffect(() => {
    if (!config) return
    setRules(toEditableRules(config))
  }, [config])

  const overrideCount = useMemo(() => {
    if (!config) return 0
    const defaultByStat = new Map(
      config.rules.map((rule) => [
        rule.statKey,
        { pointsValue: rule.defaultPointsValue, enabled: rule.defaultEnabled },
      ])
    )
    return rules.reduce((count, row) => {
      const base = defaultByStat.get(row.statKey)
      if (!base) return count
      const hasPointsDiff = Math.abs(row.pointsValue - base.pointsValue) > 0.0001
      const hasEnabledDiff = row.enabled !== base.enabled
      return hasPointsDiff || hasEnabledDiff ? count + 1 : count
    }, 0)
  }, [config, rules])

  async function saveOverrides() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/scoring`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules }),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error ?? t('scorePanel.toast.saveFailed'))
        return
      }
      toast.success(t('scorePanel.toast.saved'))
      setEditing(false)
      await reload()
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">{t('scorePanel.title')}</h3>
        <p className="mt-2 text-xs text-white/65">
          {t('scorePanel.selectLeague')}
        </p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">{t('scorePanel.title')}</h3>
        <p className="mt-2 text-xs text-white/65">{t('scorePanel.loading')}</p>
      </section>
    )
  }

  if (error || !config) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">{t('scorePanel.title')}</h3>
        <p className="mt-2 text-xs text-red-400/90">
          {error ?? t('scorePanel.loadFailed')}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{t('scorePanel.title')}</h3>
        {canEdit && !config.categoryScoring && (
          <button
            type="button"
            data-testid="scoring-settings-edit-toggle"
            disabled={checkingEditPermission || saving}
            onClick={() => {
              if (editing) {
                setRules(toEditableRules(config))
                setEditing(false)
                return
              }
              setEditing(true)
            }}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {editing ? t('scorePanel.cancel') : t('scorePanel.edit')}
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-white/65">
        {config.sport}
        {config.leagueVariant ? ` · ${config.leagueVariant}` : ''} · {t('scorePanel.format')}{' '}
        {config.formatType}
      </p>
      {checkingEditPermission && (
        <p className="mt-1 text-[11px] text-white/45">{t('scorePanel.checkingAccess')}</p>
      )}

      {config.categoryScoring && (
        <div data-testid="category-scoring-settings" className="mt-3 rounded border border-white/15 p-3 text-sm">
          <p>{config.categoryScoring.recordMode === 'each' ? t('scorePanel.record.each') : config.categoryScoring.recordMode === 'roto' ? t('scorePanel.record.roto') : t('scorePanel.record.most')}</p>
          <ul className="mt-2 flex flex-wrap gap-3">{config.categoryScoring.categories.map(category => <li key={category.id}>{category.label} ({category.direction === 'lower' ? t('scorePanel.lowerWins') : t('scorePanel.higherWins')})</li>)}</ul>
          <p className="mt-2 text-xs text-white/65">{t('scorePanel.pctNote')}</p>
        </div>
      )}
      <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
        <div className="rounded border border-white/10 bg-black/35 px-2.5 py-2">
          <p className="text-white/50">{t('scorePanel.template')}</p>
          <p className="font-medium text-white/85">{config.templateId}</p>
        </div>
        <div className="rounded border border-white/10 bg-black/35 px-2.5 py-2">
          <p className="text-white/50">{t('scorePanel.enabledCategories')}</p>
          <p className="font-medium text-white/85">
            {config.categoryScoring ? config.categoryScoring.categories.length : rules.filter((r) => r.enabled).length} / {config.categoryScoring ? config.categoryScoring.categories.length : rules.length}
          </p>
        </div>
        <div className="rounded border border-white/10 bg-black/35 px-2.5 py-2">
          <p className="text-white/50">{t('scorePanel.overrides')}</p>
          <p
            data-testid="scoring-settings-override-count"
            className="font-medium text-white/85"
          >
            {overrideCount}
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-black/40 text-white/60">
            <tr>
              <th className="px-2.5 py-2 font-medium">{t('scorePanel.col.category')}</th>
              <th className="px-2.5 py-2 font-medium">{t('scorePanel.col.enabled')}</th>
              <th className="px-2.5 py-2 font-medium">{t('scorePanel.col.points')}</th>
              <th className="px-2.5 py-2 font-medium">{t('scorePanel.col.multiplier')}</th>
              <th className="px-2.5 py-2 font-medium">{t('scorePanel.col.default')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((row, idx) => {
              const base = config.rules.find((r) => r.statKey === row.statKey)
              const multiplier = base?.multiplier ?? 1
              const defaultPoints = base?.defaultPointsValue ?? row.pointsValue
              const defaultEnabled = base?.defaultEnabled ?? row.enabled
              const isChanged =
                Math.abs(row.pointsValue - defaultPoints) > 0.0001 ||
                row.enabled !== defaultEnabled
              return (
                <tr key={row.statKey} className="border-t border-white/10 text-white/85">
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <div className="font-medium">{formatStatLabel(row.statKey)}</div>
                    <div className="text-[11px] text-white/40">{row.statKey}</div>
                  </td>
                  <td className="px-2.5 py-2">
                    <input
                      aria-label={t('scorePanel.aria.enabled').replace('{{stat}}', row.statKey)}
                      type="checkbox"
                      checked={row.enabled}
                      disabled={!editing}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((item, itemIdx) =>
                            itemIdx === idx
                              ? { ...item, enabled: e.target.checked }
                              : item
                          )
                        )
                      }
                      className="h-4 w-4 accent-cyan-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <input
                      aria-label={t('scorePanel.aria.points').replace('{{stat}}', row.statKey)}
                      type="number"
                      step="0.1"
                      value={row.pointsValue}
                      disabled={!editing}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((item, itemIdx) =>
                            itemIdx === idx
                              ? { ...item, pointsValue: Number(e.target.value) || 0 }
                              : item
                          )
                        )
                      }
                      className="w-24 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2.5 py-2 text-white/70">{multiplier}</td>
                  <td className="px-2.5 py-2 text-white/55">
                    {defaultEnabled ? t('scorePanel.on') : t('scorePanel.off')} · {defaultPoints}
                    {isChanged ? (
                      <span className="ml-2 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[11px] text-cyan-200">
                        {t('scorePanel.changed')}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="scoring-settings-reset-defaults"
            onClick={() => {
              setRules(
                config.rules.map((rule) => ({
                  statKey: rule.statKey,
                  pointsValue: rule.defaultPointsValue,
                  enabled: rule.defaultEnabled,
                }))
              )
            }}
            className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
          >
            {t('scorePanel.resetDefaults')}
          </button>
          <button
            type="button"
            data-testid="scoring-settings-save"
            disabled={saving}
            onClick={() => void saveOverrides()}
            className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
          >
            {saving ? t('scorePanel.saving') : t('scorePanel.save')}
          </button>
        </div>
      )}
    </section>
  )
}
