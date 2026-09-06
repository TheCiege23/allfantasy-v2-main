"use client"

import { useState, type ReactNode } from "react"

type Props = {
  label: string
  children: ReactNode
  side?: "bottom" | "top"
}

/**
 * Visual tooltip for icon-only top-bar buttons. The buttons already carry
 * `title`/`aria-label` for screen readers — this only fixes the sighted case,
 * where the native `title` tooltip is slow to appear and never shows on touch,
 * so a mobile user has no way to tell icons apart without tapping each one.
 */
export function IconTooltip({ label, children, side = "bottom" }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium shadow-lg ${
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
          }`}
          style={{
            background: "var(--panel2)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        >
          {label}
        </span>
      )}
    </span>
  )
}
