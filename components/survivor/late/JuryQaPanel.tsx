'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import type { JuryQaView } from '@/lib/survivor/survivorJuryQaService'
import type { BallotRevealCouncil } from '@/lib/survivor/survivorBallotReveal'
import { CLOSING_SPEECH_MAX_CHARS, JURY_ANSWER_MAX_CHARS, JURY_QUESTION_MAX_CHARS } from '@/lib/survivor/survivorFinaleSettings'
import { finaleErrorMessage, survivorFinaleMessages, type SurvivorFinaleMessages } from '@/lib/survivor/survivorFinaleMessages'

function when(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(getAppIntlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type Handlers = {
  onAsk?: (finalistRosterId: string, text: string) => void
  onAnswer?: (jurorRosterId: string, text: string) => void
  onSeen?: (finalistRosterId: string) => void
  onSpeech?: (text: string) => void
}

function Composer({ label, placeholder, max, button, initial = '', disabled, onSubmit, testId, m }: {
  label: string; placeholder: string; max: number; button: string; initial?: string; disabled?: boolean; onSubmit: (text: string) => void; testId: string; m: SurvivorFinaleMessages
}) {
  const [text, setText] = useState(initial)
  useEffect(() => setText(initial), [initial])
  return (
    <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSubmit(text) }}>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
        {label}
        <textarea data-testid={testId} value={text} maxLength={max} onChange={(e) => setText(e.target.value)} placeholder={placeholder} disabled={disabled}
          className="mt-1 min-h-[80px] w-full rounded-xl border border-white/10 bg-black/30 p-3 text-[13px] normal-case tracking-normal text-white" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-white/35">{m.charsLeft(max - text.length)}</span>
        <button type="submit" disabled={disabled || !text.trim() || text === initial} className="min-h-[44px] rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 text-[13px] font-semibold text-amber-100 disabled:opacity-40">{button}</button>
      </div>
    </form>
  )
}

export function JuryQaPanelView({ qa, ballots, busy, error, handlers }: { qa: JuryQaView; ballots?: BallotRevealCouncil[] | null; busy?: boolean; error?: string | null; handlers?: Handlers }) {
  const m = useMessages(survivorFinaleMessages)
  const me = qa.viewer.rosterId
  const live = qa.finaleOpen && !qa.voteComplete
  const windowLines = [
    qa.windows.questionsOpenAt && qa.windows.questionState === 'not_yet' ? m.windowOpens(when(qa.windows.questionsOpenAt)!) : null,
    qa.windows.questionsDeadline ? m.windowCloses(when(qa.windows.questionsDeadline)!) : null,
    qa.windows.answersDeadline ? m.windowAnswers(when(qa.windows.answersDeadline)!) : null,
    qa.windows.speechesDeadline ? m.windowSpeeches(when(qa.windows.speechesDeadline)!) : null,
  ].filter(Boolean) as string[]
  const mySpeech = qa.speeches.find((s) => s.finalistRosterId === me) ?? null

  return (
    <div className="flex flex-col gap-6">
      <section className="survivor-panel p-4" aria-label={m.qaTitle} data-testid="jury-qa">
        <p className="text-[11px] font-bold uppercase text-white/45">{m.qaTitle}</p>
        <p className="mt-1 text-[13px] text-white/60">{qa.settings.juryQuestionsEnabled ? m.qaIntro : m.qaOff}</p>
        {windowLines.length ? <ul className="mt-2 flex flex-wrap gap-2">{windowLines.map((line) => <li key={line} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-amber-100/80">{line}</li>)}</ul> : null}
        {qa.windows.votingHeldForSpeeches ? <p className="mt-2 text-[12px] text-amber-200/80">{m.votingHeld}</p> : null}
        {error ? <p role="alert" className="mt-2 text-[13px] text-rose-300">{error}</p> : null}

        {!qa.canRead ? (
          <p className="mt-3 text-[13px] text-white/50">{m.qaPrivate}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {qa.finalists.map((finalist) => {
              const questions = qa.questions.filter((q) => q.finalistRosterId === finalist.rosterId)
              const mine = questions.find((q) => q.jurorRosterId === me) ?? null
              const canAsk = live && qa.settings.juryQuestionsEnabled && qa.viewer.isJuror && !mine && qa.windows.questionState === 'open' && finalist.rosterId !== me
              return (
                <article key={finalist.rosterId} className="rounded-xl border border-white/10 p-3">
                  <h3 className="text-[15px] font-bold text-white">{finalist.name}</h3>
                  {questions.length === 0 ? <p className="mt-1 text-[12px] text-white/40">{m.qaNone}</p> : null}
                  <ul className="mt-2 flex flex-col gap-3">
                    {questions.map((q) => {
                      const iAnswer = live && qa.viewer.isFinalist && q.finalistRosterId === me && qa.windows.answerState === 'open'
                      const iAsked = q.jurorRosterId === me
                      return (
                        <li key={q.id} className="rounded-lg bg-black/20 p-3">
                          <p className="text-[11px] uppercase text-white/40">{iAsked ? m.asked : m.askedBy(q.jurorName, q.finalistName)}</p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] text-white">{q.question}</p>
                          {q.answer ? <p className="mt-2 whitespace-pre-wrap border-l-2 border-amber-300/50 pl-3 text-[13px] text-amber-50">{q.answer}</p> : <p className="mt-2 text-[12px] text-white/40">{m.waitingAnswer}</p>}
                          {iAsked && q.answer ? (
                            q.seenAt ? <p className="mt-2 text-[11px] text-emerald-300">{m.seen}</p>
                              : <button type="button" disabled={busy} onClick={() => handlers?.onSeen?.(q.finalistRosterId)} className="mt-2 min-h-[44px] rounded-xl border border-white/15 px-3 text-[12px] text-white/80">{m.markSeen}</button>
                          ) : null}
                          {iAnswer ? <Composer m={m} testId={`jury-answer-${q.jurorRosterId}`} label={m.answerLabel} placeholder="" max={JURY_ANSWER_MAX_CHARS} button={q.answer ? m.updateAnswer : m.answerButton} initial={q.answer ?? ''} disabled={busy} onSubmit={(text) => handlers?.onAnswer?.(q.jurorRosterId, text)} /> : null}
                        </li>
                      )
                    })}
                  </ul>
                  {canAsk ? <Composer m={m} testId={`jury-ask-${finalist.rosterId}`} label={m.askLabel(finalist.name)} placeholder={m.askPlaceholder} max={JURY_QUESTION_MAX_CHARS} button={busy ? m.sending : m.askButton} disabled={busy} onSubmit={(text) => handlers?.onAsk?.(finalist.rosterId, text)} /> : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="survivor-panel p-4" aria-label={m.speechesTitle} data-testid="closing-speeches">
        <p className="text-[11px] font-bold uppercase text-white/45">{m.speechesTitle}</p>
        <p className="mt-1 text-[13px] text-white/60">{qa.settings.closingSpeechesEnabled ? m.speechesIntro : m.speechesOff}</p>
        {qa.canRead ? (
          <div className="mt-3 flex flex-col gap-3">
            {qa.speeches.length === 0 ? <p className="text-[12px] text-white/40">{m.speechNone}</p> : null}
            {qa.speeches.map((s) => (
              <blockquote key={s.finalistRosterId} className="rounded-xl border border-white/10 p-3">
                <p className="text-[13px] font-bold text-white">{s.name}</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-white/85">{s.text}</p>
              </blockquote>
            ))}
            {live && qa.settings.closingSpeechesEnabled && qa.viewer.isFinalist && qa.windows.speechState === 'open' ? (
              <Composer m={m} testId="closing-speech-input" label={m.speechLabel} placeholder={m.speechPlaceholder} max={CLOSING_SPEECH_MAX_CHARS} button={busy ? m.sending : mySpeech ? m.speechUpdate : m.speechPost} initial={mySpeech?.text ?? ''} disabled={busy} onSubmit={(text) => handlers?.onSpeech?.(text)} />
            ) : null}
          </div>
        ) : <p className="mt-3 text-[13px] text-white/50">{m.qaPrivate}</p>}
      </section>

      {ballots && ballots.length ? (
        <section className="survivor-panel p-4" aria-label={m.ballotsTitle} data-testid="ballot-reveal">
          <p className="text-[11px] font-bold uppercase text-white/45">{m.ballotsTitle}</p>
          <p className="mt-1 text-[13px] text-white/60">{m.ballotsIntro}</p>
          <ol className="mt-3 flex flex-col gap-3">
            {ballots.map((c) => (
              <li key={c.councilId} className="rounded-xl border border-white/10 p-3">
                <p className="text-[13px] font-bold text-white">{m.ballotsCouncil(c.week, c.councilNumber)}</p>
                {c.eliminatedName ? <p className="text-[12px] text-rose-200/80">{m.ballotsOut(c.eliminatedName)}</p> : null}
                <ul className="mt-2 flex flex-col gap-1">
                  {c.ballots.map((b, i) => (
                    <li key={`${c.councilId}:${i}`} className="text-[13px] text-white/80">{m.ballotsLine(b.voterName, b.targetName)}{b.counted ? '' : ` · ${m.ballotsNotCounted}`}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

/** Loads the jury Q&A, closing speeches and (after the season) the ballot reveal, and handles every action. */
export function JuryQaPanel({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const m = useMessages(survivorFinaleMessages)
  const [qa, setQa] = useState<JuryQaView | null>(null)
  const [ballots, setBallots] = useState<BallotRevealCouncil[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [qaRes, ballotRes] = await Promise.all([
        fetch(`/api/survivor/jury?leagueId=${encodeURIComponent(leagueId)}&part=qa`, { credentials: 'include' }),
        fetch(`/api/survivor/jury?leagueId=${encodeURIComponent(leagueId)}&part=ballots`, { credentials: 'include' }),
      ])
      const qaData = (await qaRes.json().catch(() => ({}))) as { qa?: JuryQaView }
      const ballotData = (await ballotRes.json().catch(() => ({}))) as { ballots?: BallotRevealCouncil[] | null }
      if (!qaRes.ok || !qaData.qa) return setLoadError(true)
      setQa(qaData.qa)
      setBallots(ballotRes.ok ? ballotData.ballots ?? null : null)
    } catch {
      setLoadError(true)
    }
  }, [leagueId])

  useEffect(() => { if (leagueId) void load() }, [leagueId, load])

  const send = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/survivor/jury', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...body }) })
      const data = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) setError(finaleErrorMessage(m, data.code))
      await load()
      onChanged?.()
    } catch {
      setError(m.errors_generic)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <p className="text-[13px] text-red-300">{m.qaLoadError}</p>
  if (!qa) return <p className="text-[13px] text-white/50">{m.qaLoading}</p>
  return (
    <JuryQaPanelView qa={qa} ballots={ballots} busy={busy} error={error} handlers={{
      onAsk: (finalistRosterId, text) => void send({ intent: 'jury_question', finalistRosterId, text }),
      onAnswer: (jurorRosterId, text) => void send({ intent: 'finalist_answer', jurorRosterId, text }),
      onSeen: (finalistRosterId) => void send({ intent: 'juror_seen', finalistRosterId }),
      onSpeech: (text) => void send({ intent: 'closing_speech', text }),
    }} />
  )
}
