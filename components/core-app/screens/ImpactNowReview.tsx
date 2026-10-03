'use client'
import { useEffect, useRef, useState } from 'react'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { VisualImpactResult } from '@/lib/decision-os/trade/loadVisualImpact'
import { ComparisonBars, LineupImpactChart } from './TradeImpactCharts'
import { TradeEvidencePanel } from './TradeEvidencePanel'
import styles from './TradeVisuals.module.css'
import { TradeOutcomeReceipt } from './TradeOutcomeReceipt'
import type { RealizedReceipt } from '@/lib/decision-os/trade/realizedReceipt'
export type ImpactNowRef = {kind:'archive';transactionId:string}|{kind:'af';tradeId:string}|{kind:'redraft';proposalId:string}|{kind:'provider';provider:'sleeper';providerTradeId:string}
type Review = VisualImpactResult & {grade:TradeGradeView|null;nonPlayers:boolean;note:string;realized?:RealizedReceipt|null}
export function ImpactNowReview({leagueId,trade,original}:{leagueId:string;trade:ImpactNowRef;original?:TradeGradeView|null}) {
  const [result,setResult]=useState<Review|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[goal,setGoal]=useState('balance')
  const pending=useRef<AbortController|null>(null)
  const refKey=JSON.stringify(trade)
  useEffect(()=>{setResult(null);setError(null);setBusy(false);return()=>pending.current?.abort()},[leagueId,refKey])
  async function review() {
    pending.current?.abort();const controller=new AbortController();pending.current=controller
    setBusy(true);setError(null)
    try {const response=await fetch('/api/trades/impact-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId,trade}),signal:controller.signal});const body=await response.json();if (!response.ok) throw new Error(body.error??'Review unavailable');if (!controller.signal.aborted) setResult(body)} catch(e) {if (!controller.signal.aborted) setError(e instanceof Error?e.message:'Review unavailable')} finally {if (!controller.signal.aborted) setBusy(false)}
  }
  const grade=result?.grade
  return <div><button type="button" className={styles.button} disabled={busy} onClick={()=>void review()}>{busy?'Reviewing current team…':result?'Refresh impact now':'Impact now'}</button>{error?<p role="alert">{error}</p>:null}{result?<section className={styles.panel} aria-label="Current trade impact"><h4>How does this trade look today?</h4><TradeOutcomeReceipt original={original} current={result.grade} realized={result.realized??null}/><p>Checked {new Date(result.evaluatedAt).toLocaleString()}. {result.note}</p><label className={styles.controls}>Your focus <select value={goal} onChange={e=>setGoal(e.target.value)}><option value="balance">Balanced roster</option><option value="win">Win this week</option><option value="rebuild">Build future value</option></select></label><p>{goal==='win'?'Prioritize the starting-lineup projection. A favorable market grade may still leave your lineup weaker.':goal==='rebuild'?'Prioritize current asset value. Picks, age, contracts and future seasons need a separate review; this week’s lineup is only one piece.':'Compare both the asset value and starting-lineup effect. They answer different questions.'} Changing your focus does not change the price grade.</p>{grade?.graded?<><p>Current value grade: you {grade.letter} · partner {grade.partnerLetter}</p><TradeEvidencePanel grade={grade} evaluatedAt={result.evaluatedAt}/><ComparisonBars title="Original assets at current recorded prices" unit={`League value · ${grade.basis}`} rows={[{label:'You sent',value:grade.giveValue},{label:'You acquired',value:grade.getValue}]} /></>:<p>Current value grade unavailable: {grade && !grade.graded?grade.reason:'quotes unavailable'}</p>}{result.reason?<p>{result.reason}</p>:null}{result.moved.length?<p>No longer held: {result.moved.join(', ')}.</p>:null}{result.returned.length?<p>Sent players back on your team: {result.returned.join(', ')}.</p>:null}{result.impact?<LineupImpactChart impact={result.impact} retrospective/>:null}{result.rostersStale?<p>Roster sync is stale or unverified. Sync your league before relying on this comparison.</p>:null}{result.nonPlayers?<p>Picks and FAAB are outside the weekly lineup simulation. Later pick-to-player outcomes and subsequent trades are not undone.</p>:null}</section>:null}</div>
}
