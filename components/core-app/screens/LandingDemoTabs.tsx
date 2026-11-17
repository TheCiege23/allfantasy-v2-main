'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * The landing page's "See it before you sign up" tabs.
 *
 * ⚠ EVERY PANEL IS IN THE SERVER HTML. Inactive panels get `hidden`, not unmounted, so the trade
 * values, the demo league and the league types are all in the document a crawler or a no-JS
 * reader receives. The panels themselves are rendered by the server component (LandingV4) and
 * passed in as nodes; this component only owns which one is showing.
 */
export function LandingDemoTabs({
  label,
  tabs,
}: {
  label: string
  tabs: { id: string; label: string; panel: ReactNode }[]
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? '')
  const base = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + tabs.length) % tabs.length
    setActive(tabs[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className="af-lp-demo-tabs">
      <div className="af-lp-demo-tablist" role="tablist" aria-label={label}>
        {tabs.map((t, i) => {
          const selected = t.id === active
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className="af-lp-demo-tab"
              data-active={selected ? 'true' : undefined}
              data-testid={`landing-demo-tab-${t.id}`}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          className="af-lp-demo-panel"
          data-testid={`landing-demo-panel-${t.id}`}
        >
          {t.panel}
        </div>
      ))}
    </div>
  )
}
