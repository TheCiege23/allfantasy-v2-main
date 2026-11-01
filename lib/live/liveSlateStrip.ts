import { gameStage, type GameStage } from '@/lib/live/gameStage'
import type { LiveGameCard } from '@/lib/live/liveScoresPage'
import { liveGameBug } from '@/lib/core-app/redraftCoreScoreBug'

/**
 * The "now" strip and the games strip above the Live Scores slate (design board LiveScores.dc.html),
 * read from the slate the screen already holds — no second request, no new number.
 *
 * Counts are of GAMES by stage, with `gameStage`'s own rule (a game is live only when the feed says
 * so; past kickoff without that is still "upcoming", never a guessed "final"). "Yours" is your
 * STARTERS in a game, one per player however many leagues start him — the same player in three
 * leagues is still one person on the field. A bench tie-in is not counted: the strip answers "who is
 * playing for me", and a benched player scores nothing.
 */
export type SlateChip = {
  gameId: string
  stage: GameStage
  /**
   * The game card's own period / start text (`liveGameBug`), so a chip can never read differently from
   * the card it jumps to: "Q3 · 8:42", "Final/OT", "Sun, 1:00 PM EDT". Null when the feed gave none
   * (a plain final reads "Final" in the component).
   */
  label: string | null
  away: { abbrev: string; score: number | null }
  home: { abbrev: string; score: number | null }
  /** Your starters in this game, by name, one per player. */
  yours: string[]
}

export type SlateStrip = {
  live: number
  final: number
  upcoming: number
  /** Distinct starters of yours in games that are live now. */
  startersLive: number
  chips: SlateChip[]
}

function startersIn(game: LiveGameCard): Map<string, string> {
  const byPlayer = new Map<string, string>()
  for (const t of game.tieIns) if (t.isStarter && !byPlayer.has(t.playerId)) byPlayer.set(t.playerId, t.playerName)
  return byPlayer
}

export function liveSlateStrip(games: readonly LiveGameCard[]): SlateStrip {
  let live = 0
  let final = 0
  let upcoming = 0
  const liveStarters = new Set<string>()
  const chips: SlateChip[] = []
  for (const game of games) {
    const stage = gameStage(game)
    if (stage === 'live') live++
    else if (stage === 'final') final++
    else upcoming++
    const starters = startersIn(game)
    if (stage === 'live') for (const id of starters.keys()) liveStarters.add(id)
    chips.push({
      gameId: game.gameId,
      stage,
      label: liveGameBug(game).label,
      away: { abbrev: game.away.abbrev, score: game.away.score },
      home: { abbrev: game.home.abbrev, score: game.home.score },
      yours: [...starters.values()],
    })
  }
  return { live, final, upcoming, startersLive: liveStarters.size, chips }
}

/** The anchor the games strip links to; GameCard and the final-game row carry it as their id. */
export function liveGameAnchor(gameId: string): string {
  return `af-live-game-${gameId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
