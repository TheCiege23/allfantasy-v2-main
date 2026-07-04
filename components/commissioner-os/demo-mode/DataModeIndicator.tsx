'use client'

import { useEffect, useState } from 'react'
import {
  DATA_MODE_COOKIE_KEY,
  DATA_MODE_LABELS,
  DEFAULT_DATA_MODE,
  normalizeDataMode,
  type CommissionerDataMode,
} from '@/lib/commissioner-os/demo-mode/constants'

const ALL_MODES: CommissionerDataMode[] = ['stub', 'demo', 'live']

function readCookieDataMode(): CommissionerDataMode {
  if (typeof document === 'undefined') return DEFAULT_DATA_MODE
  const match = document.cookie.match(new RegExp(`${DATA_MODE_COOKIE_KEY}=([^;]+)`))
  return normalizeDataMode(match?.[1])
}

export interface DataModeIndicatorProps {
  /**
   * Server-resolved (isSiteAdmin() against the real session, in
   * app/commissioner-os/layout.tsx) — never trust a client-supplied value
   * for this decision. Defaults to false so every existing non-admin call
   * site is unaffected. This only controls whether the *switcher* is
   * visible/usable; it is not the real security boundary — each live.ts's
   * own canAccessLiveDecisionOSData() check (lib/commissioner-os/liveModeAccess.ts)
   * is what actually gates real data, so a client-side attempt to force
   * this prop true would still get the honest placeholder, never real
   * intelligence.
   */
  isAdmin?: boolean
}

/**
 * Deliberately unmissable and deliberately not shown in production — this
 * exists so engineering/QA/design can switch data sources at a glance, not
 * as a control a real customer should ever see. A full page reload on
 * switch is intentional and acceptable here (unlike theme switching,
 * which must be instant for real users); mode changes are rare, dev/QA-
 * only actions, not something worth a reactive Context system for.
 *
 * The one exception: the existing site-admin allowlist (isSiteAdmin(),
 * lib/auth/admin.ts) can still see and use this in production, so that
 * "live" mode can be verified end-to-end without exposing the switcher to
 * real customers. See GATE_OPENING_PLAN.md, Option C.
 */
export function DataModeIndicator({ isAdmin = false }: DataModeIndicatorProps) {
  const [mode, setMode] = useState<CommissionerDataMode>(DEFAULT_DATA_MODE)

  useEffect(() => {
    setMode(readCookieDataMode())
  }, [])

  if (process.env.NODE_ENV === 'production' && !isAdmin) return null

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
