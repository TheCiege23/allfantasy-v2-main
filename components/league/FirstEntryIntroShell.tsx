'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Shared frame for the league-format first-entry intros (Survivor, Big Brother, IDP, Devy/C2C).
 *
 * Each intro is a full-screen modal over the league page. They used to be a centred, NON-scrolling
 * card (header + 16:9 video + tips + buttons) whose only exits were the bottom button and the
 * video's `ended` event. On a phone the card is taller than the screen, so the bottom button sat
 * off-screen; and Android in-app browsers block muted autoplay, so `ended` never fired. That left
 * invitees under a layer they could not get out of (the Guillotine intro had the same bug — see
 * components/guillotine/GuillotineFirstEntryModal.tsx). This frame scrolls, keeps a close button
 * pinned on screen, closes on Escape and on a backdrop tap, and remembers "seen" in memory when
 * localStorage throws, so a WebView with storage off does not show it on every visit.
 */

const seenThisPageLoad = new Set<string>()

export function useFirstEntryIntro({
  storageKey,
  enabled,
  forceReplay = false,
  onClose,
}: {
  storageKey: string
  enabled: boolean
  forceReplay?: boolean
  onClose: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setVisible(false)
      return
    }
    if (forceReplay) {
      setVisible(true)
      return
    }
    if (seenThisPageLoad.has(storageKey)) {
      setVisible(false)
      return
    }
    try {
      setVisible(!window.localStorage.getItem(storageKey))
    } catch {
      setVisible(true)
    }
  }, [enabled, storageKey, forceReplay])

  const dismiss = useCallback(() => {
    seenThisPageLoad.add(storageKey)
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      /* remembered in memory above */
    }
    setVisible(false)
    onClose()
  }, [storageKey, onClose])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, dismiss])

  return { visible, dismiss }
}

export function FirstEntryIntroShell({
  ariaLabel,
  onDismiss,
  cardClassName,
  closeTestId,
  children,
}: {
  ariaLabel: string
  onDismiss: () => void
  /** Border/background classes for the card; layout classes are supplied here. */
  cardClassName: string
  closeTestId?: string
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close intro and enter league"
        className="fixed right-3 z-[101] flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        data-testid={closeTestId}
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      <div
        className="flex min-h-full items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onDismiss()
        }}
      >
        <div className={`relative w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl ${cardClassName}`}>{children}</div>
      </div>
    </div>
  )
}
