import Link from 'next/link'

/**
 * Dashboard v2 section header — the 3px accent tab, the mono uppercase label,
 * the right-aligned mono counter, and two optional affordances: a "?" that
 * explains what the section is and is not, and a trailing link to the full
 * surface behind it.
 *
 * Every module in the v2 handoff is introduced by this same header, so it is one
 * component rather than a shape re-typed per section. The counter is deliberately
 * a `string | null`: a section with nothing to count omits it, instead of
 * rendering "0 ITEMS", which reads as a measured zero rather than as an absence.
 *
 * ⚠ THE "?" IS `<details>`, NOT A HOVER TOOLTIP. `title=` and CSS `:hover` both
 * need a pointer, and this screen ships to a 390px phone where there isn't one —
 * a caveat that only appears on hover is a caveat mobile users never read, which
 * is the whole reason it exists. `<details>` opens on tap and on Enter, is
 * focusable and announced without any ARIA of ours, and needs no client JS, so
 * the header stays a server component.
 */
export function SectionHeader({
  label,
  counter = null,
  id,
  hint = null,
  hintLabel = 'What this covers',
  action = null,
}: {
  label: string
  counter?: string | null
  id?: string
  /** The caveat behind the "?". Omitted entirely when there is nothing to warn about. */
  hint?: string | null
  /** Accessible name for the "?" — "?" alone is not one. */
  hintLabel?: string
  /** Trailing link to the fuller surface. `href` must be a route that exists. */
  action?: { href: string; label: string } | null
}) {
  return (
    <div className="af-d2-sec-head" id={id}>
      <span className="af-d2-sec-tab" aria-hidden />
      <h2 className="af-d2-sec-label af-num">{label}</h2>

      {hint ? (
        <details className="af-d2-sec-hint">
          {/*
            The summary is the "?" itself. `aria-label` carries the real name
            because the visible text is a single punctuation mark, and the marker
            is removed in CSS so it renders as a circle rather than a disclosure
            triangle.
          */}
          <summary className="af-d2-sec-hint-btn af-num" aria-label={hintLabel}>
            ?
          </summary>
          <p className="af-d2-sec-hint-body">{hint}</p>
        </details>
      ) : null}

      {counter ? <span className="af-d2-sec-count af-num">{counter}</span> : null}

      {/*
        `Link` for an in-app route, a plain anchor for a same-page hash. Next's
        Link on a bare "#id" pushes a history entry and re-runs the router for a
        scroll the browser already does natively.
      */}
      {action ? (
        action.href.startsWith('#') ? (
          <a className="af-d2-sec-link af-num" href={action.href}>
            {action.label} <span aria-hidden>→</span>
          </a>
        ) : (
          <Link className="af-d2-sec-link af-num" href={action.href}>
            {action.label} <span aria-hidden>→</span>
          </Link>
        )
      ) : null}
    </div>
  )
}

export default SectionHeader
