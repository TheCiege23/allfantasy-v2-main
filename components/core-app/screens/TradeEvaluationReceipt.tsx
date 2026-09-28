'use client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { TradeEvaluationReceipt as Receipt } from '@/lib/decision-os/trade/evaluationReceipt'
import { evaluationReceiptSchema } from '@/lib/decision-os/trade/evaluationReceipt'

const number = (value: number | null) => value == null ? 'Unpriced' : value.toLocaleString()

function Evaluation({ title, grade }: { title: string; grade: Receipt['grade'] }) {
  return <div>
    <h3>{title}</h3>
    {grade.graded ? <>
      <p>Your value grade: <strong>{grade.letter}</strong> · Other team: <strong>{grade.partnerLetter}</strong> · {grade.percentDiff > 0 ? '+' : ''}{grade.percentDiff}%</p>
      <p>{grade.basis}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 16 }}>
        {(['give', 'get'] as const).map(side => <div key={side}>
          <h4>{side === 'give' ? 'You give' : 'You get'} · {number(side === 'give' ? grade.giveValue : grade.getValue)}</h4>
          <ul>{grade.lines.filter(line => line.side === side).map((line, index) => <li key={index} style={{ overflowWrap: 'anywhere' }}>
            {line.name}: <strong>{number(line.leagueValue)}</strong>{line.marketValue !== line.leagueValue ? ` (base ${number(line.marketValue)})` : ''}
          </li>)}</ul>
        </div>)}
      </div>
      {grade.recommendation ? <p>{grade.recommendation}</p> : null}
      {grade.moves?.length ? <ul>{grade.moves.map((move, index) => <li key={index}>{move.name}: {move.reasons.join('; ')}</li>)}</ul> : null}
      {grade.rosterFit ? <p>Original personal roster utility: {number(grade.rosterFit.giveValue)} given, {number(grade.rosterFit.getValue)} received. This is separate from the value grade.</p> : null}
    </> : <p>Not graded: {grade.reason}</p>}
  </div>
}

/** Deep links from a calculator or email reopen the original, not a freshly repriced deal. */
export function TradeEvaluationReceipt({ leagueId, viewerId }: { leagueId: string | null; viewerId?: string | null }) {
  const search = useSearchParams()
  const evaluationQuery = search?.get('evaluation') ?? null
  const comparisonAbort = useRef<AbortController | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
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
  return <section className="af-tc-panel" aria-label="Saved trade evaluation" style={{ padding: 16, overflowWrap: 'anywhere' }}>
    <h2>Saved trade evaluation</h2>
    {receipt ? <>
      <p>Original evaluation: {new Date(receipt.evaluatedAt).toLocaleString()}. This record stays unchanged.</p>
      <p>{receipt.sourceUpdatedAt ? `Price source updated: ${receipt.sourceUpdatedAt}.` : 'Price source update time was not available.'} Evaluation time does not mean every source was updated then.</p>
      <Evaluation title="Original values" grade={receipt.grade} />
      {receipt.contextNotes ? <ul>{[...receipt.contextNotes.byeNotes, ...receipt.contextNotes.formatNotes].map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
      {receipt.dataGaps.length ? <details><summary>Original data gaps</summary><ul>{receipt.dataGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></details> : null}
      <button type="button" disabled={busy} onClick={() => void compare()}>{busy ? 'Comparing…' : 'Compare with current values'}</button>
      {' '}<a href={`/api/trade-value/analyze?evaluation=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">View saved data</a>
      {current ? <>
        <p>Current evaluation: {currentTime ? new Date(currentTime).toLocaleString() : ''}. Prices, league rules, and pick resolution can change between evaluations.</p>
        <Evaluation title="Current values" grade={current} />
      </> : null}
    </> : !error ? <p>Loading original evaluation…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}
