import type { ReactNode } from 'react'
import type { CanAccessResult } from '@/lib/access/canAccess'

/**
 * Renders premium content, or a locked preview, based on a **server-resolved**
 * access decision.
 *
 * The `access` prop must come from `canAccessForUser` on the server (see
 * `loadCommandCenterViewModel`). This component intentionally does not call
 * `useEntitlements` or any client hook: a client-only gate is a display
 * convention, not a control — anyone can flip it in devtools. Server-resolved
 * access means the locked branch is the real branch.
 *
 * Two locked modes:
 *
 *  - `preview` — blurs real children behind an unlock overlay. Use only when
 *    the underlying data is genuinely non-sensitive and the blur is teasing
 *    presentation, not hiding a secret. The children ARE sent to the client.
 *  - `placeholder` (default) — never renders children at all. Use whenever the
 *    gated content contains data a free user should not receive.
 *
 * Default is `placeholder` because the safe choice should be the one you get by
 * not thinking about it.
 */
export interface EntitlementGateProps {
  access: CanAccessResult
  children: ReactNode
  /** Shown in the locked overlay. */
  title?: string
  body?: string
  /**
   * `preview` blurs the real children (they reach the browser).
   * `placeholder` never renders them.
   */
  lockedMode?: 'preview' | 'placeholder'
  /** Height reserved for the placeholder so layout does not jump. */
  minHeight?: number
}

export function EntitlementGate({
  access,
  children,
  title,
  body,
  lockedMode = 'placeholder',
  minHeight = 180,
}: EntitlementGateProps) {
  if (access.allowed) return <>{children}</>

  const resolvedTitle =
    title ??
    (access.reason === 'requires-signup'
      ? 'Create a free account to unlock this'
      : 'Included with ' + (access.requiredPlanLabel ?? 'a paid plan'))

  const resolvedBody =
    body ??
    (access.reason === 'requires-signup'
      ? 'Ranked intelligence, projections, and comparisons are available once you have an account.'
      : 'Ranked intelligence, projections, and comparisons are part of ' +
        (access.requiredPlanLabel ?? 'the paid tier') +
        '. Your official league data stays available on the free tier.')

  const overlay = (
    <div className="af-cc-gate__overlay">
      <i className="ph ph-lock-simple" style={{ fontSize: 22, color: 'var(--cc-brand-bright)' }} aria-hidden="true" />
      <div className="af-cc-gate__title">{resolvedTitle}</div>
      <p className="af-cc-gate__body">{resolvedBody}</p>
      {access.ctaHref ? (
        <a className="af-cc-action af-cc-action--primary" href={access.ctaHref}>
          {access.ctaLabel || 'Unlock'}
        </a>
      ) : null}
    </div>
  )

  if (lockedMode === 'preview') {
    return (
      <div className="af-cc-gate">
        <div className="af-cc-gate__preview" aria-hidden="true">
          {children}
        </div>
        {overlay}
      </div>
    )
  }

  return (
    <div className="af-cc-gate af-cc-panel" style={{ minHeight, position: 'relative', padding: 0 }}>
      {overlay}
    </div>
  )
}

export default EntitlementGate
