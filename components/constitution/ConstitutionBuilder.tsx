'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  AMENDABLE,
  AMENDMENT_TEXT_MAX,
  AMENDMENT_TITLE_MAX,
  DEFAULT_ANSWERS,
  HOUSE_RULES_MAX,
  SECTION_BODY_MAX,
  SECTION_TITLE_MAX,
  describeChange,
  type Amendment,
  type ConstitutionAnswers,
  type ConstitutionSection,
} from '@/lib/constitution/constitutionBuilder'
import type { ConstitutionView } from '@/lib/constitution/constitutionService'

/**
 * League constitution — read view for every member, builder and amendments for the commissioner.
 * The route enforces every rule shown here; this component only reflects what it was told.
 */

type Copy = (en: string, es: string) => string

const BLANK: ConstitutionSection[] = [
  { id: 'league', title: 'Article 1 — The league', body: '' },
  { id: 'rosters', title: 'Article 2 — Rosters and scoring', body: '' },
  { id: 'waivers', title: 'Article 3 — Waivers and free agents', body: '' },
  { id: 'trades', title: 'Article 4 — Trades', body: '' },
  { id: 'playoffs', title: 'Article 5 — Playoffs', body: '' },
  { id: 'conduct', title: 'Article 6 — Conduct', body: '' },
  { id: 'amendments', title: 'Article 7 — Changing these rules', body: '' },
]

const STATUS_LABEL: Record<Amendment['status'], [string, string]> = {
  voting: ['Voting', 'En votación'],
  passed: ['Passed', 'Aprobada'],
  failed: ['Failed', 'Rechazada'],
  applied: ['Passed and applied', 'Aprobada y aplicada'],
  apply_failed: ['Passed — could not apply', 'Aprobada — no se pudo aplicar'],
  withdrawn: ['Withdrawn', 'Retirada'],
}

export function ConstitutionBuilder({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t: Copy = (en, spanish) => (es ? spanish : en)
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/constitution`

  const [view, setView] = useState<ConstitutionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ sections: ConstitutionSection[]; source: 'builder' | 'manual' } | null>(null)
  const [answers, setAnswers] = useState<ConstitutionAnswers>(DEFAULT_ANSWERS)

  const load = useCallback(async () => {
    const res = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok) return setError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
    setView(body as ConstitutionView)
    setAnswers((body as ConstitutionView).answers)
  }, [endpoint])

  useEffect(() => {
    void load()
  }, [load])

  async function post(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) })
      const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>
      if (!res.ok) {
        setMessage(
          body.error === 'not_entitled'
            ? t('Building from your settings is part of the AF Commissioner plan. You can still write it by hand.', 'Crear desde tu configuración es parte del plan AF Commissioner. Igual puedes escribirla a mano.')
            : typeof body.reason === 'string'
              ? body.reason
              : String(body.error ?? `HTTP ${res.status}`),
        )
        return null
      }
      return body
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p role="alert" className="text-red-300">{t('Could not load the constitution: ', 'No se pudo cargar la constitución: ')}{error}</p>
  if (!view) return <p className="text-white/50">{t('Loading…', 'Cargando…')}</p>

  const chatHref = `/league/${encodeURIComponent(leagueId)}?view=league_chat`

  return (
    <div className="space-y-6 text-sm text-white/90" data-testid="constitution">
      {message && <p role="status" className="rounded-lg border border-white/10 bg-white/5 p-3">{message}</p>}

      {/* ── The constitution itself ── */}
      {editing ? (
        <Editor
          t={t}
          busy={busy}
          sections={editing.sections}
          onCancel={() => setEditing(null)}
          onPublish={async (sections) => {
            const r = await post({ action: 'publish', sections, answers, source: editing.source })
            if (r) {
              setEditing(null)
              setMessage(t(`Version ${r.version} published.`, `Versión ${r.version} publicada.`))
              await load()
            }
          }}
        />
      ) : view.current ? (
        <article className="space-y-4">
          <p className="text-xs text-white/50">
            {t(`Version ${view.current.version}`, `Versión ${view.current.version}`)} · {new Date(view.current.publishedAt).toLocaleDateString(es ? 'es' : 'en')}
          </p>
          {view.current.sections.map((s) => (
            <section key={s.id}>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1 whitespace-pre-line text-white/80">{s.body}</p>
            </section>
          ))}
        </article>
      ) : (
        <p className="text-white/60">{t('This league has no constitution yet.', 'Esta liga todavía no tiene constitución.')}</p>
      )}

      {/* ── Commissioner: build or edit ── */}
      {view.isCommissioner && !editing && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-base font-semibold">{t('Write the constitution', 'Escribir la constitución')}</h2>
          <p className="mt-1 text-white/60">
            {t(
              'AllFantasy writes it from your league’s real settings — rosters, scoring, waivers, trades, playoffs, keepers and dues — plus the answers below. You can edit every article before publishing.',
              'AllFantasy la escribe con la configuración real de tu liga —plantillas, puntuación, agentes libres, intercambios, playoffs, keepers y cuotas— y las respuestas de abajo. Puedes editar cada artículo antes de publicar.',
            )}
          </p>
          <Questions t={t} answers={answers} onChange={setAnswers} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="af-btn"
              disabled={busy}
              onClick={async () => {
                const r = await post({ action: 'draft', answers })
                if (r?.sections) setEditing({ sections: r.sections as ConstitutionSection[], source: 'builder' })
              }}
            >
              {t('Build from my settings', 'Crear desde mi configuración')}
              {!view.entitled ? t(' · AF Commissioner', ' · AF Commissioner') : ''}
            </button>
            <button
              type="button"
              className="af-btn"
              disabled={busy}
              onClick={() => setEditing({ sections: view.current?.sections ?? BLANK, source: 'manual' })}
            >
              {view.current ? t('Edit by hand', 'Editar a mano') : t('Write by hand', 'Escribir a mano')}
            </button>
          </div>
        </section>
      )}

      {/* ── Amendments ── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="text-base font-semibold">{t('Amendments', 'Enmiendas')}</h2>
        <p className="mt-1 text-white/60">
          {t(
            `The league votes on each amendment in league chat. It passes with ${view.answers.amendmentThreshold}% of the votes cast.`,
            `La liga vota cada enmienda en el chat. Se aprueba con el ${view.answers.amendmentThreshold}% de los votos emitidos.`,
          )}{' '}
          <Link href={chatHref} className="underline">{t('Go to league chat →', 'Ir al chat de la liga →')}</Link>
        </p>
        {view.amendments.length === 0 && <p className="mt-2 text-white/50">{t('No amendments yet.', 'Todavía no hay enmiendas.')}</p>}
        <ul className="mt-3 space-y-3">
          {view.amendments.map((a) => (
            <li key={a.id} className="rounded-xl border border-white/10 p-3">
              <p className="font-medium">{a.title}</p>
              {a.change && <p className="text-xs text-white/60">{describeChange(a.change)} · {a.effective === 'now' ? t('takes effect now', 'aplica ahora') : t('takes effect next season', 'aplica la próxima temporada')}</p>}
              {a.text && <p className="mt-1 whitespace-pre-line text-white/80">{a.text}</p>}
              <p className="mt-1 text-xs text-white/50">
                {t(...STATUS_LABEL[a.status])}
                {a.yes != null ? ` · ${a.yes} ${t('yes', 'sí')} / ${a.no} ${t('no', 'no')}` : ''}
                {a.status === 'voting' ? ` · ${t('closes', 'cierra')} ${new Date(a.closesAt).toLocaleString(es ? 'es' : 'en')}` : ''}
                {a.applyError ? ` · ${a.applyError}` : ''}
              </p>
              {view.isCommissioner && (a.status === 'passed' || a.status === 'apply_failed') && a.change && (
                <button type="button" className="af-btn mt-2" disabled={busy} onClick={async () => { if (await post({ action: 'apply', id: a.id })) { setMessage(t('Applied.', 'Aplicada.')); await load() } }}>
                  {t('Apply now', 'Aplicar ahora')}
                </button>
              )}
              {view.isCommissioner && a.status === 'voting' && (
                <button type="button" className="mt-2 text-xs text-white/60 underline" disabled={busy} onClick={async () => { if (await post({ action: 'withdraw', id: a.id })) await load() }}>
                  {t('Withdraw', 'Retirar')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {view.isCommissioner && (
          <ProposeForm
            t={t}
            busy={busy}
            onSubmit={async (p) => {
              const r = await post({ action: 'propose', ...p })
              if (r) {
                setMessage(t('Amendment proposed. The vote is open in league chat.', 'Enmienda propuesta. La votación está abierta en el chat.'))
                await load()
              }
              return Boolean(r)
            }}
          />
        )}
      </section>

      {view.history.length > 1 && (
        <section>
          <h2 className="text-base font-semibold">{t('Version history', 'Historial de versiones')}</h2>
          <ul className="mt-2 space-y-1 text-white/60">
            {view.history.map((h) => (
              <li key={h.id}>
                {t(`Version ${h.version}`, `Versión ${h.version}`)} · {new Date(h.publishedAt).toLocaleDateString(es ? 'es' : 'en')} · {h.source === 'builder' ? t('built from settings', 'creada desde la configuración') : t('written by hand', 'escrita a mano')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Questions({ t, answers, onChange }: { t: Copy; answers: ConstitutionAnswers; onChange: (a: ConstitutionAnswers) => void }) {
  const set = <K extends keyof ConstitutionAnswers>(k: K, v: ConstitutionAnswers[K]) => onChange({ ...answers, [k]: v })
  const select = 'mt-1 w-full rounded-lg bg-black/30 p-2'
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label>
        <span className="text-xs text-white/60">{t('Votes needed to pass an amendment', 'Votos para aprobar una enmienda')}</span>
        <select className={select} value={answers.amendmentThreshold} onChange={(e) => set('amendmentThreshold', Number(e.target.value) as ConstitutionAnswers['amendmentThreshold'])}>
          <option value={50}>{t('Simple majority', 'Mayoría simple')}</option>
          <option value={60}>60%</option>
          <option value={67}>{t('Two thirds', 'Dos tercios')}</option>
          <option value={75}>75%</option>
        </select>
      </label>
      <label>
        <span className="text-xs text-white/60">{t('How long a vote stays open', 'Cuánto dura una votación')}</span>
        <select className={select} value={answers.voteDays} onChange={(e) => set('voteDays', Number(e.target.value) as ConstitutionAnswers['voteDays'])}>
          {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{t(`${d} day${d === 1 ? '' : 's'}`, `${d} día${d === 1 ? '' : 's'}`)}</option>)}
        </select>
      </label>
      <label>
        <span className="text-xs text-white/60">{t('Replace a manager after this many weeks without a lineup', 'Reemplazar a un mánager tras estas semanas sin alineación')}</span>
        <select className={select} value={answers.inactivityWeeks} onChange={(e) => set('inactivityWeeks', Number(e.target.value) as ConstitutionAnswers['inactivityWeeks'])}>
          {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </label>
      <label>
        <span className="text-xs text-white/60">{t('Who decides on collusion', 'Quién decide sobre colusión')}</span>
        <select className={select} value={answers.collusion} onChange={(e) => set('collusion', e.target.value as ConstitutionAnswers['collusion'])}>
          <option value="commissioner_reverses">{t('The commissioner', 'El comisionado')}</option>
          <option value="league_vote">{t('A league vote', 'Una votación de la liga')}</option>
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className="text-xs text-white/60">{t('House rules (punishments, trophies, anything else)', 'Reglas de la casa (castigos, trofeos, lo que sea)')}</span>
        <textarea className={select} rows={3} maxLength={HOUSE_RULES_MAX} value={answers.houseRules} onChange={(e) => set('houseRules', e.target.value)} />
      </label>
    </div>
  )
}

function Editor({ t, busy, sections, onCancel, onPublish }: { t: Copy; busy: boolean; sections: ConstitutionSection[]; onCancel: () => void; onPublish: (s: ConstitutionSection[]) => void }) {
  const [rows, setRows] = useState(sections)
  const edit = (i: number, patch: Partial<ConstitutionSection>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-base font-semibold">{t('Review every article, then publish', 'Revisa cada artículo y publica')}</h2>
      {rows.map((r, i) => (
        <div key={`${r.id}-${i}`} className="space-y-1">
          <input className="w-full rounded-lg bg-black/30 p-2 font-semibold" maxLength={SECTION_TITLE_MAX} value={r.title} onChange={(e) => edit(i, { title: e.target.value })} />
          <textarea className="w-full rounded-lg bg-black/30 p-2" rows={4} maxLength={SECTION_BODY_MAX} value={r.body} onChange={(e) => edit(i, { body: e.target.value })} />
          <button type="button" className="text-xs text-white/50 underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t('Remove article', 'Quitar artículo')}</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="af-btn" onClick={() => setRows([...rows, { id: `s${rows.length + 1}`, title: t(`Article ${rows.length + 1}`, `Artículo ${rows.length + 1}`), body: '' }])}>{t('Add article', 'Agregar artículo')}</button>
        <button type="button" className="af-btn" disabled={busy || rows.length === 0} onClick={() => onPublish(rows)}>{t('Publish to the league', 'Publicar en la liga')}</button>
        <button type="button" className="af-btn" onClick={onCancel}>{t('Cancel', 'Cancelar')}</button>
      </div>
    </section>
  )
}

function ProposeForm({ t, busy, onSubmit }: { t: Copy; busy: boolean; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [effective, setEffective] = useState<'next_season' | 'now'>('next_season')
  if (!open) return <button type="button" className="af-btn mt-3" onClick={() => setOpen(true)}>{t('Propose an amendment', 'Proponer una enmienda')}</button>
  const spec = key ? AMENDABLE[key] : null
  const change = spec ? { key, value: spec.kind === 'bool' ? value === 'true' : Number(value) } : null
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSubmit({ title, text, change, effective })) {
          setOpen(false)
          setTitle('')
          setText('')
          setKey('')
          setValue('')
        }
      }}
    >
      <input className="w-full rounded-lg bg-black/30 p-2" required maxLength={AMENDMENT_TITLE_MAX} placeholder={t('What changes, in one line', 'Qué cambia, en una línea')} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="w-full rounded-lg bg-black/30 p-2" rows={3} maxLength={AMENDMENT_TEXT_MAX} placeholder={t('Why (optional)', 'Por qué (opcional)')} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <select className="rounded-lg bg-black/30 p-2" value={key} onChange={(e) => { setKey(e.target.value); setValue(AMENDABLE[e.target.value]?.kind === 'bool' ? 'true' : '') }}>
          <option value="">{t('Rule text only — no setting changes', 'Solo texto — no cambia la configuración')}</option>
          {Object.entries(AMENDABLE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        {spec?.kind === 'bool' ? (
          <select className="rounded-lg bg-black/30 p-2" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="true">{t('On', 'Activado')}</option>
            <option value="false">{t('Off', 'Desactivado')}</option>
          </select>
        ) : spec ? (
          <input className="w-24 rounded-lg bg-black/30 p-2" type="number" required min={spec.min} max={spec.max} value={value} onChange={(e) => setValue(e.target.value)} />
        ) : null}
        <select className="rounded-lg bg-black/30 p-2" value={effective} onChange={(e) => setEffective(e.target.value as 'next_season' | 'now')}>
          <option value="next_season">{t('Takes effect next season', 'Aplica la próxima temporada')}</option>
          <option value="now">{t('Takes effect when it passes', 'Aplica al aprobarse')}</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="af-btn" disabled={busy || !title.trim()}>{t('Open the vote', 'Abrir la votación')}</button>
        <button type="button" className="af-btn" onClick={() => setOpen(false)}>{t('Cancel', 'Cancelar')}</button>
      </div>
    </form>
  )
}
