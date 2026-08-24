import Link from "next/link"
import type { ReactNode } from "react"
import "./legal-page.css"

const LEGAL_LAST_UPDATED = "March 2026"

/**
 * The one shell every legal route renders through — handoff 17a's build note
 * ("same page shell reused across all legal pages: back link, title, last-updated
 * stamp, footer nav row"), which this component already was. Restyling it here
 * moves all eight legal routes to the new design at once.
 *
 * ⚠ THE LAST-UPDATED STAMP IS ONE MAINTAINED CONSTANT, NOT A PER-PAGE STRING.
 * 17a requires it to be "a real, maintained field". Every page reads
 * LEGAL_LAST_UPDATED from here, so the eight routes cannot drift apart — and a
 * page that changes without this constant changing is a bug the single source
 * makes visible rather than one that hides on whichever page nobody reopened.
 */

interface LegalPageShellProps {
  title: string
  description?: string
  children: ReactNode
  backHref?: string
  backLabel?: string
  /** Rendered after the body, before the footer nav — 17b's data-deletion panel. */
  aside?: ReactNode
}

export default function LegalPageShell({
  title,
  description,
  children,
  backHref = "/",
  backLabel = "Back to Home",
  aside,
}: LegalPageShellProps) {
  return (
    <main className="af-legal">
      <div className="af-legal-inner">
        <Link href={backHref} className="af-legal-back">
          ← {backLabel}
        </Link>

        <h1 className="af-legal-title">{title}</h1>
        {description ? <p className="af-legal-stamp">{description}</p> : null}

        <div className="af-legal-body">{children}</div>

        {aside}

        {/*
          ⚠ THE FOOTER NAV IS PART OF THE SHELL AND MUST STAY COMPLETE. Several of
          these routes are reachable from an app-store listing or a Stripe receipt
          rather than from inside the product, so this row is the only navigation
          a reader has. 17a names all five destinations.
        */}
        <nav className="af-legal-foot" aria-label="Legal">
          <Link href="/disclaimer">Disclaimer</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/data-deletion">Data Deletion</Link>
          <Link href="/" data-home="true">
            Home
          </Link>
        </nav>
      </div>
    </main>
  )
}

/* ── Reusable content blocks ──────────────────────────────────────────
 * The legal COPY stays in each page — it is legal-owned text and belongs where
 * it can be reviewed as one document. These are the structural pieces both 17a
 * and 17b draw, so the two pages cannot invent different-looking callouts for the
 * same job.
 */

/** Two-up (or n-up) row of bordered sub-boxes, e.g. 2.1 beside 2.2. */
export function LegalGrid({ children }: { children: ReactNode }) {
  return <div className="af-legal-grid">{children}</div>
}

export function LegalBox({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <div className="af-legal-box">
      {eyebrow ? <span className="af-legal-eyebrow">{eyebrow}</span> : null}
      {children}
    </div>
  )
}

/**
 * A highlighted line that must not read as body text.
 *
 * 17a's copy contract calls out two of these by name — the "we never request or
 * store your passwords" trust anchor and "we do not sell your personal
 * information" — and requires them to stay visually distinct rather than being
 * buried in a paragraph.
 */
export function LegalCallout({
  tone = "accent",
  mark,
  title,
  children,
}: {
  tone?: "accent" | "good" | "warn" | "neutral"
  mark?: string
  title?: string
  children: ReactNode
}) {
  return (
    <div className="af-legal-callout" data-tone={tone === "neutral" ? undefined : tone}>
      {mark ? (
        <span className="af-legal-callout-mark" aria-hidden>
          {mark}
        </span>
      ) : null}
      <div>
        {title ? <strong className="af-legal-callout-title">{title}</strong> : null}
        {children}
      </div>
    </div>
  )
}

/** The scannable policy grid — 17b. Each cell links to its full clause. */
export function LegalPolicyGrid({
  items,
}: {
  items: { name: string; summary: string; href: string }[]
}) {
  return (
    <div className="af-legal-policies">
      {items.map((item) => (
        <a key={item.name} href={item.href} className="af-legal-policy">
          <span className="af-legal-policy-name">{item.name}</span>
          <span className="af-legal-policy-sub">{item.summary}</span>
        </a>
      ))}
    </div>
  )
}

export { LEGAL_LAST_UPDATED }
