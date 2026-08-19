'use client'

import type { ReactNode } from 'react'

type League = { league_id: string; name: string }

export default function LegacyChatIntro({
  username,
  leagues,
  renderLeagueSelector,
}: {
  username?: string | null
  leagues: League[]
  chatLeagueId: string
  renderLeagueSelector: () => ReactNode
}) {
  return (
    <>
      <p className="text-center text-sm sm:text-base mode-muted mb-4">Ask your fantasy questions and get clear, contextual answers.</p>
      <div className="flex items-start sm:items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center text-xl flex-shrink-0">&#x1F4AC;</div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg sm:text-xl font-bold text-cyan-400">Chimmy, Your Fantasy Coach</h3>
          <p className="text-xs sm:text-sm mode-muted">
            {username
              ? 'Personalized to your leagues, rosters & trading style'
              : 'Ask about trades, players, drafts, waivers, or drop a screenshot'}
          </p>
        </div>
        {username && leagues.length > 0 ? renderLeagueSelector() : null}
      </div>
    </>
  )
}
