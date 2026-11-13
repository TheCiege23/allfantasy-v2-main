'use client'
import { TradeTranslationStatus } from "./TradeTranslationStatus"
import { useTradeVisualCopy } from "./useTradeVisualCopy"
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
  const {copy,locale,language,translationState,retryTranslation}=useTradeVisualCopy({result,original})
  const pending=useRef<AbortController|null>(null)
  const refKey=JSON.stringify(trade)
  useEffect(()=>{setResult(null);setError(null);setBusy(false);return()=>pending.current?.abort()},[leagueId,refKey])
  async function review() {
    pending.current?.abort();const controller=new AbortController();pending.current=controller
    setBusy(true);setError(null)
    try {const response=await fetch('/api/trades/impact-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId,trade}),signal:controller.signal});const body=await response.json();if (!response.ok) throw new Error(body.error??'Review unavailable');if (!controller.signal.aborted) setResult(body)} catch(e) {if (!controller.signal.aborted) setError(e instanceof Error?e.message:'Review unavailable')} finally {if (!controller.signal.aborted) setBusy(false)}
  }
  const grade=result?.grade
  return <div><TradeTranslationStatus state={translationState} language={language} retry={retryTranslation}/><button type="button" className={styles.button} disabled={busy} onClick={()=>void review()}>{copy(busy?'Reviewing current team…':result?'Refresh impact now':'Impact now')}</button>{error?<p role="alert">{copy(error)}</p>:null}{result?<section className={styles.panel} aria-label={copy("Current trade impact")}><h4>{copy("How does this trade look today?")}</h4><TradeOutcomeReceipt original={original} current={result.grade} realized={result.realized??null}/><p>{copy("Checked ")}{copy(new Date(result.evaluatedAt).toLocaleString(locale))}{copy(". ")}{copy(result.note)}</p><label className={styles.controls}>{copy("Your focus ")}<select value={goal} onChange={e=>setGoal(e.target.value)}><option value="balance">{copy("Balanced roster")}</option><option value="win">{copy("Win this week")}</option><option value="rebuild">{copy("Build future value")}</option></select></label><p>{copy(goal==='win'?'Focus on your starting lineup. A good value grade can still leave your lineup weaker.':goal==='rebuild'?'Focus on long-term value. Check picks, ages and contracts too — this week’s lineup is only one piece.':'Look at both the value and the lineup effect. They answer different questions.')}{copy(" Changing your focus doesn’t change the value grade.")}</p>{grade?.graded?<><p>{copy("Grade today: you ")}{copy(grade.letter)}{copy(" · partner ")}{copy(grade.partnerLetter)}</p><TradeEvidencePanel grade={grade} evaluatedAt={result.evaluatedAt}/><ComparisonBars title={copy("What each side got, at today’s values")} unit={`League value · ${grade.basis}`} rows={[{label:'You sent',value:grade.giveValue},{label:'You acquired',value:grade.getValue}]} /></>:<p>{copy("We can’t grade it today: ")}{copy(grade && !grade.graded?grade.reason:'values unavailable')}</p>}{result.reason?<p>{copy(result.reason)}</p>:null}{result.moved.length?<p>{copy("No longer on your team: ")}{result.moved.join(', ')}{copy(".")}</p>:null}{result.returned.length?<p>{copy("Players you sent who are back on your team: ")}{result.returned.join(', ')}{copy(".")}</p>:null}{result.impact?<LineupImpactChart impact={result.impact} retrospective/>:null}{result.rostersStale?<p>{copy("Your rosters may be out of date. Sync your league before relying on this.")}</p>:null}{result.nonPlayers?<p>{copy("Picks and FAAB aren’t part of the lineup numbers. Later trades, and players drafted with those picks, aren’t undone here.")}</p>:null}</section>:null}</div>
}
