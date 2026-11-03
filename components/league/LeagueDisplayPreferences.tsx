'use client'

import { createContext, useContext, type ReactNode } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LeagueSectionId } from '@/lib/league/leagueSections'

const HiddenSections = createContext<readonly LeagueSectionId[]>([])

export function LeagueDisplayPreferences({ hidden, children }: { hidden: readonly LeagueSectionId[]; children: ReactNode }) {
  return <HiddenSections.Provider value={hidden}>{children}</HiddenSections.Provider>
}

/** Hidden cards do not mount, so their timers and client requests stop too. */
export function LeagueSection({ id, children }: { id: LeagueSectionId; children: ReactNode }) {
  const hidden = useContext(HiddenSections)
  return hidden.includes(id) ? null : <>{children}</>
}

export function CustomizeLeagueLink({ returnTo, className }: { returnTo: string; className?: string }) {
  const { t } = useOptionalLanguage()
  return <Link href={`/settings?tab=leagues&returnTo=${encodeURIComponent(returnTo)}`}
    className={className} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
    {t('league.customizePage')}
  </Link>
}
