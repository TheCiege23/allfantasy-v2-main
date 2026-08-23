'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

// af-core.css carries the .af-core token layer (--surface, --line, --accent,
// --good, --warn, --bad …) that every rule in af-recovery.css reads. These
// screens render standalone at /forgot-password, /reset-password and /verify —
// outside AfCoreShell — so without this import the token layer is simply absent
// and every var() falls through to app/globals.css's unrelated values or to
// nothing. Same failure and same fix as PricingV4, AuthV4 and LandingV4, each of
// which carries the equivalent note. Must precede af-recovery.css so the tokens
// exist before use.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-recovery.css'

/**
 * Shared chrome for handoffs 16a (password reset) and 16b (verify email).
 *
 * ⚠ THE ROOT ELEMENT MUST CARRY `af-core` AS WELL AS `af-rc`. af-core.css
 * declares the palette on the `.af-core` SCOPE rather than at :root — deliberately,
 * so a handoff cannot repaint the rest of the product — so importing the
 * stylesheet without also naming the class leaves every var() in af-recovery.css
 * resolving to nothing. Both halves are applied here, once, which is why the
 * screens below compose this shell instead of opening their own root div.
 */

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'neutral'

export function RecoveryShell({ children }: { children: ReactNode }) {
  return (
    <div className="af-core af-rc">
      <div className="af-rc-brand">
        <Link href="/" className="af-rc-home">
          <Crest />
          <span className="af-rc-wordmark">AllFantasy</span>
        </Link>
      </div>
      {children}
    </div>
  )
}

/** The AF crest, matching the lockup on the pricing and landing navs. */
export function Crest({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * (30 / 28)}
      viewBox="0 0 28 30"
      aria-hidden
      focusable="false"
    >
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fill="var(--accent)"
        style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}
      >
        AF
      </text>
    </svg>
  )
}

/**
 * One state card.
 *
 * `tone` drives the card border, the eyebrow colour and the icon tile together,
 * so a screen names its state once. The handoff outlines the card only on the
 * three states that carry a verdict — done, bad link, send failed — which is why
 * 'accent' and 'neutral' deliberately leave the border on --line.
 */
export function RecoveryCard({
  eyebrow,
  tone = 'accent',
  align = 'center',
  withCrest = false,
  children,
}: {
  eyebrow?: string
  tone?: Tone
  align?: 'center' | 'left'
  withCrest?: boolean
  children: ReactNode
}) {
  const cardTone = tone === 'good' || tone === 'warn' || tone === 'bad' ? tone : undefined

  const eyebrowEl = eyebrow ? (
    <span className="af-rc-eyebrow af-label" data-tone={cardTone}>
      {eyebrow}
    </span>
  ) : null

  return (
    <section className="af-rc-card" data-tone={cardTone} data-align={align}>
      {withCrest && eyebrowEl ? (
        <div className="af-rc-eyebrow-row">
          <Crest size={26} />
          {eyebrowEl}
        </div>
      ) : (
        eyebrowEl
      )}
      {children}
    </section>
  )
}

export function RecoveryIcon({ tone = 'accent', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className="af-rc-icon" data-tone={tone === 'accent' ? undefined : tone}>
      {children}
    </div>
  )
}

export function RecoveryTitle({ children }: { children: ReactNode }) {
  return <h1 className="af-rc-title">{children}</h1>
}

export function RecoverySub({ children }: { children: ReactNode }) {
  return <p className="af-rc-sub">{children}</p>
}

export function RecoveryNote({ children }: { children: ReactNode }) {
  return <p className="af-rc-note">{children}</p>
}

/**
 * The inline alert used above a form (16a step 3) and as the body of the
 * rate-limited / send-failed cards (16b states 3 and 4).
 *
 * role="alert" so a screen reader announces a validation failure the user did not
 * scroll to — these appear above the fold of the card but after the user's focus
 * has already moved into the fields.
 */
export function RecoveryAlert({
  tone = 'bad',
  mark,
  title,
  body,
  slim = false,
}: {
  tone?: 'bad' | 'warn'
  mark?: ReactNode
  title: ReactNode
  body?: ReactNode
  slim?: boolean
}) {
  return (
    <div
      className={slim ? 'af-rc-alert af-rc-alert--slim' : 'af-rc-alert'}
      data-tone={tone === 'warn' ? 'warn' : undefined}
      role="alert"
    >
      {mark ? <span className="af-rc-alert-mark">{mark}</span> : null}
      <div>
        <p className="af-rc-alert-title">{title}</p>
        {body ? <p className="af-rc-alert-body">{body}</p> : null}
      </div>
    </div>
  )
}

/** The "checking your reset session…" strip (16a state 6). */
export function RecoveryChecking({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="af-rc-checking" role="status" aria-live="polite">
      <span className="af-rc-spinner" aria-hidden />
      <div>
        <p className="af-rc-checking-title">{title}</p>
        {sub ? <p className="af-rc-checking-sub">{sub}</p> : null}
      </div>
    </div>
  )
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Drawn here rather than pulled from lucide so the stroke weight matches the
 * handoff's 64px tiles, where lucide's default 2px reads thin.
 */

export function MailGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m3.5 6.5 8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function CheckGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="m4.5 12.5 5 5 10-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function WarnGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        d="M12 3.5 21.5 20h-19L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  )
}

export function BangGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M12 5v9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" />
    </svg>
  )
}

export function ShieldGlyph() {
  return (
    <svg width="26" height="28" viewBox="0 0 24 26" fill="none" aria-hidden focusable="false">
      <path
        d="M12 1.5 22 5v9c0 5.5-4.2 9.1-10 10.7C6.2 23.1 2 19.5 2 14V5l10-3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function EyeGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      {off ? <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : null}
    </svg>
  )
}
