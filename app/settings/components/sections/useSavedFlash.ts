"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * A short-lived "Saved" confirmation for a settings form.
 *
 * Profile and Preferences saved silently until 2026-10-02: the button read
 * "Saving…" and then went back to "Save", which is exactly what a failed click
 * looks like. `flash()` after a successful save shows the confirmation; it clears
 * itself after `ms`, and `clear()` drops it the moment the user edits again so a
 * stale "Saved" never sits beside unsaved changes.
 */
export function useSavedFlash(ms = 4000) {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const id = window.setTimeout(() => setSaved(false), ms)
    return () => window.clearTimeout(id)
  }, [saved, ms])

  const flash = useCallback(() => setSaved(true), [])
  const clear = useCallback(() => setSaved(false), [])
  return { saved, flash, clear }
}
