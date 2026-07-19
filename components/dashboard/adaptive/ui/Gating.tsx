'use client'

/**
 * Gating primitives — locked cards, the unlock modal, and the honest "no data" state.
 *
 * The design's rule is that a card the user can't access still renders in its final
 * position, blurred behind a lock, rather than disappearing — so the dashboard's shape is
 * the same for every plan and upgrading fills in the blanks instead of rearranging the page.
 *
 * `NoMetric` is the other half of that idea and matters just as much: a card whose data
 * genuinely does not exist yet says so, in place, instead of rendering a plausible-looking
 * zero. This repo has had to remove fabricated dashboard data before (League Buzz, AF Rank,
 * the career counts) — a locked card and an unsourced card must never look alike, because
 * one is an upsell and the other is an empty database.
 */

import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'

// ── Lock overlay ───────────────────────────────────────────────────────────────
export function LockOverlay({ label, onUnlock }: { label: string; onUnlock: () => void }) {
  return (
    <div className="af-lock-overlay">
      <Lock size={16} strokeWidth={2} color="var(--af-violet)" />
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#fff' }}>{label}</div>
      <button type="button" onClick={onUnlock} className="af-btn af-btn-primary"
        style={{ padding: '4px 12px', fontSize: 10.5 }}>
        Unlock
      </button>
    </div>
  )
}

/**
 * Wraps a card so it blurs behind a lock when `locked`.
 *
 * The blur is presentational only — `LockableCard` never receives privileged values to
 * begin with, because the caller passes the already-gated data. Blur is not a security
 * boundary and must not be treated as one; a CSS filter is trivially removed in devtools.
 */
export function LockableCard({
  locked, lockLabel, onUnlock, children, className = 'af-card', style,
}: {
  locked: boolean
  lockLabel: string
  onUnlock: () => void
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  if (!locked) return <div className={className} style={style}>{children}</div>
  return (
    <div style={{ position: 'relative', borderRadius: 'var(--af-r-lg)' }}>
      <div className={`${className} af-locked-body`} style={style} aria-hidden="true">{children}</div>
      <LockOverlay label={lockLabel} onUnlock={onUnlock} />
    </div>
  )
}

// ── Honest empty state ─────────────────────────────────────────────────────────
/**
 * Shown where a metric has no real source yet.
 *
 * `reason` must describe the actual gap ("no scoring history imported for this league")
 * rather than a generic "no data" — the user should be able to tell whether this is
 * something they can fix (import a league, wait for week 1) or something the product
 * hasn't built. `action` surfaces the fix when there is one.
 */
export function NoMetric({
  reason, action, compact = false,
}: {
  reason: string
  action?: { label: string; href?: string; onClick?: () => void }
  compact?: boolean
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 6, textAlign: 'center', padding: compact ? '10px 6px' : '18px 10px',
      minHeight: compact ? 0 : 88,
    }}>
      <div style={{
        fontSize: compact ? 10.5 : 11.5, color: 'var(--af-text-faint)', lineHeight: 1.5, maxWidth: 220,
      }}>
        {reason}
      </div>
      {action && (action.href ? (
        <a href={action.href} style={{ fontSize: 11, color: 'var(--af-cyan)', fontWeight: 700 }}>
          {action.label} →
        </a>
      ) : (
        <button type="button" onClick={action.onClick}
          style={{ fontSize: 11, color: 'var(--af-cyan)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
          {action.label} →
        </button>
      ))}
    </div>
  )
}

// ── Unlock modal ───────────────────────────────────────────────────────────────
export type UnlockRequest = {
  title: string
  body: string
  /** Shown in the "Requires {tier}" eyebrow. */
  tier: string
  primaryLabel: string
  /** Where the primary CTA actually goes. Real checkout / token surfaces, never a fake flip. */
  primaryHref: string
  comparePlansHref?: string
}

export function UnlockModal({ request, onClose }: { request: UnlockRequest | null; onClose: () => void }) {
  if (!request) return null
  return (
    <div
      className="af-adaptive-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="af-unlock-title"
      onClick={onClose}
    >
      <div className="af-adaptive-modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Lock size={18} strokeWidth={2} color="var(--af-violet)" />
          <span style={{
            fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em',
            textTransform: 'uppercase', color: 'var(--af-violet)',
          }}>
            Requires {request.tier}
          </span>
        </div>
        <div id="af-unlock-title" style={{
          fontFamily: "var(--af-font-display, 'Bebas Neue', sans-serif)",
          fontSize: 22, letterSpacing: '.02em', marginBottom: 8,
        }}>
          {request.title}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', lineHeight: 1.55, marginBottom: 18 }}>
          {request.body}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/*
            Routes to the REAL monetisation surface. The design reference flipped a demo
            plan flag here so reviewers could feel the unlock; doing that in the product
            would hand out entitlements client-side, so the CTA navigates to checkout and
            the server remains the only thing that can grant access.
          */}
          <a href={request.primaryHref} className="af-btn af-btn-primary"
            style={{ padding: 11, borderRadius: 9, fontSize: 13, textAlign: 'center' }}>
            {request.primaryLabel}
          </a>
          <a href={request.comparePlansHref ?? '/pricing'} className="af-btn af-btn-ghost"
            style={{ padding: 10, borderRadius: 9, fontSize: 12.5, fontWeight: 600, textAlign: 'center' }}>
            Compare Plans
          </a>
        </div>
        <button type="button" onClick={onClose} style={{
          display: 'block', width: '100%', textAlign: 'center', fontSize: 11.5,
          color: 'var(--af-cyan)', fontWeight: 600, marginTop: 12, background: 'none',
          border: 'none', cursor: 'pointer',
        }}>
          Not now
        </button>
      </div>
    </div>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────────
export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="af-adaptive-toast" role="status" aria-live="polite">{message}</div>
}
