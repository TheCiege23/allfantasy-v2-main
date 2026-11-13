'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { FormatWalkthrough as FormatWalkthroughData } from '@/lib/league/whats-next/formatWalkthroughs'
import './whats-next.css'

/**
 * The 3–5 step "how this format runs" walkthrough. A plain dialog: Skip closes it at any step, Esc
 * closes it, and focus starts on the primary button and returns to whatever opened it.
 */
export function FormatWalkthrough({
  walkthrough,
  open,
  onClose,
}: {
  walkthrough: FormatWalkthroughData
  open: boolean
  onClose: (reason: 'skip' | 'done') => void
}) {
  const [step, setStep] = useState(0)
  const [mounted, setMounted] = useState(false)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    setStep(0)
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    const t = window.setTimeout(() => primaryRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      returnFocusRef.current?.focus?.()
    }
  }, [open])

  const close = useCallback((reason: 'skip' | 'done') => onClose(reason), [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('skip')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open || !mounted) return null
  const steps = walkthrough.steps
  const last = step >= steps.length - 1
  const current = steps[Math.min(step, steps.length - 1)]

  return createPortal(
    // `af-core` on the portal root: the dialog renders on <body>, outside the league page's token
    // scope, and af-core.css declares the palette on `.af-core` rather than :root.
    <div className="af-core wn-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && close('skip')}>
      <div
        className="wn-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wn-walkthrough-title"
        aria-describedby="wn-walkthrough-body"
        data-testid="format-walkthrough"
        data-format={walkthrough.format}
      >
        <div className="wn-dialog-head">
          <span className="wn-kicker">{walkthrough.title}</span>
          <button type="button" className="wn-icon-btn" onClick={() => close('skip')} aria-label="Close walkthrough">
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="wn-step-count" aria-live="polite">
          Step {step + 1} of {steps.length}
        </p>
        <h2 id="wn-walkthrough-title" className="wn-dialog-title">
          {current.title}
        </h2>
        <p id="wn-walkthrough-body" className="wn-dialog-body">
          {current.body}
        </p>
        <ol className="wn-dots" aria-hidden>
          {steps.map((s, i) => (
            <li key={s.title} data-on={i === step || undefined} />
          ))}
        </ol>
        <div className="wn-dialog-actions">
          <button type="button" className="wn-link-btn" onClick={() => close('skip')} data-testid="format-walkthrough-skip">
            Skip
          </button>
          <span className="wn-spacer" />
          {step > 0 ? (
            <button type="button" className="wn-btn" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </button>
          ) : null}
          <button
            ref={primaryRef}
            type="button"
            className="wn-btn wn-btn--primary"
            onClick={() => (last ? close('done') : setStep((s) => s + 1))}
            data-testid="format-walkthrough-next"
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
        <p className="wn-dialog-foot">You can reopen this any time from the ? on What&rsquo;s next.</p>
      </div>
    </div>,
    document.body,
  )
}
