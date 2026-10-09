'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { leagueActionsCopy } from '@/lib/core-app/leagueActionsCopy'

/**
 * The search, within thumb reach (2026-10-08). On a phone the Finder's search sits at the top of a
 * long card; once it scrolls away this dock appears above the tab bar, and one tap brings the
 * search back and puts the keyboard up. It hides again while the real search is on screen — two
 * search boxes at once would be one too many.
 *
 * It shares the sticky action bar's lane (`--af-fab-bottom`, clear of the chat button), so the
 * screen renders one or the other, never both: in league mode the bar's next move wins.
 */
const SEARCH_SELECTOR = '.af-pf-rail .af-pf-search-wrap:not(.af-pf-search-wrap--compare)'

export function PhoneSearchDock() {
  const { language } = useOptionalLanguage()
  const t = leagueActionsCopy(language)
  const [searchVisible, setSearchVisible] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = document.querySelector(SEARCH_SELECTOR)
    if (!el) return
    const io = new IntersectionObserver((entries) => setSearchVisible(entries.some((e) => e.isIntersecting)), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const toSearch = () => {
    const wrap = document.querySelector(SEARCH_SELECTOR)
    const input = wrap?.querySelector<HTMLInputElement>('input[name="q"]') ?? null
    wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Focus without a second jump; iOS only raises the keyboard for a focus inside the tap itself.
    input?.focus({ preventScroll: true })
  }

  return (
    <div className="af-pf-dock" data-hidden={searchVisible ? 'true' : 'false'} aria-hidden={searchVisible ? true : undefined}>
      <button type="button" className="af-pf-dock-btn" onClick={toSearch} tabIndex={searchVisible ? -1 : 0}>
        <span aria-hidden className="af-pf-dock-icon">
          ⌕
        </span>
        {t.dockSearch}
      </button>
    </div>
  )
}

export default PhoneSearchDock
