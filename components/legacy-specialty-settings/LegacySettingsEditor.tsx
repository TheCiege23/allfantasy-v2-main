'use client'

/**
 * Editor for the Commissioner Settings legacy Devy / C2C tabs. Each tab lists its fields; a
 * commissioner edits them and saves once (PATCH /api/devy or PATCH /api/c2c/settings, which hold
 * the allowlist and the live-state locks). Everyone else sees the same values as plain text.
 *
 * Ranges and options are read from lib/legacy-specialty-settings/legacySettingsSpec.ts, the same
 * module the routes validate with.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export type LegacyFieldDef = {
  key: string
  labelKey: string
  kind: 'int' | 'bool' | 'enum' | 'datetime' | 'percent'
  /** int: the value; percent: whole percent (30 = 0.3). */
  min?: number
  max?: number
  options?: Array<{ value: string; labelKey: string; descKey?: string }>
  helpKey?: string
  helpVars?: (draft: Record<string, unknown>) => Record<string, string | number>
  /** Saved and shown (Chimmy, rules), but no automatic rule checks it. */
  recordedOnly?: boolean
  showWhen?: (draft: Record<string, unknown>) => boolean
  /** Value used when the record has none. */
  fallback?: unknown
}

export type LegacySectionDef = { titleKey?: string; noteKey?: string; fields: LegacyFieldDef[] }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO / Date → `datetime-local` input value in the viewer's time zone ('' when none). */
export function toLocalInput(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromConfig(f: LegacyFieldDef, config: Record<string, unknown> | null): unknown {
  const v = config?.[f.key]
  const base = v === undefined || v === null ? f.fallback : v
  if (f.kind === 'datetime') return toLocalInput(v)
  if (f.kind === 'percent') return typeof base === 'number' ? String(Math.round(base * 100)) : ''
  if (f.kind === 'int') return typeof base === 'number' ? String(base) : ''
  if (f.kind === 'bool') return typeof base === 'boolean' ? base : false
  return typeof base === 'string' ? base : ''
}

/** Draft value → what the route expects. */
function toWire(f: LegacyFieldDef, v: unknown): unknown {
  if (f.kind === 'datetime') return v ? new Date(String(v)).toISOString() : null
  if (f.kind === 'percent') return Number(v) / 100
  if (f.kind === 'int') return Number(v)
  return v
}

export function LegacySettingsEditor({
  testId,
  leagueId,
  canEdit,
  config,
  saveUrl,
  responseKey,
  sections,
  intro,
  footer,
  onSaved,
}: {
  testId: string
  leagueId?: string
  canEdit: boolean
  config: Record<string, unknown> | null
  saveUrl: '/api/devy' | '/api/c2c/settings'
  /** Where the updated record sits in the PATCH response. */
  responseKey: 'config' | 'c2c'
  sections: LegacySectionDef[]
  intro?: ReactNode
  footer?: ReactNode
  onSaved?: (record: Record<string, unknown>) => void
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections])
  const initial = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const f of fields) out[f.key] = fromConfig(f, config)
    return out
  }, [fields, config])

  const [draft, setDraft] = useState<Record<string, unknown>>(initial)
  /** What the server holds: the record we were given, or the last values it accepted. */
  const [baseline, setBaseline] = useState<Record<string, unknown>>(initial)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(initial)
    setBaseline(initial)
  }, [initial])

  if (!config) {
    return (
      <p className="px-6 py-8 text-[13px] text-white/45" data-testid={testId}>
        {t('legacySettings.loading')}
      </p>
    )
  }

  const label = (key: string) => {
    const f = fields.find((x) => x.key === key)
    return f ? t(f.labelKey) : t(`legacySettings.field.${key}`)
  }

  const visible = (f: LegacyFieldDef) => !f.showWhen || f.showWhen(draft)
  const changedKeys = fields.filter((f) => visible(f) && draft[f.key] !== baseline[f.key]).map((f) => f.key)
  const dirty = changedKeys.length > 0

  const describeError = (status: number, j: Record<string, unknown>): string => {
    const code = j.code
    if (code === 'SLOT_BELOW_HELD' && Array.isArray(j.conflicts)) {
      return (j.conflicts as Array<{ field: string; held: number }>)
        .map((c) => tInterpolate('legacySettings.error.slotBelowHeld', { field: label(c.field), held: c.held }))
        .join(' ')
    }
    if (code === 'DRAFT_STARTED') return t('legacySettings.error.draftStarted')
    if (code === 'DRAFT_IN_PROGRESS') return t('legacySettings.error.draftInProgress')
    if (code === 'FIELD_LOCKED') return t('legacySettings.error.locked')
    if (code === 'INVALID_FIELDS' && Array.isArray(j.invalid)) {
      const names = (j.invalid as Array<{ field: string }>).map((i) => label(i.field)).join(', ')
      return tInterpolate('legacySettings.error.invalid', { fields: names })
    }
    if (status === 401 || status === 403) return t('legacySettings.error.forbidden')
    return t('legacySettings.error.generic')
  }

  const save = async () => {
    if (!leagueId || !canEdit || !dirty) return
    // Range check before sending, with the same bounds the route enforces.
    for (const key of changedKeys) {
      const f = fields.find((x) => x.key === key)!
      if (f.kind === 'int' || f.kind === 'percent') {
        const n = Number(draft[key])
        if (draft[key] === '' || !Number.isInteger(n) || n < (f.min ?? -Infinity) || n > (f.max ?? Infinity)) {
          setState('error')
          setError(tInterpolate('legacySettings.error.range', { field: t(f.labelKey), min: f.min ?? 0, max: f.max ?? 0 }))
          return
        }
      }
    }
    const body: Record<string, unknown> = { leagueId }
    for (const key of changedKeys) body[key] = toWire(fields.find((x) => x.key === key)!, draft[key])
    setState('saving')
    setError(null)
    try {
      const res = await fetch(saveUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setState('error')
        setError(describeError(res.status, j))
        return
      }
      setBaseline(draft)
      setState('saved')
      const record = j[responseKey]
      if (record && typeof record === 'object') onSaved?.(record as Record<string, unknown>)
    } catch {
      setState('error')
      setError(t('legacySettings.error.generic'))
    }
  }

  const set = (key: string, v: unknown) => {
    setDraft((d) => ({ ...d, [key]: v }))
    if (state !== 'saving') setState('idle')
  }

  const readValue = (f: LegacyFieldDef): string => {
    const v = draft[f.key]
    if (f.kind === 'bool') return v ? t('legacySettings.on') : t('legacySettings.off')
    if (f.kind === 'enum') {
      const o = f.options?.find((x) => x.value === v)
      return o ? t(o.labelKey) : String(v || '—')
    }
    if (f.kind === 'datetime') return v ? String(v).replace('T', ' ') : t('legacySettings.notSet')
    if (f.kind === 'percent') return v === '' ? '—' : `${v}%`
    return v === '' ? '—' : String(v)
  }

  const inputCls = 'rounded-lg border border-white/[0.1] bg-black/30 px-2 py-1 text-[13px] text-white'

  const control = (f: LegacyFieldDef) => {
    const id = `${testId}-${f.key}`
    if (f.kind === 'bool') {
      return (
        <input
          id={id}
          type="checkbox"
          className="accent-violet-500"
          checked={Boolean(draft[f.key])}
          disabled={state === 'saving'}
          onChange={(e) => set(f.key, e.target.checked)}
          data-testid={id}
        />
      )
    }
    if (f.kind === 'enum') {
      return (
        <select
          id={id}
          className={inputCls}
          value={String(draft[f.key] ?? '')}
          disabled={state === 'saving'}
          onChange={(e) => set(f.key, e.target.value)}
          data-testid={id}
        >
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      )
    }
    if (f.kind === 'datetime') {
      return (
        <span className="flex items-center gap-2">
          <input
            id={id}
            type="datetime-local"
            className={inputCls}
            value={String(draft[f.key] ?? '')}
            disabled={state === 'saving'}
            onChange={(e) => set(f.key, e.target.value)}
            data-testid={id}
          />
          {draft[f.key] ? (
            <button
              type="button"
              className="text-[11px] text-white/55 underline"
              onClick={() => set(f.key, '')}
              disabled={state === 'saving'}
            >
              {t('legacySettings.clear')}
            </button>
          ) : null}
        </span>
      )
    }
    return (
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={`${inputCls} w-20 text-right`}
        min={f.min}
        max={f.max}
        step={1}
        value={String(draft[f.key] ?? '')}
        disabled={state === 'saving'}
        onChange={(e) => set(f.key, e.target.value)}
        data-testid={id}
      />
    )
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 md:px-6" data-testid={testId}>
      {intro}
      {sections.map((s, i) => (
        <section key={s.titleKey ?? i} className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
          {s.titleKey ? (
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/90">{t(s.titleKey)}</h3>
          ) : null}
          {s.noteKey ? <p className="mt-1 text-[11px] text-amber-200/75">{t(s.noteKey)}</p> : null}
          <div className="mt-2 divide-y divide-white/[0.06]">
            {s.fields.filter(visible).map((f) => {
              const help = f.helpKey ? (f.helpVars ? tInterpolate(f.helpKey, f.helpVars(draft)) : t(f.helpKey)) : null
              const desc = f.kind === 'enum' ? f.options?.find((o) => o.value === draft[f.key])?.descKey : undefined
              return (
                <div key={f.key} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={canEdit ? `${testId}-${f.key}` : undefined} className="text-white/75">
                      {t(f.labelKey)}
                    </label>
                    {canEdit ? (
                      control(f)
                    ) : (
                      <span className="font-mono text-[13px] font-semibold text-cyan-200/90" data-testid={`${testId}-${f.key}-value`}>
                        {readValue(f)}
                      </span>
                    )}
                  </div>
                  {desc ? <p className="mt-1 text-[11px] text-white/50">{t(desc)}</p> : null}
                  {help ? <p className="mt-1 text-[11px] text-white/45">{help}</p> : null}
                  {f.recordedOnly ? <p className="mt-1 text-[11px] text-white/35">{t('legacySettings.recordedOnly')}</p> : null}
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {footer}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || state === 'saving'}
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-[12px] font-semibold text-cyan-100 disabled:opacity-40"
            data-testid={`${testId}-save`}
          >
            {state === 'saving' ? t('legacySettings.saving') : t('legacySettings.save')}
          </button>
          {state === 'saved' && !dirty ? (
            <span className="text-[12px] text-emerald-300/90" role="status" data-testid={`${testId}-saved`}>
              {t('legacySettings.saved')}
            </span>
          ) : null}
          {state === 'error' && error ? (
            <span className="text-[12px] text-rose-300/90" role="alert" data-testid={`${testId}-error`}>
              {error}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-white/45">{t('legacySettings.readOnlyMember')}</p>
      )}
    </div>
  )
}
