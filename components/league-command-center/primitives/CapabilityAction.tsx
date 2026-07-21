'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionCapability } from '@/lib/league-command-center/types'

/**
 * Renders an action control whose behavior is dictated by real, resolved
 * capability — never by what the design would prefer.
 *
 * The rule this component exists to enforce: **never a fake write button
 * without real write capability.** Each branch below is a genuinely different
 * control, not a cosmetic variation:
 *
 *  - `native_write`      → a real submit button that calls `onExecute`.
 *  - `external_deep_link`→ an anchor to the provider, opening in a new tab.
 *  - `copyable_message`  → a copy-to-clipboard button.
 *  - `read_only_guidance`→ NOT a button. Text explaining where to finish, because
 *                          there is nothing here to click that would work.
 *  - `informational`     → NOT a button.
 *
 * `capability` comes from `resolveActionCapability`, which already downgraded
 * anything it could not honestly support (a missing provider URL, a
 * `native_execute` claim on an imported league). This component trusts that
 * result and does not second-guess it.
 */
export interface CapabilityActionProps {
  capability: ActionCapability
  /** Button text for the actionable variants. */
  label: string
  /** Invoked only for `native_write`. Never called for any other kind. */
  onExecute?: () => void | Promise<void>
  variant?: 'primary' | 'default' | 'ops'
  /** Hides the small capability explainer line under the control. */
  hideExplainer?: boolean
  disabled?: boolean
}

export function CapabilityAction({
  capability,
  label,
  onExecute,
  variant = 'default',
  hideExplainer = false,
  disabled = false,
}: CapabilityActionProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (!capability.copyText) return
    try {
      await navigator.clipboard.writeText(capability.copyText)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard can be blocked by permissions policy. Say so rather than
      // showing a success state that did not happen.
      setCopied(false)
    }
  }, [capability.copyText])

  const handleExecute = useCallback(async () => {
    if (!onExecute || busy) return
    setBusy(true)
    try {
      await onExecute()
    } finally {
      setBusy(false)
    }
  }, [onExecute, busy])

  const explainer = hideExplainer ? null : (
    <span className="af-cc-cap">
      <i className={`ph ${capability.icon}`} aria-hidden="true" />
      {capability.label}
    </span>
  )

  const buttonClass = [
    'af-cc-action',
    variant === 'primary' ? 'af-cc-action--primary' : null,
    variant === 'ops' ? 'af-cc-action--ops' : null,
  ]
    .filter(Boolean)
    .join(' ')

  const wrap = (control: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      {control}
      {explainer}
    </div>
  )

  switch (capability.kind) {
    case 'native_write':
      return wrap(
        <button
          type="button"
          className={buttonClass}
          onClick={handleExecute}
          disabled={disabled || busy || !onExecute}
          aria-disabled={disabled || busy || !onExecute}
        >
          <i className="ph ph-check-circle" aria-hidden="true" />
          {busy ? 'Working…' : label}
        </button>,
      )

    case 'external_deep_link':
      return wrap(
        <a
          className={buttonClass}
          href={capability.href ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          <i className="ph ph-arrow-square-out" aria-hidden="true" />
          {label}
        </a>,
      )

    case 'copyable_message':
      return wrap(
        <button type="button" className={buttonClass} onClick={handleCopy} disabled={disabled}>
          <i className={`ph ${copied ? 'ph-check' : 'ph-copy'}`} aria-hidden="true" />
          {copied ? 'Copied' : label}
        </button>,
      )

    case 'read_only_guidance':
    case 'informational':
    default:
      // Deliberately not a button. There is no action AllFantasy can take here,
      // and a disabled-looking button would still read as "this should work".
      return (
        <span className="af-cc-cap" style={{ color: 'var(--cc-text-4)' }}>
          <i className={`ph ${capability.icon}`} aria-hidden="true" />
          {capability.label}
        </span>
      )
  }
}

export default CapabilityAction
