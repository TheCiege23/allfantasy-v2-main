'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { LineupImpactSummary } from '@/lib/decision-os/trade/rosterImpactSummary'
import styles from './TradeVisuals.module.css'
export function ComparisonBars({title,rows,unit}:{title:string;rows:{label:string;value:number}[];unit:string}) {
  const {copy,locale}=useTradeVisualCopy()

  if (rows.some(row => !Number.isFinite(row.value) || row.value < 0)) return null
  const max = Math.max(1,...rows.map(row=>row.value))
  return <section className={styles.panel} aria-label={copy(title)}><h4>{copy(title)}</h4>{rows.map(row => <div className={styles.row} key={row.label}><span>{copy(row.label)}</span><div className={styles.track} aria-hidden="true"><div className={styles.bar} style={{width:`${row.value/max*100}%`}} /></div><strong>{copy(row.value.toLocaleString(locale,{maximumFractionDigits:1}))}</strong></div>)}<small>{copy(unit)}{copy(" · bars start at zero")}</small></section>
}
export function TradeValueChart({grade,generic=false}:{grade:TradeGradeView;generic?:boolean}) {
  const {copy}=useTradeVisualCopy()

  if (!grade.graded) return null
  return <ComparisonBars title={copy(generic ? 'Market value each team receives' : 'Trade value balance')} unit={generic ? `General market value · ${grade.basis} · no roster projection` : `League value · ${grade.basis} · roster fit is evaluated separately`} rows={generic ? [{label:'Team A receives',value:grade.getMarket},{label:'Team B receives',value:grade.giveMarket}] : [{label:'You send',value:grade.giveValue},{label:'You receive',value:grade.getValue}]} />
}
export function LineupImpactChart({impact,retrospective=false}:{impact:LineupImpactSummary|null;retrospective?:boolean}) {
  const {copy}=useTradeVisualCopy()

  if (!impact || impact.blockedReason || impact.startingPointsBefore == null || impact.startingPointsAfter == null) return <p className={styles.panel}>{copy("Lineup graph unavailable: ")}{copy(impact?.blockedReason ?? 'weekly projections or roster context are missing')}{copy(".")}</p>
  return <><ComparisonBars title={copy(`${retrospective ? 'Projected player-swap comparison' : 'Projected starting lineup'} · week ${impact.week ?? 'unknown'}`)} unit="One week under this league’s scoring · projection, not a season result" rows={[{label:retrospective?'Undo player swap':'Before trade',value:impact.startingPointsBefore},{label:retrospective?'Current team':'After trade',value:impact.startingPointsAfter}]} />{impact.depthChanges.length ? <section className={styles.panel}><h4>{copy("Roster depth")}</h4>{impact.depthChanges.map(row => <p key={row.position}>{copy(row.position)}{copy(": ")}{copy(row.rosteredBefore)}{copy(" → ")}{copy(row.rosteredAfter)}{copy(" rostered players")}</p>)}</section> : null}{impact.unpricedExcluded > 0 ? <p>{copy(impact.unpricedExcluded)}{copy(" unprojected roster players excluded from the lineup simulation.")}</p> : null}</>
}
