'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import { reviewedPoll, weeklyTaskSuggestions, type ReviewedLeagueDraft } from '@/lib/core-app/commissionerWeeklyPlan'
import { COMMS_OPEN_EVENT } from './comms/commsEvents'
import './commissioner-weekly-plan.css'

type PlanProps = { leagueId: string; data?: WeeklyBlueprint; announcement?: string }
export default function CommissionerWeeklyPlan(props: PlanProps) { return <CommissionerWeeklyEditor key={props.leagueId} {...props} /> }
function CommissionerWeeklyEditor({ leagueId, data, announcement = '' }: PlanProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es', t = (en: string, sp: string) => es ? sp : en
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [dueAt, setDueAt] = useState('')
  const [text, setText] = useState(announcement), [question, setQuestion] = useState(''), [options, setOptions] = useState(''), [closeAt, setCloseAt] = useState('')
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const request = useRef<{ id: string; body: string } | null>(null)
  const scope = useRef(leagueId); scope.current = leagueId
  const generatedAnnouncement = useRef(announcement)
  useEffect(() => { const previous = generatedAnnouncement.current; generatedAnnouncement.current = announcement; setText(current => current === previous ? announcement : current) }, [announcement])
  const suggestions = data ? weeklyTaskSuggestions(data, leagueId, es) : []
  async function saveTask() {
    if (!title.trim() || busy) return
    setBusy(true); setStatus('')
    const capturedLeague = leagueId
    try {
      // Keep the same id for a retry after an unknown response, preventing duplicate tasks.
      const body = JSON.stringify({ title, description, dueAt: dueAt ? new Date(dueAt).toISOString() : null })
      if (request.current?.body !== body) request.current = { id: crypto.randomUUID(), body }
      const response = await fetch(`/api/core/commissioner-queue?league=${encodeURIComponent(capturedLeague)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(body), requestId: request.current.id }) })
      if (!response.ok) throw new Error()
      if (scope.current !== capturedLeague) return
      setStatus(t('Task saved in the Commissioner Hub.', 'Tarea guardada en el Centro del comisionado.'))
      window.dispatchEvent(new CustomEvent('af-commissioner-queue-refresh', { detail: { leagueId: capturedLeague } }))
    } catch { if (scope.current === capturedLeague) setStatus(t('Task could not be confirmed. Retry the same task or refresh the queue.', 'No se pudo confirmar la tarea. Reintenta la misma tarea o actualiza la cola.')) }
    finally { setBusy(false) }
  }
  async function copyAnnouncement() { try { await navigator.clipboard.writeText(text); setStatus(t('Copied.', 'Copiado.')) } catch { setStatus(t('Select the announcement text and copy it.', 'Selecciona el texto del anuncio y cópialo.')) } }
  function openDraft(poll = false) {
    const value = poll ? reviewedPoll(question, options.split('\n'), closeAt) : undefined
    if (poll && !value) { setStatus(t('Add a question, 2–6 distinct options and a future closing time.', 'Añade una pregunta, 2–6 opciones distintas y una hora de cierre futura.')); return }
    if (!poll && !text.trim()) return
    const draft: ReviewedLeagueDraft = { id: crypto.randomUUID(), leagueId, text: poll ? '' : text, ...(value ? { poll: value } : {}) }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'league', leagueId, leagueDraft: draft } }))
    setStatus(t('Draft opened in league chat. Review it and press Send when ready.', 'Borrador abierto en el chat de liga. Revísalo y pulsa Enviar cuando esté listo.'))
  }
  return <section className="af-weekly-comm" aria-label={t('Commissioner weekly workspace', 'Espacio semanal del comisionado')}>
    <h2>{t('Turn this week into league action', 'Convierte esta semana en acciones de liga')}</h2>
    <p>{t('Review the evidence, save a task, or prepare an editable league message. Tasks are audited. Drafts open unsent.', 'Revisa los datos, guarda una tarea o prepara un mensaje editable para la liga. Las tareas se registran. Los borradores se abren sin enviar.')}</p>
    <details><summary>{t('Save a reviewed weekly task', 'Guardar una tarea semanal revisada')}</summary>
      {suggestions.length > 0 && <label>{t('Start from a weekly issue', 'Empezar con un asunto semanal')}<select disabled={busy} defaultValue="" onChange={e => { const s = suggestions.find(s => s.id === e.target.value); if (s) { setTitle(s.title); setDescription(s.description) } }}><option value="">{t('Choose an issue or write your own', 'Elige un asunto o escribe el tuyo')}</option>{suggestions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <label>{t('Task title', 'Título de tarea')}<input disabled={busy} value={title} maxLength={180} onChange={e => setTitle(e.target.value)} /></label>
      <label>{t('Reviewed details', 'Detalles revisados')}<textarea disabled={busy} value={description} maxLength={4000} rows={4} onChange={e => setDescription(e.target.value)} /></label>
      <label>{t('Due time (your device time zone, optional)', 'Plazo (zona horaria del dispositivo, opcional)')}<input disabled={busy} type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} /></label>
      <button className="af-btn" type="button" disabled={busy || !title.trim()} onClick={saveTask}>{busy ? t('Saving…', 'Guardando…') : t('Save task', 'Guardar tarea')}</button>
    </details>
    <details><summary>{t('Prepare an announcement', 'Preparar un anuncio')}</summary><label>{t('Announcement draft', 'Borrador del anuncio')}<textarea value={text} rows={6} maxLength={4000} onChange={e => setText(e.target.value)} /></label><button className="af-btn" type="button" disabled={!text.trim()} onClick={copyAnnouncement}>{t('Copy announcement', 'Copiar anuncio')}</button><button className="af-btn" type="button" disabled={!text.trim()} onClick={() => openDraft()}>{t('Review in league chat', 'Revisar en chat de liga')}</button></details>
    <details><summary>{t('Prepare a league poll', 'Preparar una encuesta de liga')}</summary>
      <label>{t('Poll question', 'Pregunta de encuesta')}<input value={question} maxLength={240} onChange={e => setQuestion(e.target.value)} /></label>
      <label>{t('Options (one per line, 2–6)', 'Opciones (una por línea, 2–6)')}<textarea value={options} rows={4} maxLength={606} onChange={e => setOptions(e.target.value)} /></label>
      <label>{t('Close voting (your device time zone)', 'Cerrar votación (zona horaria del dispositivo)')}<input type="datetime-local" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></label>
      <button className="af-btn" type="button" onClick={() => openDraft(true)}>{t('Review poll in league chat', 'Revisar encuesta en chat de liga')}</button>
    </details>
    <Link href={`/core/commissioner?league=${encodeURIComponent(leagueId)}`}>{t('Commissioner Hub and task queue', 'Centro del comisionado y cola de tareas')} →</Link>
    <p role="status">{status}</p>
  </section>
}
