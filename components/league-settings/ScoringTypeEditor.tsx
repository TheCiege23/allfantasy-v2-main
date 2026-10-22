'use client'

/**
 * Commissioner editor for a league's scoring TYPE (points / H2H categories / roto) and its category
 * list (add, remove, reorder). Talks to `/api/commissioner/leagues/[leagueId]/scoring-type`, through
 * the mid-season confirmation like every other scoring editor. Renders nothing for a sport with no
 * alternative to points, and read-only for a non-commissioner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMidSeasonConfirm } from '@/components/league-settings/useMidSeasonConfirm'

type CatalogEntry = { id: string; label: string; description: string | null; direction: 'higher' | 'lower' }
type ScoringTypeResponse = {
  current: { mode: string; presetId: string | null; recordMode: string | null; categoryIds: string[] }
  options: {
    modes: string[]
    presets: Array<{ id: string; categoryIds: string[] }>
    /** When set, the only presets rotisserie may use (NBA roto is 9-cat only). */
    rotoPresets?: string[] | null
    catalog: CatalogEntry[]
  }
  isCommissioner?: boolean
  effectiveFromWeek?: number | null
  error?: string
}

const PRESET_LABELS: Record<string, string> = {
  nba_8cat: '8-cat (legacy)',
  nba_8cat_standard: '8-cat',
  nba_9cat: '9-cat',
  mlb_5x5: '5x5',
  mlb_6x6: '6x6',
  nhl_standard: 'Standard',
}

export function ScoringTypeEditor({
  leagueId,
  isCommissioner = false,
  onChanged,
}: {
  leagueId: string
  isCommissioner?: boolean
  /** Called after a save that changed the type, so the host panel can reload its own view. */
  onChanged?: () => void
}) {
  const { t } = useOptionalLanguage()
  const { confirmFetch, dialog } = useMidSeasonConfirm()
  const [data, setData] = useState<ScoringTypeResponse | null>(null)
  const [mode, setMode] = useState('points')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [recordMode, setRecordMode] = useState<string | null>(null)
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const adopt = useCallback((d: ScoringTypeResponse) => {
    setData(d)
    setMode(d.current.mode)
    setPresetId(d.current.presetId)
    setRecordMode(d.current.recordMode)
    setCategoryIds(d.current.categoryIds)
  }, [])

  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/scoring-type`
  useEffect(() => {
    let active = true
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // A body without the expected shape renders nothing rather than a broken editor.
      .then((d: ScoringTypeResponse) => { if (active && d?.current && d?.options) adopt(d) })
      .catch(() => { if (active) setError(t('lsScore.type.err.load')) })
    return () => { active = false }
  }, [url, adopt, t])

  const catalogById = useMemo(() => new Map((data?.options.catalog ?? []).map((c) => [c.id, c])), [data])
  const isCategoryMode = mode !== 'points'
  const recordModes = mode === 'roto' ? ['roto'] : ['each', 'most']
  const addable = (data?.options.catalog ?? []).filter((c) => !categoryIds.includes(c.id))

  const presetsFor = (m: string | null) => {
    const all = data?.options.presets ?? []
    const roto = data?.options.rotoPresets
    return m === 'roto' && roto ? all.filter((p) => roto.includes(p.id)) : all
  }
  const visiblePresets = presetsFor(mode)

  const changeMode = (next: string) => {
    setMode(next)
    if (next === 'points') return
    const allowed = presetsFor(next)
    const keep = Boolean(presetId && allowed.some((p) => p.id === presetId))
    const preset = keep ? presetId : allowed[0]?.id ?? null
    setPresetId(preset)
    if (categoryIds.length === 0 || !keep) setCategoryIds(allowed.find((p) => p.id === preset)?.categoryIds ?? [])
    const modes = next === 'roto' ? ['roto'] : ['each', 'most']
    if (!recordMode || !modes.includes(recordMode)) setRecordMode(modes[modes.length - 1])
  }
  const changePreset = (id: string) => {
    setPresetId(id)
    setCategoryIds(data?.options.presets.find((p) => p.id === id)?.categoryIds ?? [])
  }
  const move = (index: number, by: -1 | 1) =>
    setCategoryIds((ids) => {
      const to = index + by
      if (to < 0 || to >= ids.length) return ids
      const next = [...ids]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const save = async () => {
    setSaving(true); setError(null); setNotice(null)
    try {
      const body = isCategoryMode ? { mode, presetId, recordMode, categoryIds } : { mode }
      const res = await confirmFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = (await res.json().catch(() => ({}))) as ScoringTypeResponse
      if (!res.ok) { setError(d.error ?? t('lsScore.type.err.save')); return }
      if (d?.current && d?.options) adopt(d)
      setNotice(d.effectiveFromWeek ? t('lsScore.type.savedFromWeek').replace('{{week}}', String(d.effectiveFromWeek)) : t('lsScore.type.saved'))
      onChanged?.()
    } catch {
      setError(t('lsScore.type.err.save'))
    } finally {
      setSaving(false)
    }
  }

  if (!data) return error ? <p className="text-xs text-red-300" role="alert">{error}</p> : null
  if (data.options.modes.length < 2) return null
  const canEdit = isCommissioner

  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid="scoring-type-editor">
      {dialog}
      <div>
        <h4 className="text-sm font-semibold text-white">{t('lsScore.type.title')}</h4>
        <p className="mt-0.5 text-[11px] text-white/50">{t('lsScore.type.subtitle')}</p>
      </div>

      <label className="block text-xs text-white/60">
        {t('lsScore.type.mode')}
        <select
          className="mt-1 block w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
          value={mode}
          disabled={!canEdit}
          onChange={(e) => changeMode(e.target.value)}
          data-testid="scoring-type-mode"
        >
          {data.options.modes.map((m) => <option key={m} value={m}>{t(`lsScore.type.mode.${m}`)}</option>)}
        </select>
      </label>

      {isCategoryMode && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/60">
              {t('lsScore.type.preset')}
              <select
                className="mt-1 block w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                value={presetId ?? ''}
                disabled={!canEdit}
                onChange={(e) => changePreset(e.target.value)}
                data-testid="scoring-type-preset"
              >
                {visiblePresets.map((p) => <option key={p.id} value={p.id}>{PRESET_LABELS[p.id] ?? p.id}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/60">
              {t('lsScore.type.record')}
              <select
                className="mt-1 block w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white"
                value={recordMode ?? ''}
                disabled={!canEdit || recordModes.length < 2}
                onChange={(e) => setRecordMode(e.target.value)}
                data-testid="scoring-type-record"
              >
                {recordModes.map((r) => <option key={r} value={r}>{t(`lsScore.type.record.${r}`)}</option>)}
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs text-white/60">{t('lsScore.type.categories')}</p>
            <ol className="mt-1 space-y-1" data-testid="scoring-type-categories">
              {categoryIds.map((id, i) => (
                <li key={id} className="flex items-center gap-2 rounded-lg border border-white/10 px-2 py-1 text-sm text-white" data-testid={`scoring-type-category-${id}`}>
                  <span className="flex-1">{catalogById.get(id)?.label ?? id}</span>
                  {canEdit && (
                    <>
                      <button type="button" aria-label={t('lsScore.type.up')} disabled={i === 0} onClick={() => move(i, -1)} className="text-white/50 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label={t('lsScore.type.down')} disabled={i === categoryIds.length - 1} onClick={() => move(i, 1)} className="text-white/50 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label={t('lsScore.type.remove')} disabled={categoryIds.length <= 1} onClick={() => setCategoryIds((ids) => ids.filter((x) => x !== id))} className="text-white/50 disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </li>
              ))}
            </ol>
            {canEdit && addable.length > 0 && (
              <select
                className="mt-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                value=""
                onChange={(e) => { const id = e.target.value; if (id) setCategoryIds((ids) => [...ids, id]) }}
                aria-label={t('lsScore.type.add')}
                data-testid="scoring-type-add"
              >
                <option value="">{t('lsScore.type.add')}</option>
                {addable.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
          </div>
        </>
      )}

      <p className="text-[11px] text-white/40">{t('lsScore.type.rule')}</p>
      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      {notice && <p className="text-xs text-emerald-300" role="status">{notice}</p>}
      {canEdit && (
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
          data-testid="scoring-type-save"
        >
          {saving ? t('lsScore.type.saving') : t('lsScore.type.save')}
        </button>
      )}
    </section>
  )
}
