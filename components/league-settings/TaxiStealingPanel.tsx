'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import { CLAIMS_PER_SEASON_CHOICES, PROTECT_HOURS_CHOICES, type TaxiStealingRule } from '@/lib/taxi/taxiStealing'
import type { TaxiStealView } from '@/lib/taxi/taxiStealingService'

/**
 * Taxi stealing (lib/taxi/taxiStealing.ts) on the Roster settings page: the switch, the protection
 * window and claims per team per season. Dynasty leagues that play on AllFantasy only; members see it
 * read-only. Saves go to POST /api/leagues/[id]/taxi-steals { action: 'rule' }, which runs the league
 * settings save. Claims themselves are on the Waivers page. Strings: lsTaxiSteal.* (EN/ES).
 */
const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), s)

export function TaxiStealingPanel({ leagueId }: { leagueId: string }) {
  const { t } = useOptionalLanguage()
  const ids = { enable: useId(), hours: useId(), per: useId() }
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/taxi-steals`
  const [view, setView] = useState<Extract<TaxiStealView, { supported: true }> | null>(null)
  const [draft, setDraft] = useState<TaxiStealingRule | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as TaxiStealView
      if (!data.supported) return
      setView(data)
      setDraft(data.rule)
    } catch {
      // A settings card: the page renders without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view || !draft) return null
  // Any commissioner may switch it off; switching it on, or changing it while on, is AF Commissioner.
  const editable = view.canEdit || (view.isCommissioner && view.rule.enabled)
  const set = <K extends keyof TaxiStealingRule>(k: K, v: TaxiStealingRule[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rule', rule: draft }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.error || t('lsTaxiSteal.failed') })
        return
      }
      setMessage({ tone: 'ok', text: t('lsTaxiSteal.saved') })
      await load()
    } catch {
      setMessage({ tone: 'error', text: t('lsTaxiSteal.failed') })
    } finally {
      setSaving(false)
    }
  }

  const status = !view.rule.enabled ? t('lsTaxiSteal.status.off') : view.active ? t('lsTaxiSteal.status.on') : t('lsTaxiSteal.status.lapsed')
  const selectClass = 'rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[13px] text-white disabled:opacity-60'

  return (
    <section className="af-ls-card space-y-4" data-testid="taxi-stealing">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="af-ls-eyebrow min-w-0">{t('lsTaxiSteal.title')}</p>
        <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/60" data-testid="taxi-stealing-status">
          {status}
        </span>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p id={`${ids.enable}-label`} className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/90">
            {t('lsTaxiSteal.enable')}
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
              <Sparkles className="h-3 w-3" aria-hidden />AF Commissioner
            </span>
          </p>
          <p id={`${ids.enable}-desc`} className="mt-0.5 text-[11px] leading-snug text-white/40">{t('lsTaxiSteal.enableDesc')}</p>
          {view.isCommissioner && !view.canEdit ? (
            <a href="/upgrade?plan=commissioner" className="mt-1 inline-block text-[11px] font-semibold text-violet-300 underline" data-testid="taxi-stealing-upgrade">
              {t('lsTaxiSteal.upgrade')}
            </a>
          ) : null}
        </div>
        <SettingsSwitch
          checked={draft.enabled}
          onChange={(v) => set('enabled', v)}
          disabled={!editable || saving}
          labelledBy={`${ids.enable}-label`}
          describedBy={`${ids.enable}-desc`}
        />
      </div>

      <div className="grid min-w-0 gap-3">
        <label htmlFor={ids.hours} className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-white/85">{t('lsTaxiSteal.hours')}</span>
            <span className="block text-[11px] leading-snug text-white/40">{t('lsTaxiSteal.hoursDesc')}</span>
          </span>
          <select id={ids.hours} className={selectClass} value={draft.protectHours} disabled={!view.canEdit || saving} onChange={(e) => set('protectHours', Number(e.target.value))} data-testid="taxi-stealing-hours">
            {PROTECT_HOURS_CHOICES.map((h) => (
              <option key={h} value={h}>{fill(t('lsTaxiSteal.hoursN'), { n: h })}</option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.per} className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-white/85">{t('lsTaxiSteal.perSeason')}</span>
            <span className="block text-[11px] leading-snug text-white/40">{t('lsTaxiSteal.perSeasonDesc')}</span>
          </span>
          <select id={ids.per} className={selectClass} value={draft.claimsPerSeason} disabled={!view.canEdit || saving} onChange={(e) => set('claimsPerSeason', Number(e.target.value))} data-testid="taxi-stealing-per">
            {CLAIMS_PER_SEASON_CHOICES.map((n) => (
              <option key={n} value={n}>{n === 0 ? t('lsTaxiSteal.noLimit') : String(n)}</option>
            ))}
          </select>
        </label>
      </div>

      {view.isCommissioner ? (
        <button type="button" className="af-btn" disabled={!editable || saving} onClick={() => void save()} data-testid="taxi-stealing-save">
          {saving ? t('lsTaxiSteal.saving') : t('lsTaxiSteal.save')}
        </button>
      ) : null}
      {message ? (
        <p role="status" className={message.tone === 'ok' ? 'text-[12px] text-emerald-300' : 'text-[12px] text-rose-300'}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
