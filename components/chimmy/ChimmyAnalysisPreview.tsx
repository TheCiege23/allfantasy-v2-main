'use client'

import { isInIosAppWithoutIapClient } from '@/lib/platform/iosApp'
import type { DeepAnalysisPreview } from '@/lib/chimmy/deepAnalysisPreview'
import styles from './ChimmyAnalysisPreview.module.css'

export function ChimmyAnalysisPreview({ preview, onUnlock, onRefresh, busy = false }: {
  preview: DeepAnalysisPreview
  onUnlock?: () => void
  onRefresh?: () => void
  busy?: boolean
}) {
  const included = preview.access === 'daily_answer'
  return <section className={styles.card} aria-label="Deep Analysis preview" data-testid="chimmy-analysis-preview">
    <span className={styles.label}>Free summary</span>
    <p className={styles.summary}>{preview.summary}</p>
    <h3 className={styles.title}>Go deeper when you need it</h3>
    <ul className={styles.sections}>{preview.sections.map(section => <li key={section.title}>
      <strong>{section.title}</strong><span>{section.description}</span>
      <div className={styles.placeholder} aria-hidden="true"><i /><i /><i /></div>
    </li>)}</ul>
    {preview.notice ? <p className={styles.notice} role="status">{preview.notice}</p> : null}
    <p className={styles.price}>{included
      ? `Use one included answer · ${preview.dailyRemaining ?? 0} remaining today`
      : `Extra detail: ${preview.tokenCost} tokens${preview.currentBalance != null ? ` · Your balance: ${preview.currentBalance}` : ''}`}</p>
    <p className={styles.note}>Your summary is free. No tokens have been spent.</p>
    {onUnlock ? <button className={styles.unlock} type="button" disabled={busy || !preview.canUnlock} onClick={onUnlock}>
      {busy ? 'Opening analysis…' : included ? 'Use 1 included answer' : `Unlock extra detail · ${preview.tokenCost} tokens`}
    </button> : onRefresh ? <button className={styles.unlock} type="button" disabled={busy} onClick={onRefresh}>Refresh unlock price</button>
      : <p className={styles.note}>Ask again for a fresh unlock price.</p>}
    {!preview.canUnlock ? <p className={styles.note}>You can keep this free summary. {preview.resetsAt ? 'Included answers refill at midnight UTC. ' : ''}
      {!isInIosAppWithoutIapClient() ? <a href="/tokens">View token options</a> : null}</p> : null}
  </section>
}
