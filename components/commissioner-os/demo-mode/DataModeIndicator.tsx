'use client'

import { useEffect, useState } from 'react'
import {
  DATA_MODE_COOKIE_KEY,
  DATA_MODE_LABELS,
  DEFAULT_DATA_MODE,
  normalizeDataMode,
  type CommissionerDataMode,
} from '@/lib/commissioner-ui/demo-mode/constants'

function readCookieDataMode(): CommissionerDataMode {
  if (typeof document === 'undefined') return DEFAULT_DATA_MODE
  const match = document.cookie.match(new RegExp(`${DATA_MODE_COOKIE_KEY}=([^;]+)`))
  return normalizeDataMode(match?.[1])
}

export interface DataModeIndicatorProps {
  /**
   * The modes THIS viewer may select, decided server-side by the layout — never inferred
   * here. An empty or single-entry list renders nothing, because a picker with one option
   * is not a choice.
   */
  available?: CommissionerDataMode[]
}

/**
 * The data-source picker.
 *
 * 🛑 THIS COMPONENT USED TO RETURN `null` IN PRODUCTION, AND IT IS THE ONLY THING THAT WRITES
 * THE MODE COOKIE. The two facts together meant production had no way to reach live data at
 * all: the cookie was never set, so every request fell through to the default, which was
 * `'demo'`. A fully configured live pipeline sat behind a control that had been compiled out.
 *
 * It is now gated by AUDIENCE rather than by build: the layout decides who may switch, and
 * passes the permitted modes in. Demo stays available to the people who need it (sales
 * demos, screenshots, QA) without being imposed on customers, and `stub` is refused in
 * production by `normalizeDataMode` regardless of what this component offers — the cookie is
 * viewer-editable, so the UI is not the enforcement point.
 *
 * A full page reload on switch is intentional (unlike theme switching, which must be
 * instant): every module is a Server Component reading the cookie at request time, so the
 * reload is what actually applies the change.
 */
export function DataModeIndicator({ available = [] }: DataModeIndicatorProps) {
  const [mode, setMode] = useState<CommissionerDataMode>(DEFAULT_DATA_MODE)

  useEffect(() => {
    setMode(readCookieDataMode())
  }, [])

  if (available.length < 2) return null

  function handleChange(next: CommissionerDataMode) {
    document.cookie = `${DATA_MODE_COOKIE_KEY}=${next}; path=/; max-age=31536000`
    window.location.reload()
  }

  return (
    <label
      className="focus-ring flex items-center gap-1 rounded-[var(--radius-standard)] px-2 py-1 text-xs font-medium"
      style={{
        background: 'var(--status-opportunity-bg)',
        color: 'var(--status-opportunity-text)',
        border: '1px solid var(--status-opportunity-border)',
      }}
    >
      <span className="sr-only">Data mode</span>
      <select
        value={mode}
        onChange={(event) => handleChange(normalizeDataMode(event.target.value))}
        className="bg-transparent focus:outline-none"
        aria-label="Data mode"
      >
        {available.map((m) => (
          <option key={m} value={m}>
            {DATA_MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  )
}
