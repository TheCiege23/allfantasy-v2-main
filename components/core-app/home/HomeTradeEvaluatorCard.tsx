'use client'

import { useState } from 'react'
import { LeagueTradeEvaluator } from '@/components/core-app/screens/TradeCenter'
import type { StripLeague } from '@/components/core-app/screens/TradeLeagueStrip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import '@/components/core-app/home/af-core-home.css'

/**
 * The league trade evaluator on Home, folded to one row (owner's choice, 2026-11-06: "Folded card on
 * Home"). Home leads with decisions and news, so the full two-team builder stays closed until asked for.
 *
 * ⚠ THE BUILDER MOUNTS ONLY ONCE OPENED. The embedded Trade Center reads the league's rosters as it
 * mounts; rendering it inside a closed <details> would make that read on every Home visit for a card
 * most visits never open. Once opened it stays mounted, so closing and reopening keeps the deal.
 */
export function HomeTradeEvaluatorCard({ leagues, viewerId }: { leagues: StripLeague[]; viewerId?: string | null }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => tradeVisualCopy(coreUiCopy(value, language), language)
  const [opened, setOpened] = useState(false)
  if (leagues.length === 0) return null
  return (
    <details
      className="af3a-card af-home-eval"
      data-testid="home-trade-evaluator"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true)
      }}
    >
      <summary className="af-home-eval-summary">
        <span className="af-home-eval-text">
          <span className="af-home-eval-title">{copy('Evaluate a trade')}</span>
          <span className="af-home-eval-note">{copy('Build a deal in any of your leagues')}</span>
        </span>
        <span className="af-home-eval-chev" aria-hidden="true" />
      </summary>
      {opened ? (
        <div className="af-tc-hub-evaluator af-home-eval-body">
          <LeagueTradeEvaluator leagues={leagues} viewerId={viewerId} />
        </div>
      ) : null}
    </details>
  )
}

export default HomeTradeEvaluatorCard
