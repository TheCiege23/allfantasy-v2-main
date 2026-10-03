'use client'

import { useState } from 'react'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { projectedLetterFor } from '@/lib/trade-intel/gradeScale'
import { tradeEvidence, tradePackageReview, tradeValueSensitivity } from '@/lib/decision-os/trade/tradeEvidence'
import styles from './TradeEvidencePanel.module.css'

export function TradeEvidencePanel({ grade, evaluatedAt, gaps = [], generic = false }: {
  grade: Extract<TradeGradeView, { graded: true }>
  evaluatedAt: string | null | undefined
  gaps?: readonly string[]
  generic?: boolean
}) {
  const [swing, setSwing] = useState(10)
  const evidence = tradeEvidence(grade.lines, evaluatedAt ?? '', gaps)
  const packageReview = tradePackageReview(grade.lines)
  const range = tradeValueSensitivity(grade.giveValue, grade.getValue, swing)
  const formatDate = (date: string) => new Date(date).toLocaleDateString()
  const low = range ? projectedLetterFor({ percentDiff: range.low, hasSignal: true }) : null
  const high = range ? projectedLetterFor({ percentDiff: range.high, hasSignal: true }) : null
  return (
    <aside className={styles.panel} aria-label="Trade evidence quality" data-testid="trade-evidence-panel">
      <div className={styles.heading}><strong>{evidence.label}</strong><span>{evidence.priced}/{evidence.total} assets priced · {evidence.dated}/{evidence.total} dated</span></div>
      <p>This describes the recorded evidence. It is not a probability of winning the trade.</p>
      {evidence.oldest && evidence.newest ? <p>Source dates: {formatDate(evidence.oldest)}{evidence.oldest !== evidence.newest ? ` – ${formatDate(evidence.newest)}` : ''}. Sources older than 7 days are flagged.</p> : null}
      {evidence.issues.length ? <details><summary>What limits this evaluation? ({evidence.issues.length})</summary><ul>{evidence.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details> : null}
      {packageReview ? <div className={styles.package}><strong>Package needs a roster review</strong><p>{generic ? packageReview.note.replace('You send', 'Team A sends').replace('and receive', 'and receives') : packageReview.note}</p></div> : null}
      {range ? <details>
        <summary>What could change the grade?</summary>
        <label className={styles.control}>Value stress scenario
          <select aria-label="Value stress scenario" value={swing} onChange={event => setSwing(Number(event.target.value))}>
            <option value={5}>±5%</option><option value={10}>±10%</option><option value={20}>±20%</option>
          </select>
        </label>
        <p>If all outgoing prices rose {swing}% and incoming prices fell {swing}%, {generic ? 'Team A’s' : 'your'} grade would be {low}. Reversing that scenario gives {high}. Signed value gap: {range.low}% to {range.high}%.</p>
        <p>{low === high ? 'The letter holds across this scenario.' : 'The letter changes in this scenario; small valuation differences can affect the verdict.'} This is a sensitivity check, not a forecast, confidence interval, or comparison between independent sources.</p>
      </details> : null}
    </aside>
  )
}

