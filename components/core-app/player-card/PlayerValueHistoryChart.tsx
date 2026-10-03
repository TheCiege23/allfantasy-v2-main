'use client'
import { useEffect, useMemo, useState } from 'react'
import { valueHistoryBuckets, type ValueCapture } from '@/lib/decision-os/trade/visualHistory'
import styles from '../screens/TradeVisuals.module.css'
type History = {points:ValueCapture[];description:string;note:string;scope:string}
export function PlayerValueHistoryChart({sleeperId,sport,leagueId,unlocked}:{sleeperId?:string|null;sport?:string|null;leagueId?:string|null;unlocked:boolean}) {
  const [history,setHistory] = useState<History|null>(null)
  const [error,setError] = useState<string|null>(null)
  const [mode,setMode] = useState<'weeks'|'seasons'>('weeks')
  const [kind,setKind] = useState<'line'|'bar'>('line')
  const [currentOnly,setCurrentOnly] = useState(true)
  const [pointIndex,setPointIndex] = useState(0)
  useEffect(() => {
    setHistory(null);setError(null)
    if (!unlocked || sport?.toUpperCase() !== 'NFL' || !sleeperId || !/^\d+$/.test(sleeperId)) return
    const controller = new AbortController()
    const params = new URLSearchParams({sleeperId,sport:'NFL',...(leagueId ? {leagueId}: {})})
    void fetch(`/api/core/player-value-history?${params}`,{signal:controller.signal}).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'History unavailable')
      if (!controller.signal.aborted) setHistory(body)
    }).catch(e => {if (!controller.signal.aborted) setError(e.message)})
    return () => controller.abort()
  },[sleeperId,sport,leagueId,unlocked])
  const buckets = useMemo(()=>{
    const now=new Date(),season=now.getUTCFullYear()-(now.getUTCMonth()<2?1:0)
    const points=mode==='weeks' && currentOnly ? (history?.points??[]).filter(point=>point.day>=`${season}-03-01` && point.day<`${season+1}-03-01`) : history?.points??[]
    return valueHistoryBuckets(points,mode)
  },[history,mode,currentOnly])
  if (!unlocked || sport?.toUpperCase() !== 'NFL' || !sleeperId || !/^\d+$/.test(sleeperId)) return null
  const max = Math.max(1,...buckets.map(r=>r.value??0))
  const x = (index:number) => 24+index*552/Math.max(1,buckets.length-1)
  const y = (value:number) => 180-value/max*150
  const paths:string[] = []
  for (let i=0;i<buckets.length;i++) {const point=buckets[i];if (point.value==null) continue;const command=`${x(i)},${y(point.value)}`;if (i===0 || buckets[i-1].value==null) paths.push(`M${command}`);else paths[paths.length-1]+=` L${command}`}
  return <section className={styles.panel} aria-label="Player market value history"><h4>Value over time</h4>{error ? <p role="status">{error}</p> : !history ? <p role="status">Loading recorded values…</p> : <><p>{history.description} · {history.scope === 'universal-market' ? 'Universal reference book' : 'This league’s market book'}</p><div className={styles.controls}><button type="button" aria-pressed={mode==='weeks'} onClick={()=>setMode('weeks')}>By capture week</button><button type="button" aria-pressed={mode==='seasons'} onClick={()=>setMode('seasons')}>By season</button><label><input type="checkbox" checked={currentOnly} onChange={e=>setCurrentOnly(e.target.checked)} disabled={mode==='seasons'} /> Current season weeks</label><button type="button" aria-pressed={kind==='line'} onClick={()=>setKind('line')}>Line</button><button type="button" aria-pressed={kind==='bar'} onClick={()=>setKind('bar')}>Bars</button></div>{buckets.length ? <><small>0–{max.toLocaleString()} market value</small><svg className={styles.chart} viewBox="0 0 600 210" role="img" aria-label={`Recorded market value chart, ${mode}. Full values in the table below.`}><line x1="24" y1="180" x2="576" y2="180" stroke="currentColor" opacity=".3"/>{kind==='line' ? paths.map((path,i)=><path key={i} d={path} fill="none" stroke="currentColor" strokeWidth="2"/>) : null}{buckets.map((point,i)=>point.value==null ? null : kind==='line' ? <circle key={point.label} cx={x(i)} cy={y(point.value)} r="3" fill="currentColor"><title>{point.label}: {point.value} · captured {point.day}</title></circle> : <rect key={point.label} x={buckets.length===1?280:Math.max(24,x(i)-4)} y={y(point.value)} width={Math.min(20,Math.max(2,500/buckets.length))} height={180-y(point.value)} fill="currentColor"><title>{point.label}: {point.value}</title></rect>)}</svg><div className={styles.axis}><span>{buckets[0].label}</span><span>{buckets.at(-1)?.label}</span></div><label className={styles.controls}>Inspect period<input aria-label="Inspect capture period" type="range" min={0} max={Math.max(0,buckets.length-1)} step={1} value={Math.min(pointIndex,buckets.length-1)} onChange={e=>setPointIndex(Number(e.target.value))}/></label><p aria-live="polite">{buckets[Math.min(pointIndex,buckets.length-1)].label}: {buckets[Math.min(pointIndex,buckets.length-1)].value?.toLocaleString()??'No recorded quote'} · capture {buckets[Math.min(pointIndex,buckets.length-1)].value==null?'unavailable':buckets[Math.min(pointIndex,buckets.length-1)].day}</p><details className={styles.table}><summary>View exact values and capture dates</summary><table><thead><tr><th>Period</th><th>Last capture</th><th>Value</th></tr></thead><tbody>{buckets.map(point=><tr key={point.label}><td>{point.label}</td><td>{point.value==null?'No capture':point.day}</td><td>{point.value?.toLocaleString()??'Unavailable'}</td></tr>)}</tbody></table></details><p>{mode==='weeks'?'Last recorded price in each Monday–Sunday capture week; these are calendar weeks, not NFL scoring weeks.':'Last recorded price in each NFL season; January–February belongs to the prior season. Current season is incomplete.'} History begins {history.points[0]?.day}; earlier seasons are shown only when recorded. {history.note}</p></> : <p>No recorded price history for this player in this book yet.</p>}</>}</section>
}
