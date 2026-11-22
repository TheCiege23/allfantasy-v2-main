import type { ReactNode } from 'react'

import './af-primitives.css'

/**
 * THE "WHY", SAID THE SAME WAY ON EVERY SCREEN (owner's call, 2026-11-22).
 *
 * A trade grade, a pickup, a bench swap: each prints a line that is MEASURED — from completed trades, or from how
 * the same call has done before — and each screen had cut its own paragraph for it. This is that line once: a small
 * label that says where the number comes from, then the sentence(s), verbatim from whoever measured them.
 *
 * It only shows text it is handed. It never computes, rounds or rewords — so it cannot say something the grade or
 * the ledger did not. Hand it nothing and it renders nothing.
 *
 *   `inline`  renders spans (for use inside a sentence's own <span>/<p>); a list needs the block form.
 *   `tone`    'low' = the record is weak, so the line reads a step louder than the quiet default.
 */
export type EvidenceItem = {
  text: string
  /** On this sentence alone — for callers whose tests pin the exact sentence. */
  testId?: string
  /** data-* attributes this sentence carries (e.g. `{ verdict: 'held_up' }`). */
  data?: Record<string, string | undefined>
}

const dataProps = (data: Record<string, string | undefined> | undefined) =>
  Object.fromEntries(Object.entries(data ?? {}).filter(([, v]) => v != null).map(([k, v]) => [`data-${k}`, v]))

export function EvidenceLine({
  label,
  lines,
  tone,
  inline = false,
  className,
  testId,
  listLabel,
}: {
  label: ReactNode
  lines: ReadonlyArray<string | EvidenceItem | null | undefined>
  tone?: 'low'
  inline?: boolean
  className?: string
  /** On the whole block. */
  testId?: string
  listLabel?: string
}) {
  const shown: EvidenceItem[] = lines
    .map((l) => (typeof l === 'string' ? { text: l } : l))
    .filter((l): l is EvidenceItem => !!l && typeof l.text === 'string' && l.text.trim() !== '')
  if (shown.length === 0) return null
  const cls = `af-evidence${className ? ` ${className}` : ''}`
  if (inline) {
    return (
      <span className={cls} data-inline="" data-tone={tone} data-testid={testId}>
        <span className="af-evidence-label">{label}</span>
        {shown.map((l) => (
          <span key={l.text} className="af-evidence-text" data-testid={l.testId} {...dataProps(l.data)}>{l.text}</span>
        ))}
      </span>
    )
  }
  return (
    <div className={cls} data-tone={tone} data-testid={testId}>
      <div className="af-evidence-label">{label}</div>
      {shown.length === 1 ? (
        <p className="af-evidence-text" data-testid={shown[0]!.testId} {...dataProps(shown[0]!.data)}>{shown[0]!.text}</p>
      ) : (
        <ul className="af-evidence-list" aria-label={listLabel}>
          {shown.map((l) => (
            <li key={l.text} data-testid={l.testId} {...dataProps(l.data)}>{l.text}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
