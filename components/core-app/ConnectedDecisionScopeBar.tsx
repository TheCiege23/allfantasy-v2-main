'use client'

import Link from 'next/link'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import '@/components/core-app/af-connected-scope.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy, hubText } from '@/lib/core-app/formatHubCopy'

type ScopeSide = {
  memberId: string
  leagueId: string | null
  name: string
  platform: string
  sport?: string | null
}

export function ConnectedDecisionScopeBar({
  linkId,
  franchiseName,
  screen,
  selectedLeagueId,
  sides,
}: {
  linkId: string
  franchiseName: string
  screen: string
  selectedLeagueId: string
  sides: ScopeSide[]
}) {
  const { language } = useOptionalLanguage()
  const c = (english: string) => hubCopy(english, language)
  function askAll() {
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, {
      detail: {
        tab: 'chimmy',
        prefill: hubText.askAllPrefill(franchiseName, screen.replace(/-/g, ' '), language),
      },
    }))
  }

  return (
    <aside className="af-connected-scope" aria-label={hubText.scopeAria(franchiseName, language)}>
      <div>
        <span>{c('CONNECTED FRANCHISE')}</span>
        <strong>{franchiseName}</strong>
      </div>
      <nav aria-label={c('Use this tool in a connected league')}>
        {sides.filter((side) => side.leagueId).map((side) => (
          <Link
            key={side.memberId}
            data-current={side.leagueId === selectedLeagueId || undefined}
            href={`/core/${screen}?league=${encodeURIComponent(side.leagueId as string)}&franchise=${encodeURIComponent(linkId)}`}
          >
            <small>{side.sport?.toUpperCase() ?? side.platform.toUpperCase()}</small>
            {side.name}
          </Link>
        ))}
      </nav>
      <button type="button" onClick={askAll}>{c('Ask Chimmy across all')}</button>
      <Link className="af-connected-scope-home" href={`/core/war-room?league=${encodeURIComponent(selectedLeagueId)}`}>{c('Hub home')}</Link>
    </aside>
  )
}

export default ConnectedDecisionScopeBar
