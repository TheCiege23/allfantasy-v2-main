'use client'

import { useEffect } from 'react'

/**
 * Opens the folded section a jump link points at (2026-11-14). The hub's chips and its in-page links
 * ("Member activity", "Invite managers") are plain `#ch-…` anchors; with the sections folded, landing on
 * a closed fold would show only its title. This opens the fold that holds the target, then scrolls to it.
 * Handles the page loading with a hash, a hash change, and a click on the hash it is already on.
 */
export function openFoldFor(hash: string, doc: Document = document): boolean {
  const id = hash.replace(/^#/, '')
  if (!id) return false
  const target = doc.getElementById(id)
  if (!target) return false
  const fold = target.closest('details.af-ch-fold') as HTMLDetailsElement | null
  if (fold && !fold.open) fold.open = true
  target.scrollIntoView?.({ block: 'start' })
  return true
}

export function HubFoldOpener() {
  useEffect(() => {
    if (window.location.hash) openFoldFor(window.location.hash)
    const onHash = () => openFoldFor(window.location.hash)
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#ch-"]') as HTMLAnchorElement | null
      if (a) openFoldFor(a.getAttribute('href') ?? '')
    }
    window.addEventListener('hashchange', onHash)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('click', onClick)
    }
  }, [])
  return null
}
