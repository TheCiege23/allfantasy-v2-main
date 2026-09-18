'use client'

import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'
import { GameCard } from '@/components/core-app/screens/LiveScores'
import { gameDetailHref } from '@/lib/live/gameDetailLink'
import '@/components/core-app/af-core.css'

/**
 * One game on the public `/live` page.
 *
 * ⚠ THIS IS THE /core/live CARD, NOT A SECOND IMPLEMENTATION. Until 2026-09-13
 * this file drew its own card, and the two surfaces had already drifted: this
 * one printed one row per (league, player) with bench included and no leaders,
 * field or venue. Both now render `GameCard` — ESPN-style leaders, field strip,
 * last play, line score and venue; under "My games" your starters once per
 * player — so a fix to one is a fix to both.
 *
 * `GameCard` reads the `.af-core` token set, hence the wrapper. `.af-core` also
 * paints its own background; `app/live/live.css` turns that off for
 * `.live-card-scope` so the card sits on this page's ground. Light and dark
 * follow the page, because both scopes key off the same `html[data-mode]`.
 *
 * Signed out there are no tie-ins, so the starter list is simply absent — the
 * page still renders, which is the reason `/live` exists beside `/core/live`.
 */
export function MatchupCard({
  game,
  scope,
  lastPlay,
  scoreChanged = false,
}: {
  game: LiveGameCard
  scope: 'my' | 'all'
  /** The newest play-feed item for this game, the fallback when ESPN sends no last-play text. */
  lastPlay: LivePageData['impact']['plays'][number] | null
  /** A score in this game moved since the last payload. Optional: default off. */
  scoreChanged?: boolean
}) {
  return (
    <div className="af-core live-card-scope">
      <GameCard
        game={game}
        scope={scope}
        selectedLeagueId={null}
        lastPlay={lastPlay}
        scoreChanged={scoreChanged}
        detailHref={gameDetailHref(game, '/live')}
      />
    </div>
  )
}
