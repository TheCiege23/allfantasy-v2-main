'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import { reviewedPoll, weeklyTaskSuggestions, type ReviewedLeagueDraft } from '@/lib/core-app/commissionerWeeklyPlan'
import { COMMS_OPEN_EVENT } from './comms/commsEvents'
import './commissioner-weekly-plan.css'
import WeeklyTaskFollowthrough from './WeeklyTaskFollowthrough'
import { coreTriageMessages } from '@/lib/core-app/messages/coreTriage'

type PlanProps = { leagueId: string; data?: WeeklyBlueprint; announcement?: string }
export default function CommissionerWeeklyPlan(props: PlanProps) { return <CommissionerWeeklyEditor key={props.leagueId} {...props} /> }
function CommissionerWeeklyEditor({ leagueId, data, announcement = '' }: PlanProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const m = useMessages(coreTriageMessages)
  const [issueId,setIssueId] = useState<string | null>(null)
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
      const body = JSON.stringify({ title, description, issueId, dueAt: dueAt ? new Date(dueAt).toISOString() : null })
      if (request.current?.body !== body) request.current = { id: crypto.randomUUID(), body }
      const response = await fetch(`/api/core/commissioner-queue?league=${encodeURIComponent(capturedLeague)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(body), requestId: request.current.id }) })
      if (!response.ok) throw new Error()
      if (scope.current !== capturedLeague) return
      setStatus(m.weeklyPlanTaskSaved)
      window.dispatchEvent(new CustomEvent('af-commissioner-queue-refresh', { detail: { leagueId: capturedLeague } }))
    } catch { if (scope.current === capturedLeague) setStatus(m.weeklyPlanTaskUnconfirmed) }
    finally { setBusy(false) }
  }
  async function copyAnnouncement() { try { await navigator.clipboard.writeText(text); setStatus(m.weeklyPlanCopied) } catch { setStatus(m.weeklyPlanCopyManually) } }
  function openDraft(poll = false) {
    const value = poll ? reviewedPoll(question, options.split('\n'), closeAt) : undefined
    if (poll && !value) { setStatus(m.weeklyPlanPollInvalid); return }
    if (!poll && !text.trim()) return
    const draft: ReviewedLeagueDraft = { id: crypto.randomUUID(), leagueId, text: poll ? '' : text, ...(value ? { poll: value } : {}) }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'league', leagueId, leagueDraft: draft } }))
    setStatus(m.weeklyPlanDraftOpened)
  }
  return <section className="af-weekly-comm" aria-label={m.weeklyPlanAria}>
    <h2>{m.weeklyPlanTitle}</h2>
    <p>{m.weeklyPlanIntro}</p>
    <details><summary>{m.weeklyPlanSaveSummary}</summary>
      {suggestions.length > 0 && <label>{m.weeklyPlanStartFromIssue}<select disabled={busy} defaultValue="" onChange={e => { const s = suggestions.find(s => s.id === e.target.value); setIssueId(s?.id ?? null); if (s) { setTitle(s.title); setDescription(s.description) } }}><option value="">{m.weeklyPlanChooseIssue}</option>{suggestions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <label>{m.weeklyPlanTaskTitle}<input disabled={busy} value={title} maxLength={180} onChange={e => setTitle(e.target.value)} /></label>
      <label>{m.weeklyPlanReviewedDetails}<textarea disabled={busy} value={description} maxLength={4000} rows={4} onChange={e => setDescription(e.target.value)} /></label>
      <label>{m.weeklyPlanDueTime}<input disabled={busy} type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} /></label>
      <button className="af-btn" type="button" disabled={busy || !title.trim()} onClick={saveTask}>{busy ? m.weeklyPlanSaving : m.weeklyPlanSaveTask}</button>
    </details>
    <details><summary>{m.weeklyPlanAnnouncementSummary}</summary><label>{m.weeklyPlanAnnouncementDraft}<textarea value={text} rows={6} maxLength={4000} onChange={e => setText(e.target.value)} /></label><button className="af-btn" type="button" disabled={!text.trim()} onClick={copyAnnouncement}>{m.weeklyPlanCopyAnnouncement}</button><button className="af-btn" type="button" disabled={!text.trim()} onClick={() => openDraft()}>{m.weeklyPlanReviewInChat}</button></details>
    <details><summary>{m.weeklyPlanPollSummary}</summary>
      <label>{m.weeklyPlanPollQuestion}<input value={question} maxLength={240} onChange={e => setQuestion(e.target.value)} /></label>
      <label>{m.weeklyPlanPollOptions}<textarea value={options} rows={4} maxLength={606} onChange={e => setOptions(e.target.value)} /></label>
      <label>{m.weeklyPlanPollClose}<input type="datetime-local" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></label>
      <button className="af-btn" type="button" onClick={() => openDraft(true)}>{m.weeklyPlanReviewPoll}</button>
    </details>
    <Link href={`/core/commissioner?league=${encodeURIComponent(leagueId)}`}>{m.weeklyPlanHubLink} →</Link>
    <WeeklyTaskFollowthrough key={leagueId} leagueId={leagueId} es={es} />
    <p role="status">{status}</p>
  </section>
}
