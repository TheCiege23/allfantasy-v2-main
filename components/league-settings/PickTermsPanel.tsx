'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import type { PickTermsView } from '@/lib/league-trade-engine/pickTermsService'

/**
 * Conditional and protected picks (lib/league-trade-engine/pickTerms.ts) on the Trade settings page:
 * the switch that lets an offer give a future pick terms. Dynasty leagues that play on AllFantasy
 * only; members see it read-only. Saves go to POST /api/leagues/[id]/pick-terms, which runs the
 * league settings save. Strings: lsPickTerms.* (EN/ES).
 */
export function PickTermsPanel({ leagueId }: { leagueId: string }) {
  const { t } = useOptionalLanguage()
  const id = useId()
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/pick-terms`
  const [view, setView] = useState<Extract<PickTermsView, { supported: true }> | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as PickTermsView
      if (!data.supported) return
      setView(data)
      setEnabled(data.enabled)
    } catch {
      // A settings card: the page renders without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view) return null
  // Any commissioner may switch it off; switching it on is AF Commissioner.
  const editable = view.canEdit || (view.isCommissioner && view.enabled)

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule: { enabled } }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.error || t('lsPickTerms.failed') })
        return
      }
      setMessage({ tone: 'ok', text: t('lsPickTerms.saved') })
      await load()
    } catch {
      setMessage({ tone: 'error', text: t('lsPickTerms.failed') })
    } finally {
      setSaving(false)
    }
  }

  const status = !view.enabled ? t('lsPickTerms.status.off') : view.active ? t('lsPickTerms.status.on') : t('lsPickTerms.status.lapsed')

  return (
    <section className="space-y-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3" data-testid="pick-terms-panel">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p id={`${id}-label`} className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/90">
            {t('lsPickTerms.enable')}
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
              <Sparkles className="h-3 w-3" aria-hidden />AF Commissioner
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/60" data-testid="pick-terms-status">{status}</span>
          </p>
          <p id={`${id}-desc`} className="mt-0.5 text-[11px] leading-snug text-white/40">{t('lsPickTerms.enableDesc')}</p>
          {view.isCommissioner && !view.canEdit ? (
            <a href="/upgrade?plan=commissioner" className="mt-1 inline-block text-[11px] font-semibold text-violet-300 underline" data-testid="pick-terms-upgrade">
              {t('lsPickTerms.upgrade')}
            </a>
          ) : null}
        </div>
        <SettingsSwitch checked={enabled} onChange={setEnabled} disabled={!editable || saving} labelledBy={`${id}-label`} describedBy={`${id}-desc`} />
      </div>
      {view.isCommissioner ? (
        <button type="button" className="af-btn" disabled={!editable || saving || enabled === view.enabled} onClick={() => void save()} data-testid="pick-terms-save">
          {saving ? t('lsPickTerms.saving') : t('lsPickTerms.save')}
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
