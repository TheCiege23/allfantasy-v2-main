'use client'

import { useEffect, useState } from 'react'

/**
 * `navigator.onLine`, tracked — null until mounted.
 *
 * ⚠ NULL BEFORE MOUNT RATHER THAN A GUESS, for the same reason the freshness
 * clock is null before mount: the server cannot know the reader's network, and
 * seeding `true` would both risk a hydration mismatch and assert something we
 * have not observed. `resolveConnectionState` treats null as "no opinion".
 *
 * ⚠ AND THE VALUE IS ONLY EVER TRUSTED IN THE NEGATIVE — see `ConnectionInputs.online`.
 * `true` here means an interface is up, which is equally true on hotel wifi that
 * has captured the connection. The consecutive-failure count is what actually
 * detects a dead feed; this only catches the case the browser is certain about.
 */
export function useOnlineStatus(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    const read = () => setOnline(navigator.onLine)
    read()
    window.addEventListener('online', read)
    window.addEventListener('offline', read)
    return () => {
      window.removeEventListener('online', read)
      window.removeEventListener('offline', read)
    }
  }, [])

  return online
}
