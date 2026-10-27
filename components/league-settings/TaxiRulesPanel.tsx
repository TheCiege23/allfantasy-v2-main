'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import type { TaxiMoveRules } from '@/lib/taxi/taxiMoveRules'
import type { TaxiRulesView } from '@/lib/taxi/taxiRulesService'

/**
 * Taxi squad move rules (lib/taxi/taxiMoveRules.ts) on the Roster settings page: the lock week, the
 * promotion deadline, "once promoted cannot return" and the in-season / playoff switches, plus the
 * switch that turns enforcement on. Dynasty leagues that play on AllFantasy only; members see the
 * rules read-only. Saves go to PUT /api/leagues/[id]/taxi-rules. Strings: lsTaxiRules.* (EN/ES).
 */
const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), s)

type Draft = { enforced: boolean; lockAfterWeek: string; promotionDeadlineWeek: string; lockBehavior: 'once_promoted_no_return' | 'free_move'; inSeasonMoves: boolean; postseasonMoves: boolean }

const toDraft = (rules: TaxiMoveRules, enforced: boolean): Draft => ({
  enforced,
  lockAfterWeek: rules.lockAfterWeek != null ? String(rules.lockAfterWeek) : '',
  promotionDeadlineWeek: rules.promotionDeadlineWeek != null ? String(rules.promotionDeadlineWeek) : '',
  lockBehavior: rules.lockBehavior === 'once_promoted_no_return' ? 'once_promoted_no_return' : 'free_move',
  inSeasonMoves: rules.inSeasonMoves,
  postseasonMoves: rules.postseasonMoves,
})

export function TaxiRulesPanel({ leagueId }: { leagueId: string }) {
  const { t } = useOptionalLanguage()
  const ids = { enforce: useId(), lock: useId(), promo: useId(), behavior: useId(), inSeason: useId(), post: useId() }
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/taxi-rules`
  const [view, setView] = useState<TaxiRulesView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as TaxiRulesView | { applies: false }
      if (!data.applies) return
      setView(data)
      setDraft(toDraft(data.rules, data.enforced))
    } catch {
      // A settings card: the page renders without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view || !draft) return null
  const editable = view.canEdit
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enforced: draft.enforced,
          lockAfterWeek: draft.lockAfterWeek.trim() || null,
          promotionDeadlineWeek: draft.promotionDeadlineWeek.trim() || null,
          lockBehavior: draft.lockBehavior,
          inSeasonMoves: draft.inSeasonMoves,
          postseasonMoves: draft.postseasonMoves,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.error || t('lsTaxiRules.failed') })
        return
      }
      setMessage({ tone: 'ok', text: t('lsTaxiRules.saved') })
      await load()
    } catch {
      setMessage({ tone: 'error', text: t('lsTaxiRules.failed') })
    } finally {
      setSaving(false)
    }
  }

  const status = !view.enforced
    ? t('lsTaxiRules.status.off')
    : view.ownerEntitled
      ? t('lsTaxiRules.status.on')
      : t('lsTaxiRules.status.lapsed')
  const weekInput = (id: string, key: 'lockAfterWeek' | 'promotionDeadlineWeek') => (
    <input
      id={id}
      inputMode="numeric"
      className="w-16 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[13px] text-white disabled:opacity-60"
      value={draft[key]}
      placeholder={t('lsTaxiRules.none')}
      disabled={!editable || saving}
      onChange={(e) => set(key, e.target.value.replace(/[^0-9]/g, ''))}
      data-testid={`taxi-rules-${key}`}
    />
  )

  return (
    <section className="af-ls-card space-y-4" data-testid="taxi-rules">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="af-ls-eyebrow">{t('lsTaxiRules.title')}</p>
          <p className="mt-0.5 text-[11px] text-white/40">{fill(t('lsTaxiRules.subtitle'), { week: view.week, phase: t(`lsTaxiRules.phase.${view.phase}`) })}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/60" data-testid="taxi-rules-status">
          {status}
        </span>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p id={`${ids.enforce}-label`} className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/90">
            {t('lsTaxiRules.enforce')}
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
              <Sparkles className="h-3 w-3" aria-hidden />AF Commissioner
            </span>
          </p>
          <p id={`${ids.enforce}-desc`} className="mt-0.5 text-[11px] leading-snug text-white/40">{t('lsTaxiRules.enforceDesc')}</p>
          {view.isCommissioner && !view.canEdit ? (
            <a href="/upgrade?plan=commissioner" className="mt-1 inline-block text-[11px] font-semibold text-violet-300 underline" data-testid="taxi-rules-upgrade">
              {t('lsTaxiRules.upgrade')}
            </a>
          ) : null}
        </div>
        <SettingsSwitch
          checked={draft.enforced}
          onChange={(v) => set('enforced', v)}
          disabled={!editable || saving}
          labelledBy={`${ids.enforce}-label`}
          describedBy={`${ids.enforce}-desc`}
        />
      </div>

      <div className="grid min-w-0 gap-3">
        <label htmlFor={ids.lock} className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-white/85">{t('lsTaxiRules.lock')}</span>
            <span className="block text-[11px] leading-snug text-white/40">{t('lsTaxiRules.lockDesc')}</span>
          </span>
          {weekInput(ids.lock, 'lockAfterWeek')}
        </label>
        <label htmlFor={ids.promo} className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-white/85">{t('lsTaxiRules.promotion')}</span>
            <span className="block text-[11px] leading-snug text-white/40">{t('lsTaxiRules.promotionDesc')}</span>
          </span>
          {weekInput(ids.promo, 'promotionDeadlineWeek')}
        </label>
        <label htmlFor={ids.behavior} className="flex min-w-0 items-center justify-between gap-3">
          <span className="block text-[12px] font-semibold text-white/85">{t('lsTaxiRules.behavior')}</span>
          <select
            id={ids.behavior}
            className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[13px] text-white disabled:opacity-60"
            value={draft.lockBehavior}
            disabled={!editable || saving}
            onChange={(e) => set('lockBehavior', e.target.value as Draft['lockBehavior'])}
            data-testid="taxi-rules-behavior"
          >
            <option value="once_promoted_no_return">{t('lsTaxiRules.behavior.noReturn')}</option>
            <option value="free_move">{t('lsTaxiRules.behavior.free')}</option>
          </select>
        </label>
        {(
          [
            ['inSeasonMoves', ids.inSeason, 'lsTaxiRules.inSeason', 'lsTaxiRules.inSeasonDesc'],
            ['postseasonMoves', ids.post, 'lsTaxiRules.postseason', 'lsTaxiRules.postseasonDesc'],
          ] as const
        ).map(([key, id, label, desc]) => (
          <div key={key} className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p id={`${id}-label`} className="text-[12px] font-semibold text-white/85">{t(label)}</p>
              <p id={`${id}-desc`} className="mt-0.5 text-[11px] leading-snug text-white/40">{t(desc)}</p>
            </div>
            <SettingsSwitch checked={draft[key]} onChange={(v) => set(key, v)} disabled={!editable || saving} labelledBy={`${id}-label`} describedBy={`${id}-desc`} />
          </div>
        ))}
      </div>

      <p className="text-[11px] text-white/40">{t('lsTaxiRules.offseason')}</p>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'error' ? 'border border-red-500/20 bg-red-950/20 text-red-300' : 'border border-emerald-500/20 bg-emerald-950/20 text-emerald-300'}`}
        >
          {message.text}
        </p>
      ) : null}

      {editable ? (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:opacity-50"
          data-testid="taxi-rules-save"
        >
          {saving ? t('lsTaxiRules.saving') : t('lsTaxiRules.save')}
        </button>
      ) : null}
    </section>
  )
}
