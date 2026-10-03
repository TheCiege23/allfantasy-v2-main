'use client'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { VisualImpactResult } from '@/lib/decision-os/trade/loadVisualImpact'
import { decisionSummary } from '@/lib/decision-os/trade/decisionSummary'
import styles from './TradeVisuals.module.css'

export function TradeDecisionSummary(props: {grade:TradeGradeView;evaluatedAt?:string|null;gaps?:readonly string[];visual?:VisualImpactResult|null;generic?:boolean}) {
  const summary = decisionSummary(props)
  const groups: Array<[string,string[]]> = [
    ['Why consider accepting', summary.accept], ['Why hesitate', summary.hesitate], ['What would change this assessment', summary.change],
  ]
  return <section className={styles.panel} aria-label="Trade decision summary"><h4>{summary.headline}</h4><div className={styles.decisionGrid}>{groups.map(([title, lines]) => <div key={title}><strong>{title}</strong><ul>{lines.slice(0,2).map(line => <li key={line}>{line}</li>)}</ul>{lines.length>2?<details><summary>More factors ({lines.length-2})</summary><ul>{lines.slice(2).map(line=><li key={line}>{line}</li>)}</ul></details>:null}</div>)}</div><small>Value grades describe the exchange price. Both teams can improve their lineups even when their value letters differ.</small></section>
}
