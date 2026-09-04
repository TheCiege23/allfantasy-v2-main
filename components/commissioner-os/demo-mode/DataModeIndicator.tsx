'use client'

import { useEffect, useState } from 'react'
import {
  DATA_MODE_COOKIE_KEY,
  DATA_MODE_LABELS,
  DEFAULT_DATA_MODE,
  normalizeDataMode,
  type CommissionerDataMode,
} from '@/lib/commissioner-ui/demo-mode/constants'

const ALL_MODES: CommissionerDataMode[] = ['stub', 'demo', 'live']

function readCookieDataMode(): CommissionerDataMode {
  if (typeof document === 'undefined') return DEFAULT_DATA_MODE
  const match = document.cookie.match(new RegExp(`${DATA_MODE_COOKIE_KEY}=([^;]+)`))
  return normalizeDataMode(match?.[1])
}

/**
 * Deliberately unmissable and deliberately not shown in production — this
 * exists so engineering/QA/design can switch data sources at a glance, not
 * as a control a real customer should ever see. A full page reload on
 * switch is intentional and acceptable here (unlike theme switching,
 * which must be instant for real users); mode changes are rare, dev/QA-
 * only actions, not something worth a reactive Context system for.
 */
export function DataModeIndicator() {
  const [mode, setMode] = useState<CommissionerDataMode>(DEFAULT_DATA_MODE)

  useEffect(() => {
    setMode(readCookieDataMode())
  }, [])

  if (process.env.NODE_ENV === 'production') return null

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
        {ALL_MODES.map((m) => (
          <option key={m} value={m}>
            {DATA_MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  )
}
