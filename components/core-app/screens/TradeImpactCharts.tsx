'use client'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { LineupImpactSummary } from '@/lib/decision-os/trade/rosterImpactSummary'
import styles from './TradeVisuals.module.css'
export function ComparisonBars({title,rows,unit}:{title:string;rows:{label:string;value:number}[];unit:string}) {
  if (rows.some(row => !Number.isFinite(row.value) || row.value < 0)) return null
  const max = Math.max(1,...rows.map(row=>row.value))
  return <section className={styles.panel} aria-label={title}><h4>{title}</h4>{rows.map(row => <div className={styles.row} key={row.label}><span>{row.label}</span><div className={styles.track} aria-hidden="true"><div className={styles.bar} style={{width:`${row.value/max*100}%`}} /></div><strong>{row.value.toLocaleString(undefined,{maximumFractionDigits:1})}</strong></div>)}<small>{unit} · bars start at zero</small></section>
}
export function TradeValueChart({grade,generic=false}:{grade:TradeGradeView;generic?:boolean}) {
  if (!grade.graded) return null
  return <ComparisonBars title={generic ? 'Market value each team receives' : 'Trade value balance'} unit={generic ? `General market value · ${grade.basis} · no roster projection` : `League value · ${grade.basis} · roster fit is evaluated separately`} rows={generic ? [{label:'Team A receives',value:grade.getMarket},{label:'Team B receives',value:grade.giveMarket}] : [{label:'You send',value:grade.giveValue},{label:'You receive',value:grade.getValue}]} />
}
export function LineupImpactChart({impact,retrospective=false}:{impact:LineupImpactSummary|null;retrospective?:boolean}) {
  if (!impact || impact.blockedReason || impact.startingPointsBefore == null || impact.startingPointsAfter == null) return <p className={styles.panel}>Lineup graph unavailable: {impact?.blockedReason ?? 'weekly projections or roster context are missing'}.</p>
  return <><ComparisonBars title={`Projected starting lineup · week ${impact.week ?? 'unknown'}`} unit="One week under this league’s scoring · projection, not a season result" rows={[{label:retrospective?'Without this trade':'Before trade',value:impact.startingPointsBefore},{label:retrospective?'Current team':'After trade',value:impact.startingPointsAfter}]} />{impact.depthChanges.length ? <section className={styles.panel}><h4>Roster depth</h4>{impact.depthChanges.map(row => <p key={row.position}>{row.position}: {row.rosteredBefore} → {row.rosteredAfter} rostered players</p>)}</section> : null}{impact.unpricedExcluded > 0 ? <p>{impact.unpricedExcluded} unprojected roster players excluded from the lineup simulation.</p> : null}</>
}
