'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  DETAILS_MAX,
  DISPUTE_CATEGORIES,
  RULING_MAX,
  SUBJECT_MAX,
  type DisputeCategory,
  type LeagueDispute,
  type RulingOutcome,
} from '@/lib/disputes/disputeStore'

/**
 * The dispute desk (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.2). One component for both sides:
 * a member files and can withdraw their own; a commissioner sees every open dispute and rules on it,
 * optionally posting the ruling to league chat. The route enforces every rule shown here — this
 * component cannot rule for a member who forges the request.
 */

type Copy = (en: string, es: string) => string

const CATEGORY_LABEL: Record<DisputeCategory, [string, string]> = {
  stat_correction: ['Stat correction', 'Corrección de estadísticas'],
  lineup: ['Lineup', 'Alineación'],
  trade: ['Trade', 'Intercambio'],
  waiver: ['Waiver', 'Waiver'],
  rules: ['League rules', 'Reglas de la liga'],
  other: ['Other', 'Otro'],
}

const OUTCOME_LABEL: Record<RulingOutcome, [string, string]> = {
  upheld: ['Upheld', 'Aceptada'],
  denied: ['Denied', 'Rechazada'],
  partial: ['Partly upheld', 'Aceptada en parte'],
}

const ERROR_COPY: Record<string, [string, string]> = {
  subject_required: ['Add a short subject.', 'Agrega un asunto breve.'],
  too_many_open: ['You already have 5 open disputes. Wait for a ruling first.', 'Ya tienes 5 disputas abiertas. Espera una decisión primero.'],
  ruling_required: ['Write one sentence explaining the ruling.', 'Escribe una frase que explique la decisión.'],
  not_open: ['This dispute is already closed.', 'Esta disputa ya está cerrada.'],
}

export type DisputeDeskProps = { leagueId: string }

export function DisputeDesk({ leagueId }: DisputeDeskProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t: Copy = (en, spanish) => (es ? spanish : en)
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/disputes`

  const [disputes, setDisputes] = useState<LeagueDispute[] | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as
        | { disputes?: LeagueDispute[]; isCommissioner?: boolean; viewerUserId?: string; error?: string }
        | null
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setDisputes(body?.disputes ?? [])
      setIsCommissioner(body?.isCommissioner === true)
      setViewerUserId(body?.viewerUserId ?? null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [endpoint])

  useEffect(() => {
    void load()
  }, [load])

  async function send(method: 'POST' | 'PATCH', payload: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        const known = body?.error ? ERROR_COPY[body.error] : undefined
        setMessage(known ? t(known[0], known[1]) : body?.error ?? t(`Could not save (${res.status}).`, `No se pudo guardar (${res.status}).`))
        return false
      }
      setMessage(done)
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  const open = (disputes ?? []).filter((d) => d.status === 'open')
  const closed = (disputes ?? []).filter((d) => d.status !== 'open')

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/90" data-testid="dispute-desk">
      <h2 className="text-base font-semibold">{t('Dispute desk', 'Mesa de disputas')}</h2>
      <p className="mt-1 text-white/60">
        {isCommissioner
          ? t(
              'Managers file disputes here. Rule on each one with a short reason; you can post the ruling to league chat so everyone sees the same answer.',
              'Los mánagers presentan disputas aquí. Resuelve cada una con una razón breve; puedes publicar la decisión en el chat de la liga para que todos vean la misma respuesta.',
            )
          : t(
              'Disagree with a stat, a trade or a rule? File it here and your commissioner will rule on it. Only you and the commissioners see your dispute unless the ruling is posted to chat.',
              '¿No estás de acuerdo con una estadística, un intercambio o una regla? Preséntalo aquí y tu comisionado decidirá. Solo tú y los comisionados ven tu disputa, salvo que la decisión se publique en el chat.',
            )}
      </p>

      <FileForm t={t} busy={busy} onSubmit={(p) => send('POST', p, t('Dispute filed. Your commissioner has been notified.', 'Disputa presentada. Se avisó a tu comisionado.'))} />

      {message && (
        <p role="status" className="mt-3 text-white/80">
          {message}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-3 text-red-300">
          {t('Could not load disputes: ', 'No se pudieron cargar las disputas: ')}
          {loadError}
        </p>
      )}
      {disputes === null && !loadError && <p className="mt-3 text-white/50">{t('Loading…', 'Cargando…')}</p>}

      {disputes !== null && (
        <>
          <h3 className="mt-5 font-semibold">
            {t('Open', 'Abiertas')} ({open.length})
          </h3>
          {open.length === 0 && <p className="mt-1 text-white/50">{t('Nothing waiting on a ruling.', 'Nada espera una decisión.')}</p>}
          <ul className="mt-2 space-y-3">
            {open.map((d) => (
              <li key={d.id} className="rounded-xl border border-white/10 p-3">
                <DisputeSummary d={d} t={t} />
                {isCommissioner && (
                  <RuleForm
                    t={t}
                    busy={busy}
                    onSubmit={(p) => send('PATCH', { id: d.id, action: 'rule', ...p }, t('Ruling saved.', 'Decisión guardada.'))}
                  />
                )}
                {d.filedByUserId === viewerUserId && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-white/60 underline"
                    disabled={busy}
                    onClick={() => void send('PATCH', { id: d.id, action: 'withdraw' }, t('Dispute withdrawn.', 'Disputa retirada.'))}
                  >
                    {t('Withdraw', 'Retirar')}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {closed.length > 0 && (
            <>
              <h3 className="mt-5 font-semibold">{t('Closed', 'Cerradas')}</h3>
              <ul className="mt-2 space-y-3">
                {closed.map((d) => (
                  <li key={d.id} className="rounded-xl border border-white/5 p-3 opacity-90">
                    <DisputeSummary d={d} t={t} />
                    {d.status === 'withdrawn' && <p className="mt-1 text-white/50">{t('Withdrawn by the filer.', 'Retirada por quien la presentó.')}</p>}
                    {d.ruling && (
                      <p className="mt-2">
                        <span className="font-semibold">{t(...OUTCOME_LABEL[d.ruling.outcome])}:</span> {d.ruling.text}
                        <span className="block text-xs text-white/50">
                          {d.ruling.ruledByName ?? t('Commissioner', 'Comisionado')} · {new Date(d.ruling.ruledAt).toLocaleDateString()}
                          {d.ruling.postedToChat ? t(' · posted to chat', ' · publicada en el chat') : ''}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

function DisputeSummary({ d, t }: { d: LeagueDispute; t: Copy }) {
  return (
    <div>
      <p className="font-medium">{d.subject}</p>
      <p className="text-xs text-white/50">
        {t(...CATEGORY_LABEL[d.category])} · {d.filedByName ?? t('A manager', 'Un mánager')} · {new Date(d.createdAt).toLocaleDateString()}
      </p>
      {d.details && <p className="mt-1 whitespace-pre-wrap text-white/80">{d.details}</p>}
    </div>
  )
}

function FileForm({ t, busy, onSubmit }: { t: Copy; busy: boolean; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [openForm, setOpenForm] = useState(false)
  const [category, setCategory] = useState<DisputeCategory>('stat_correction')
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')

  if (!openForm) {
    return (
      <button type="button" className="af-btn mt-3" onClick={() => setOpenForm(true)}>
        {t('File a dispute', 'Presentar una disputa')}
      </button>
    )
  }
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSubmit({ category, subject, details })) {
          setSubject('')
          setDetails('')
          setOpenForm(false)
        }
      }}
    >
      <label className="block">
        <span className="text-xs text-white/60">{t('What is it about?', '¿De qué se trata?')}</span>
        <select className="mt-1 w-full rounded-lg bg-black/30 p-2" value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory)}>
          {DISPUTE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(...CATEGORY_LABEL[c])}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-white/60">{t('Subject', 'Asunto')}</span>
        <input className="mt-1 w-full rounded-lg bg-black/30 p-2" maxLength={SUBJECT_MAX} required value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-xs text-white/60">{t('Details (what happened, which week, which players)', 'Detalles (qué pasó, qué semana, qué jugadores)')}</span>
        <textarea className="mt-1 w-full rounded-lg bg-black/30 p-2" rows={4} maxLength={DETAILS_MAX} value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="af-btn" disabled={busy || !subject.trim()}>
          {t('Submit', 'Enviar')}
        </button>
        <button type="button" className="af-btn" onClick={() => setOpenForm(false)}>
          {t('Cancel', 'Cancelar')}
        </button>
      </div>
    </form>
  )
}

function RuleForm({ t, busy, onSubmit }: { t: Copy; busy: boolean; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [outcome, setOutcome] = useState<RulingOutcome>('upheld')
  const [text, setText] = useState('')
  const [postToChat, setPostToChat] = useState(true)
  return (
    <form
      className="mt-3 space-y-2 border-t border-white/10 pt-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSubmit({ outcome, text, postToChat })) setText('')
      }}
    >
      <div className="flex flex-wrap gap-3">
        {(Object.keys(OUTCOME_LABEL) as RulingOutcome[]).map((o) => (
          <label key={o} className="flex items-center gap-1">
            <input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} />
            {t(...OUTCOME_LABEL[o])}
          </label>
        ))}
      </div>
      <textarea
        className="w-full rounded-lg bg-black/30 p-2"
        rows={3}
        maxLength={RULING_MAX}
        placeholder={t('Your ruling and the reason for it', 'Tu decisión y la razón')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={postToChat} onChange={(e) => setPostToChat(e.target.checked)} />
        {t('Post the ruling to league chat', 'Publicar la decisión en el chat de la liga')}
      </label>
      <button type="submit" className="af-btn" disabled={busy || !text.trim()}>
        {t('Save ruling', 'Guardar decisión')}
      </button>
    </form>
  )
}
