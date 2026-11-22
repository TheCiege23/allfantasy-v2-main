'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { tradeSettingsCopy, tradeSettingsLang, type TradeSettingsCopyKey } from '@/lib/i18n/trade-settings-copy'

type Config = {
  settings?: Record<string, unknown> | null
}

const TRADE_REVIEW_OPTIONS = ['none', 'commissioner', 'league_vote', 'instant'] as const

/** The veto threshold counts votes by default; a commissioner may switch it to a percent of the teams. */
type VetoMode = 'count' | 'percent'

export default function TradeSettingsPanel({ leagueId }: { leagueId?: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tradeReviewType, setTradeReviewType] = useState('commissioner')
  const [vetoThreshold, setVetoThreshold] = useState('')
  const [vetoMode, setVetoMode] = useState<VetoMode>('count')
  const { language } = useLanguage()
  const lang = tradeSettingsLang(language)
  const t = (key: TradeSettingsCopyKey, vars?: Record<string, string | number>) => tradeSettingsCopy(lang, key, vars)

  const hydrateDraft = useCallback((next: Config | null) => {
    setConfig(next)
    const settings = next?.settings ?? {}
    const resolvedType =
      (typeof settings.tradeReviewType === 'string' && settings.tradeReviewType) ||
      (typeof settings.trade_review_mode === 'string' && settings.trade_review_mode) ||
      'commissioner'
    const resolvedVeto =
      typeof settings.vetoThreshold === 'number'
        ? settings.vetoThreshold
        : typeof settings.veto_threshold === 'number'
        ? settings.veto_threshold
        : null
    setTradeReviewType(String(resolvedType))
    setVetoThreshold(resolvedVeto == null ? '' : String(resolvedVeto))
    setVetoMode(String(settings.vetoThresholdMode ?? '').toLowerCase() === 'percent' ? 'percent' : 'count')
  }, [])

  const load = useCallback(async () => {
    if (!leagueId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/settings`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || t('loadFailed'))
        setConfig(null)
        return
      }
      hydrateDraft(data)
    } catch {
      setError(t('loadFailed'))
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [hydrateDraft, leagueId])

  useEffect(() => {
    load()
  }, [load])

  const handleCancel = () => {
    hydrateDraft(config)
    setEditing(false)
  }

  const handleSave = async () => {
    if (!leagueId || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeReviewType,
          vetoThreshold: vetoThreshold.trim() ? parseInt(vetoThreshold, 10) : null,
          vetoThresholdMode: vetoMode,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || t('saveFailed'))
        return
      }
      hydrateDraft(data)
      setEditing(false)
      toast.success(t('saved'))
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
        <p className="mt-2 text-xs text-white/65">{t('selectLeague')}</p>
      </section>
    )
  }

  if (loading && !config) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
        <p className="mt-2 flex items-center gap-2 text-xs text-white/65">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('loading')}
        </p>
      </section>
    )
  }

  if (error && !config) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
        <p className="mt-2 text-xs text-red-400">{error}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-testid="commissioner-trade-edit"
            className="text-xs font-medium text-cyan-400 hover:text-cyan-300"
          >
            {t('edit')}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              data-testid="commissioner-trade-cancel"
              className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              data-testid="commissioner-trade-save"
              className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t('save')}
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-white/65">{t('intro')}</p>

      {editing ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">{t('reviewType')}</label>
            <select
              value={tradeReviewType}
              onChange={(e) => setTradeReviewType(e.target.value)}
              data-testid="commissioner-trade-review-type-select"
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50"
            >
              {TRADE_REVIEW_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`review.${option}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50" htmlFor="commissioner-veto-threshold-input">{t('vetoThreshold')}</label>
            <div className="flex gap-2">
              <input
                id="commissioner-veto-threshold-input"
                type="number"
                min={1}
                max={vetoMode === 'percent' ? 100 : 30}
                value={vetoThreshold}
                onChange={(e) => setVetoThreshold(e.target.value)}
                data-testid="commissioner-veto-threshold-input"
                className="w-24 rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50"
                placeholder={vetoMode === 'percent' ? '50' : '4'}
              />
              <select
                aria-label={t('vetoMode')}
                value={vetoMode}
                onChange={(e) => setVetoMode(e.target.value === 'percent' ? 'percent' : 'count')}
                data-testid="commissioner-veto-mode-select"
                className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50"
              >
                <option value="count">{t('vetoMode.count')}</option>
                <option value="percent">{t('vetoMode.percent')}</option>
              </select>
            </div>
            <p className="mt-1 text-[11px] text-white/45">{t(vetoMode === 'percent' ? 'vetoHint.percent' : 'vetoHint.count')}</p>
          </div>
        </div>
      ) : (
        <dl className="mt-4 space-y-2">
          <div>
            <dt className="text-xs text-white/50">{t('reviewType')}</dt>
            <dd className="text-sm text-white/90" data-testid="commissioner-trade-review-type-value">
              {(TRADE_REVIEW_OPTIONS as readonly string[]).includes(tradeReviewType) ? t(`review.${tradeReviewType}` as TradeSettingsCopyKey) : tradeReviewType || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-white/50">{t('vetoThreshold')}</dt>
            <dd className="text-sm text-white/90" data-testid="commissioner-veto-threshold-value">
              {vetoThreshold.trim() && Number(vetoThreshold) >= 1
                ? t(vetoMode === 'percent' ? 'vetoValue.percent' : 'vetoValue.count', { n: vetoThreshold.trim() })
                : t('vetoValue.default')}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
