'use client'

import { useState } from 'react'

/**
 * The `?` beside a figure, and the sentence behind it.
 *
 * A copy of the shell's HelpDot rather than an import: the shell does not
 * export it, and this screen also renders at /players/{slug} OUTSIDE the shell,
 * where af-core-shell.css — and its `.af-help-*` rules — never loads. The
 * styles live in af-player-finder.css under their own prefix for that reason.
 *
 * Click-to-open rather than hover-only, so it works on a phone.
 */
export function HelpDot({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="af-pf-help">
      <button
        type="button"
        className="af-pf-help-dot"
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open ? (
        <span className="af-pf-help-body" role="tooltip">
          <b>{title}</b>
          {body}
        </span>
      ) : null}
    </span>
  )
}

export default HelpDot
