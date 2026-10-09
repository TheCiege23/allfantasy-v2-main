'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import { TradeTranslationStatus } from './TradeTranslationStatus'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { TradeEvaluationReceipt as Receipt } from '@/lib/decision-os/trade/evaluationReceipt'
import { evaluationReceiptSchema } from '@/lib/decision-os/trade/evaluationReceipt'
import { rosterSpotRowLabel } from '@/lib/trade-value/rosterSpotCharge'

const number = (value: number | null, locale: string) => value == null ? 'Unpriced' : value.toLocaleString(locale)

function Evaluation({ title, grade }: { title: string; grade: Receipt['grade'] }) {
  const {copy,locale,language,translationState,retryTranslation}=useTradeVisualCopy(grade)

  return <div>
    <TradeTranslationStatus state={translationState} language={language} retry={retryTranslation} />
    <h3>{copy(title)}</h3>
    {grade.graded ? <>
      <p>{copy("Your value grade: ")}<strong>{copy(grade.letter)}</strong>{copy(" · Other team: ")}<strong>{copy(grade.partnerLetter)}</strong>{copy(" · ")}{copy(grade.percentDiff > 0 ? '+' : '')}{copy(grade.percentDiff)}{copy("%")}</p>
      <p>{copy(grade.basis)}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 16 }}>
        {(['give', 'get'] as const).map(side => <div key={side}>
          <h4>{copy(side === 'give' ? 'You give' : 'You get')}{copy(" · ")}{copy(number(side === 'give' ? grade.giveValue : grade.getValue, locale))}</h4>
          <ul>{grade.lines.filter(line => line.side === side).map((line, index) => <li key={index} style={{ overflowWrap: 'anywhere' }}>
            {line.name}{copy(": ")}<strong>{copy(number(line.leagueValue, locale))}</strong>{copy(line.marketValue !== line.leagueValue ? ` (base ${number(line.marketValue, locale)})` : '')}
          </li>)}
          {grade.rosterSpot?.side === side ? <li style={{ overflowWrap: 'anywhere' }}>{copy(rosterSpotRowLabel(grade.rosterSpot, 'viewer'))}{copy(": ")}<strong>{copy(number(grade.rosterSpot.value, locale))}</strong></li> : null}</ul>
        </div>)}
      </div>
      {grade.recommendation ? <p>{copy(grade.recommendation)}</p> : null}
      {grade.moves?.length ? <ul>{grade.moves.map((move, index) => <li key={index}>{move.name}{copy(": ")}{copy(move.reasons.join('; '))}</li>)}</ul> : null}
      {grade.rosterFit ? <p>{copy("Original personal roster utility: ")}{copy(number(grade.rosterFit.giveValue, locale))}{copy(" given, ")}{copy(number(grade.rosterFit.getValue, locale))}{copy(" received. This is separate from the value grade.")}</p> : null}
    </> : <p>{copy("Not graded: ")}{copy(grade.reason)}</p>}
  </div>
}

/** Deep links from a calculator or email reopen the original, not a freshly repriced deal. */
export function TradeEvaluationReceipt({ leagueId, viewerId }: { leagueId: string | null; viewerId?: string | null }) {

  const search = useSearchParams()
  const evaluationQuery = search?.get('evaluation') ?? null
  const comparisonAbort = useRef<AbortController | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const {copy,locale,language,translationState,retryTranslation}=useTradeVisualCopy(receipt)
  const [id, setId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<Receipt['grade'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [currentTime, setCurrentTime] = useState<string | null>(null)
  useEffect(() => {
    const evaluation = evaluationQuery ?? new URL(window.location.href).searchParams.get('evaluation')
    comparisonAbort.current?.abort()
    setId(evaluation); setReceipt(null); setCurrent(null); setError(null); setBusy(false)
    if (!evaluation || !viewerId || !leagueId) return
    const abort = new AbortController()
    fetch(`/api/trade-value/analyze?evaluation=${encodeURIComponent(evaluation)}`, { cache: 'no-store', signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 404 ? 'This evaluation is not available to this account and league.' : 'Could not load the saved evaluation. Try again later.')
        const body = await response.json()
        const parsed = evaluationReceiptSchema.safeParse(body.receipt)
        if (!parsed.success || parsed.data.league.id !== leagueId) throw new Error('This evaluation belongs to a different league.')
        if (!abort.signal.aborted) setReceipt(parsed.data)
      }).catch(e => { if (!abort.signal.aborted) setError(e.message) })
    return () => { abort.abort(); comparisonAbort.current?.abort() }
  }, [leagueId, viewerId, evaluationQuery])
  if (!id) return null
  const compare = async () => {
    if (!receipt || busy) return
    const abort = new AbortController()
    comparisonAbort.current = abort
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/trade-value/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...receipt.input, skipAi: true }), signal: abort.signal })
      if (!response.ok) throw new Error('Current values could not be loaded. Your original evaluation is unchanged.')
      const body = await response.json()
      // Use the same validated verdict shape as a stored receipt, dropping all paid fields.
      const parsed = evaluationReceiptSchema.safeParse({ ...receipt, grade: body.grade })
      if (!parsed.success) throw new Error('A current evaluation was not available. Your original evaluation is unchanged.')
      if (!abort.signal.aborted) { setCurrent(parsed.data.grade); setCurrentTime(new Date().toISOString()) }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Comparison failed. Your original evaluation is unchanged.') }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  return <section className="af-tc-panel" aria-label={copy("Saved trade evaluation")} style={{ padding: 16, overflowWrap: 'anywhere' }}>
    <TradeTranslationStatus state={translationState} language={language} retry={retryTranslation} />
    <h2>{copy("Saved trade evaluation")}</h2>
    {receipt ? <>
      <p>{copy("Original evaluation: ")}{copy(new Date(receipt.evaluatedAt).toLocaleString(locale))}{copy(". This record stays unchanged.")}</p>
      <p>{copy(receipt.sourceUpdatedAt ? `Price source updated: ${receipt.sourceUpdatedAt}.` : 'Price source update time was not available.')}{copy(" Evaluation time does not mean every source was updated then.")}</p>
      <Evaluation title={copy("Original values")} grade={receipt.grade} />
      {receipt.contextNotes ? <ul>{[...receipt.contextNotes.byeNotes, ...receipt.contextNotes.formatNotes].map((note, index) => <li key={index}>{copy(note)}</li>)}</ul> : null}
      {receipt.dataGaps.length ? <details><summary>{copy("Original data gaps")}</summary><ul>{receipt.dataGaps.map((gap, index) => <li key={index}>{copy(gap)}</li>)}</ul></details> : null}
      <button type="button" disabled={busy} onClick={() => void compare()}>{copy(busy ? 'Comparing…' : 'Compare with current values')}</button>
      {copy(' ')}<a href={`/api/trade-value/analyze?evaluation=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">{copy("View saved data")}</a>
      {current ? <>
        <p>{copy("Current evaluation: ")}{copy(currentTime ? new Date(currentTime).toLocaleString(locale) : '')}{copy(". Prices, league rules, and pick resolution can change between evaluations.")}</p>
        <Evaluation title={copy("Current values")} grade={current} />
      </> : null}
    </> : !error ? <p>{copy("Loading original evaluation…")}</p> : null}
    {error ? <p role="alert">{copy(error)}</p> : null}
  </section>
}
