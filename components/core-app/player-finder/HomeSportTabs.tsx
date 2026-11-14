'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { searchBoxCopy } from '@/lib/core-app/finderSearchCopy'
import { homeSportTabs, type HomeSport } from '@/lib/core-app/finderHomeSports'
import '@/components/core-app/primitives/af-primitives.css'

/**
 * One tab per sport the finder's leagues are in, over the "My players" home (finderHomeSports.ts).
 * Links rather than buttons: each tab is a real `?sport=` page the server reads, so it works before
 * hydration and the back button walks the sports. Styled as the shared FilterChips pill row.
 */
export function HomeSportTabs({ sports, active, leagueId = null }: { sports: readonly HomeSport[]; active: string | null; leagueId?: string | null }) {
  const { language } = useOptionalLanguage()
  const t = searchBoxCopy(language)
  const tabs = homeSportTabs(sports, active, { leagueId })
  const rowRef = useRef<HTMLElement>(null)
  /*
   * On a phone the row scrolls sideways (data-scroll="phone"), so a tab late in the row — NCAAB, say —
   * opened selected but off-screen. Bring the active one into the row's view. The ROW's scrollLeft only:
   * scrollIntoView would also scroll the page.
   */
  useEffect(() => {
    const row = rowRef.current
    const on = row?.querySelector<HTMLElement>('[data-active="true"]')
    if (!row || !on || row.scrollWidth <= row.clientWidth) return
    const left = on.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft
    row.scrollLeft = Math.max(0, left - (row.clientWidth - on.offsetWidth) / 2)
  }, [active])
  if (tabs.length === 0) return null
  return (
    <nav ref={rowRef} className="af-pg-chips af-pf-home-sports" data-scroll="phone" aria-label={t.sportLabel}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className="af-pg-chip"
          aria-current={tab.active ? 'page' : undefined}
          data-active={tab.active ? 'true' : undefined}
          data-testid={`pf-home-sport-${tab.id}`}
          scroll={false}
        >
          {tab.sport === null ? t.allSports : tab.sport === 'SOCCER' ? t.soccer : tab.sport}
          <span className="af-pg-chip-n af-num">{tab.leagues}</span>
        </Link>
      ))}
    </nav>
  )
}

