'use client'

import { useState } from 'react'
import { GenericTradeAnalyzer } from '@/components/core-app/screens/GenericTradeAnalyzer'
import { LeagueTradeEvaluator } from '@/components/core-app/screens/TradeCenter'
import type { StripLeague } from '@/components/core-app/screens/TradeLeagueStrip'
import { TradeMarketMovers } from '@/components/trade-market/TradeMarketMovers'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import '@/components/core-app/home/af-core-home.css'

/**
 * The trade evaluator on Home, folded to one row (owner's choice, 2026-11-06: "Folded card on
 * Home"). Home leads with decisions and news, so the full two-team builder stays closed until asked for.
 *
 * It is shown to EVERY signed-in user, not only those with an imported trade league: a manager with no
 * league is exactly who the open-market grade is for. With leagues it opens the league builder (which
 * still offers "Outside offer — no league"); without, the open-market analyzer. Both sit above the
 * AllFantasy trade market board — values measured from completed trades.
 *
 * ⚠ THE BUILDER MOUNTS ONLY ONCE OPENED. The embedded Trade Center reads the league's rosters as it
 * mounts; rendering it inside a closed <details> would make that read on every Home visit for a card
 * most visits never open. Once opened it stays mounted, so closing and reopening keeps the deal.
 */
export function HomeTradeEvaluatorCard({ leagues, viewerId }: { leagues: StripLeague[]; viewerId?: string | null }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => tradeVisualCopy(coreUiCopy(value, language), language)
  const [opened, setOpened] = useState(false)
  const hasLeagues = leagues.length > 0
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
          <span className="af-home-eval-note">
            {copy(hasLeagues
              ? 'Build a deal in any of your leagues, or grade any trade on values from real completed trades'
              : 'Grade any trade on values from real completed trades — no league needed')}
          </span>
        </span>
        <span className="af-home-eval-chev" aria-hidden="true" />
      </summary>
      {opened ? (
        <div className="af-tc-hub-evaluator af-home-eval-body">
          {hasLeagues ? <LeagueTradeEvaluator leagues={leagues} viewerId={viewerId} /> : <GenericTradeAnalyzer viewerId={viewerId} />}
          <TradeMarketMovers limit={5} ctaHref="/trade-evaluator" ctaLabel={copy('Open the full evaluator')} testId="home-trade-market" />
        </div>
      ) : null}
    </details>
  )
}

export default HomeTradeEvaluatorCard
