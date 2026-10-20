'use client'

/**
 * components/league-settings/LiveRookieOrderPanel.tsx
 * The live rookie draft order: every slot locked or pending, with the reason it landed there, and
 * the settings that produce it. Reads and saves /api/commissioner/leagues/[leagueId]/rookie-draft-order/live.
 *
 * Free: any commissioner sees the order and previews other settings. AF Commissioner: the
 * automation switch, which saves the final order when the title game ends and seats the next
 * rookie draft from it. Built for a 360–390px phone first.
 *
 * The per-slot reasons come from the server engine (lib/rookie-order/rookieOrderEngine.ts) and
 * are shown as sent; the labels, options and badges around them are translated here.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { ChevronDown, Lock, Hourglass, Sparkles } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import { ImportedOrderChecklist } from '@/components/import-assist/ImportedOrderChecklist'

type Config = { nonPlayoff: string; playoff: string; withinRound: string }

type Slot = {
  slot: number
  teamId: string
  name: string
  group: 'non_playoff' | 'playoff'
  status: 'locked' | 'provisional'
  finish: string | null
  reason: string
}

type LiveView = {
  draftSeason: number
  basedOnSeason: number
  source?: 'native' | 'imported'
  platform?: string | null
  result: { phase: 'regular_season' | 'playoffs' | 'final'; maxPfSource: 'max_pf' | 'points_for'; slots: Slot[]; warnings: string[] }
  notes: string[]
  settings: { enabled: boolean; config: Config; finalOrder: { basedOnSeason: number; savedAt: string } | null }
  automationActive: boolean
  canAutomate: boolean
  preview: boolean
}

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), s)

const NON_PLAYOFF = ['reverse_max_pf', 'reverse_points_for', 'reverse_record'] as const
const PLAYOFF = ['finish_then_seed', 'reverse_record', 'reverse_max_pf'] as const
const WITHIN = ['worse_seed', 'reverse_max_pf', 'reverse_points_for'] as const

function pickLabel(round: number, slot: number) {
  return `${round}.${String(slot).padStart(2, '0')}`
}

export function LiveRookieOrderPanel({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const ids = { auto: useId(), np: useId(), po: useId(), wr: useId() }
  const base = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/rookie-draft-order/live`

  const [view, setView] = useState<LiveView | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async (preview?: Config) => {
    const qs = preview ? `?${new URLSearchParams(preview).toString()}` : ''
    try {
      const res = await fetch(`${base}${qs}`, { cache: 'no-store' })
      if (!res.ok) { setUnavailable(true); return }
      const data = (await res.json()) as LiveView
      setUnavailable(false)
      setView(data)
      if (!preview) {
        setConfig(data.settings.config)
        setEnabled(data.settings.enabled)
      }
    } catch {
      setUnavailable(true)
    }
  }, [base])

  useEffect(() => { load() }, [load])

  const change = (key: keyof Config, value: string) => {
    if (!config) return
    const next = { ...config, [key]: value }
    setConfig(next)
    setMessage(null)
    load(next)
  }

  const save = async () => {
    if (!config) return
    setSaving(true); setMessage(null)
    try {
      const res = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, config }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 402) { setMessage({ tone: 'error', text: t('lsEd.dr.live.needsSub') }); return }
      if (!res.ok) { setMessage({ tone: 'error', text: data.error ?? t('lsEd.saveFailed') }); return }
      setMessage({ tone: 'ok', text: t('lsEd.dr.live.saved') })
      await load()
    } catch {
      setMessage({ tone: 'error', text: t('lsEd.requestFailed') })
    } finally {
      setSaving(false)
    }
  }

  if (unavailable) {
    return (
      <section className="af-ls-card space-y-1" data-testid="live-rookie-order">
        <p className="af-ls-eyebrow">{t('lsEd.dr.live.title')}</p>
        <p className="text-[12px] text-white/40">{t('lsEd.dr.live.noData')}</p>
      </section>
    )
  }
  if (!view || !config) return null

  const { result } = view
  const phaseLabel = t(`lsEd.dr.live.phase.${result.phase}`)
  const nonPlayoff = result.slots.filter((s) => s.group === 'non_playoff')
  const playoff = result.slots.filter((s) => s.group === 'playoff')
  const dirty =
    enabled !== view.settings.enabled ||
    (Object.keys(config) as (keyof Config)[]).some((k) => config[k] !== view.settings.config[k])
  const savedOrder = view.settings.finalOrder

  return (
    <section className="af-ls-card space-y-4" data-testid="live-rookie-order">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="af-ls-eyebrow">{t('lsEd.dr.live.title')}</p>
          <p className="mt-0.5 text-[11px] text-white/40">
            {fill(t('lsEd.dr.live.subtitle'), { season: view.draftSeason })}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
            result.phase === 'final' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
          }`}
        >
          {phaseLabel}
        </span>
      </div>

      {/* Settings */}
      <div className="grid min-w-0 gap-3">
        <Field id={ids.np} label={t('lsEd.dr.live.nonPlayoff')} value={config.nonPlayoff}
          options={NON_PLAYOFF.map((v) => ({ value: v, label: t(`lsEd.dr.live.np.${v}`) }))}
          onChange={(v) => change('nonPlayoff', v)} />
        <Field id={ids.po} label={t('lsEd.dr.live.playoff')} value={config.playoff}
          options={PLAYOFF.map((v) => ({ value: v, label: t(`lsEd.dr.live.po.${v}`) }))}
          onChange={(v) => change('playoff', v)} />
        {config.playoff === 'finish_then_seed' && (
          <Field id={ids.wr} label={t('lsEd.dr.live.withinRound')} value={config.withinRound}
            options={WITHIN.map((v) => ({ value: v, label: t(`lsEd.dr.live.wr.${v}`) }))}
            onChange={(v) => change('withinRound', v)} />
        )}
      </div>

      {/* Automation */}
      <div className="flex min-w-0 items-center justify-between gap-3 py-1">
        <div className="min-w-0 flex-1">
          <p id={`${ids.auto}-label`} className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/90">
            {t('lsEd.dr.live.auto')}
            {!view.canAutomate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
                <Sparkles className="h-3 w-3" aria-hidden />{t('lsEd.dr.live.subBadge')}
              </span>
            )}
          </p>
          <p id={`${ids.auto}-desc`} className="mt-0.5 text-[11px] leading-snug text-white/40">{t('lsEd.dr.live.autoDesc')}</p>
          {!view.canAutomate && (
            <a href="/upgrade?plan=commissioner" className="mt-1 inline-block text-[11px] font-semibold text-violet-300 underline">
              {t('lsEd.dr.live.upgrade')}
            </a>
          )}
        </div>
        <SettingsSwitch checked={enabled} onChange={setEnabled} disabled={!view.canAutomate && !view.settings.enabled}
          labelledBy={`${ids.auto}-label`} describedBy={`${ids.auto}-desc`} />
      </div>

      {savedOrder && (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-300">
          {fill(t('lsEd.dr.live.savedOrder'), { season: savedOrder.basedOnSeason + 1 })}
        </p>
      )}

      {/* Order */}
      <div className="space-y-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            {fill(t('lsEd.dr.preview'), { season: String(view.draftSeason) })}
          </p>
          {view.preview && (
            <span className="shrink-0 rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] font-bold text-amber-300">
              {t('lsEd.dr.live.unsaved')}
            </span>
          )}
        </div>
        <ol className="rounded-xl border border-white/10 bg-white/[0.02] p-1.5">
          {nonPlayoff.length > 0 && (
            <li className="px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white/30" aria-hidden>{t('lsEd.dr.nonPlayoff')}</li>
          )}
          {nonPlayoff.map((s) => <SlotRow key={s.teamId} slot={s} t={t} />)}
          {playoff.length > 0 && (
            <li className="mt-1 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-400/60" aria-hidden>{t('lsEd.dr.playoffTeams')}</li>
          )}
          {playoff.map((s) => <SlotRow key={s.teamId} slot={s} t={t} />)}
        </ol>
        {[...result.warnings, ...view.notes].map((w) => (
          <p key={w} className="text-[11px] text-amber-300/70">{w}</p>
        ))}
      </div>

      {view.source === 'imported' && !view.preview && (
        <ImportedOrderChecklist platform={view.platform ?? null} draftSeason={view.draftSeason} phase={result.phase} slots={result.slots} />
      )}

      <div aria-live="polite">
        {message && (
          <p role={message.tone === 'error' ? 'alert' : undefined}
            className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'error' ? 'border border-red-500/20 bg-red-950/20 text-red-300' : 'border border-emerald-500/20 bg-emerald-950/20 text-emerald-300'}`}>
            {message.text}
          </p>
        )}
      </div>

      <button type="button" disabled={saving || !dirty} onClick={save}
        className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:opacity-50">
        {saving ? t('scoring.saving') : t('lsEd.dr.live.save')}
      </button>
    </section>
  )
}

function SlotRow({ slot, t }: { slot: Slot; t: (k: string) => string }) {
  const locked = slot.status === 'locked'
  const finish =
    slot.finish === 'Champion' ? t('lsEd.dr.champion')
      : slot.finish === 'Runner-up' ? t('lsEd.dr.runnerUp')
      : slot.finish
  return (
    <li className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5">
      <span className="w-9 shrink-0 pt-px text-right font-mono text-[12px] font-bold text-white/50">{pickLabel(1, slot.slot)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[13px] font-medium text-white/85">{slot.name}</span>
          {finish && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              slot.finish === 'Champion' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-white/45'
            }`}>{finish}</span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-white/40">{slot.reason}</p>
      </div>
      <span
        className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
          locked ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
        }`}
      >
        {locked ? <Lock className="h-3 w-3" aria-hidden /> : <Hourglass className="h-3 w-3" aria-hidden />}
        {locked ? t('lsEd.dr.live.locked') : t('lsEd.dr.live.pending')}
      </span>
    </li>
  )
}

function Field({ id, label, value, options, onChange }: {
  id: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-[12px] font-semibold text-white/80">{label}</label>
      <div className="relative min-w-0">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 appearance-none truncate rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2.5 pr-9 text-sm font-medium text-white">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
      </div>
    </div>
  )
}
