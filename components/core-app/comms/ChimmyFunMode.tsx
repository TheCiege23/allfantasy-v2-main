'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Fun mode — Chimmy answers with personality and a few emojis (lib/chimmy/funMode.ts holds the
 * rules the model gets). Off by default. Kept per user in localStorage, so it survives a reload and
 * a new drawer conversation; same price either way.
 */

const storageKey = (userId: string | null | undefined) => `af:comms:chimmy-fun-mode:${userId || 'anon'}`

export function useChimmyFunMode(userId: string | null | undefined): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState(false)

  useEffect(() => {
    try {
      setOn(localStorage.getItem(storageKey(userId)) === '1')
    } catch {
      setOn(false)
    }
  }, [userId])

  const choose = useCallback(
    (next: boolean) => {
      setOn(next)
      try {
        localStorage.setItem(storageKey(userId), next ? '1' : '0')
      } catch {
        /* Private mode or storage quota: the choice still holds for this drawer. */
      }
    },
    [userId],
  )

  return [on, choose]
}

export function ChimmyFunModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="af-cm-chip"
      data-on={value}
      aria-pressed={value}
      disabled={disabled}
      title={value ? 'Fun mode is on: answers come with personality and a few emojis.' : 'Turn on Fun mode for answers with personality and a few emojis.'}
      onClick={() => onChange(!value)}
    >
      Fun 🎉
    </button>
  )
}
