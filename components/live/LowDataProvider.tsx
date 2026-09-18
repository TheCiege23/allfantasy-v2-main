'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  readConnectionSignals,
  resolveLowDataMode,
  type LowDataDecision,
} from '@/lib/live/lowDataMode'

const STORAGE_KEY = 'af:live:low-data'

/**
 * Low-data mode, shared down the live screens.
 *
 * ⚠ CONTEXT RATHER THAN A PROP, BECAUSE THE IMAGES ARE THE POINT. Roughly ten
 * render sites on `/core/live` draw a headshot or a team crest, several of them
 * inside sub-components that take no display props today. Threading a boolean
 * through all of them is how one gets missed — and a low-data mode that still
 * fetches four headshots is not low-data, it just says it is.
 */
const LowDataContext = createContext<LowDataDecision>({ lowData: false, source: 'default' })

/** Read-only access for any descendant that renders an image or an animation. */
export function useLowData(): LowDataDecision {
  return useContext(LowDataContext)
}

/**
 * Owns the decision: the reader's stored choice, the browser's signals, and the
 * setter the toggle calls.
 *
 * ⚠ DEFAULTS TO OFF UNTIL MOUNTED, AND THAT IS A HYDRATION RULE, NOT A PREFERENCE.
 * Neither `localStorage` nor `navigator.connection` exists on the server, so the
 * first client render must match the server's — the same reason the freshness
 * clock starts null. The real decision lands one effect later.
 */
export function useLowDataController() {
  const [override, setOverrideState] = useState<boolean | null>(null)
  const [signals, setSignals] = useState(() => ({
    saveData: null as boolean | null,
    effectiveType: null as string | null,
  }))
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setSignals(readConnectionSignals())
    /*
     * ⚠ localStorage CAN THROW, NOT JUST RETURN NULL — a private window, blocked
     * site data, or an embedded webview all raise on access. A stored display
     * preference must never be able to take the scoreboard down with it.
     */
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === 'on') setOverrideState(true)
      else if (raw === 'off') setOverrideState(false)
    } catch {
      // No stored choice we can read; auto-detection still applies.
    }
  }, [])

  const setOverride = useCallback((next: boolean | null) => {
    setOverrideState(next)
    try {
      if (next === null) window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // The choice still applies for this session; it just will not survive a reload.
    }
  }, [])

  const decision = useMemo<LowDataDecision>(
    () =>
      mounted
        ? resolveLowDataMode({ override, signals })
        : { lowData: false, source: 'default' },
    [mounted, override, signals],
  )

  return { decision, override, setOverride }
}

export function LowDataProvider({
  decision,
  children,
}: {
  decision: LowDataDecision
  children: React.ReactNode
}) {
  return <LowDataContext.Provider value={decision}>{children}</LowDataContext.Provider>
}

/**
 * The control itself.
 *
 * ⚠ IT SAYS WHY IT IS ON. When the browser turned it on, a reader who did not
 * choose it deserves to know what happened to their pictures — otherwise the
 * screen just looks broken on a slow connection, which is precisely when they can
 * least afford to go looking.
 */
export function LowDataToggle({
  decision,
  onChange,
  className,
}: {
  decision: LowDataDecision
  onChange: (next: boolean | null) => void
  className?: string
}) {
  const { lowData, source } = decision
  return (
    <button
      type="button"
      className={className}
      onClick={() => onChange(!lowData)}
      aria-pressed={lowData}
      title={
        source === 'connection'
          ? 'Low-data mode turned itself on for your connection. Tap to override.'
          : 'Fewer images, no animation, slower refresh.'
      }
    >
      {lowData ? 'Low data · on' : 'Low data'}
    </button>
  )
}
