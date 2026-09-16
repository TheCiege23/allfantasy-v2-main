'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Per-tab memory for the /core home: which disclosures the reader opened.
 *
 * WHY THIS IS NEEDED WHEN SCROLL RESTORATION IS NOT. On Back, Next rebuilds the home from its
 * router cache — the markup and the position come back on their own. Component state does not: the
 * home unmounted when the reader left it (React 18 keeps nothing for an unmounted tree), so a
 * disclosure opened before leaving comes back closed. Its state has to live somewhere that outlives
 * the component.
 *
 * WHY sessionStorage AND NOT THE URL OR THE DATABASE. This is "put me back where I was when I press
 * Back", not a preference. It should survive a round trip to a league screen and die with the tab;
 * a new tab starting fresh is correct. The scope filter IS in the URL (`?scope=`), because a filter
 * is part of what the page shows and belongs in a link someone can share; an open disclosure is not.
 *
 * ⚠ EVERY ACCESS IS GUARDED. Storage throws in private windows, with site data blocked, and when
 * full; any of those must leave the page working exactly as it would with no memory at all.
 */

const PREFIX = 'af-core-home:'

export function readViewState(key: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function writeViewState(key: string, value: string | null): void {
  try {
    if (value == null) window.sessionStorage.removeItem(PREFIX + key)
    else window.sessionStorage.setItem(PREFIX + key, value)
  } catch {
    // Unavailable storage means no memory, never a broken page.
  }
}

/**
 * A disclosure whose open state survives navigating away and back in the same tab.
 *
 * The server always renders it CLOSED and the stored state is applied after hydration, so the
 * server and client first paints agree. `scope` separates the same card under different filters:
 * "show all" opened on the NFL view is not a claim about the Sleeper view.
 */
export function usePersistentDisclosure(card: string, scope: string): [boolean, (open: boolean) => void] {
  const key = `expanded:${scope}:${card}`
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(readViewState(key) === '1')
  }, [key])
  const update = useCallback(
    (next: boolean) => {
      setOpen(next)
      writeViewState(key, next ? '1' : null)
    },
    [key],
  )
  return [open, update]
}
