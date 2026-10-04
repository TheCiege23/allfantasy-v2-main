'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import { TradeTranslationStatus } from './TradeTranslationStatus'

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
  const {copy,locale,language,translationState,retryTranslation}=useTradeVisualCopy(grade)

  const [swing, setSwing] = useState(10)
  const evidence = tradeEvidence(grade.lines, evaluatedAt ?? '', gaps)
  const packageReview = tradePackageReview(grade.lines)
  const range = tradeValueSensitivity(grade.giveValue, grade.getValue, swing)
  const formatDate = (date: string) => new Date(date).toLocaleDateString(locale)
  const low = range ? projectedLetterFor({ percentDiff: range.low, hasSignal: true }) : null
  const high = range ? projectedLetterFor({ percentDiff: range.high, hasSignal: true }) : null
  return (
    <aside className={styles.panel} aria-label={copy("Trade evidence quality")} data-testid="trade-evidence-panel">
      <TradeTranslationStatus state={translationState} language={language} retry={retryTranslation} />
      <div className={styles.heading}><strong>{copy(evidence.label)}</strong><span>{copy(evidence.priced)}{copy("/")}{copy(evidence.total)}{copy(" assets priced · ")}{copy(evidence.dated)}{copy("/")}{copy(evidence.total)}{copy(" dated")}</span></div>
      <p>{copy("This describes the recorded evidence. It is not a probability of winning the trade.")}</p>
      {evidence.oldest && evidence.newest ? <p>{copy("Source dates: ")}{copy(formatDate(evidence.oldest))}{copy(evidence.oldest !== evidence.newest ? ` – ${formatDate(evidence.newest)}` : '')}{copy(". Sources older than 7 days are flagged.")}</p> : null}
      {evidence.issues.length ? <details><summary>{copy("What limits this evaluation? (")}{copy(evidence.issues.length)}{copy(")")}</summary><ul>{evidence.issues.map(issue => <li key={issue}>{copy(issue)}</li>)}</ul></details> : null}
      {packageReview ? <div className={styles.package}><strong>{copy("Package needs a roster review")}</strong><p>{copy(generic ? packageReview.note.replace('You send', 'Team A sends').replace('and receive', 'and receives') : packageReview.note)}</p></div> : null}
      {range ? <details>
        <summary>{copy("What could change the grade?")}</summary>
        <label className={styles.control}>{copy("Value stress scenario ")}<select aria-label={copy("Value stress scenario")} value={swing} onChange={event => setSwing(Number(event.target.value))}>
            <option value={5}>{copy("±5%")}</option><option value={10}>{copy("±10%")}</option><option value={20}>{copy("±20%")}</option>
          </select>
        </label>
        <p>{copy("If all outgoing prices rose ")}{copy(swing)}{copy("% and incoming prices fell ")}{copy(swing)}{copy("%, ")}{copy(generic ? 'Team A’s grade would be' : 'your grade would be')} {copy(low)}{copy(". Reversing that scenario gives ")}{copy(high)}{copy(". Signed value gap: ")}{copy(range.low)}{copy("% to ")}{copy(range.high)}{copy("%.")}</p>
        <p>{copy(low === high ? 'The letter holds across this scenario.' : 'The letter changes in this scenario; small valuation differences can affect the verdict.')}{copy(" This is a sensitivity check, not a forecast, confidence interval, or comparison between independent sources.")}</p>
      </details> : null}
    </aside>
  )
}
