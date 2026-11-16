import 'server-only'

import { priceBoardPlayer } from '@/lib/decision-os/trade/sportPointsValue'
import { isDynastyGradedSport, playerDynastyValue } from '@/lib/decision-os/trade/sportDynastyValue'
import { BOARD_VALUE_SPORTS, boardUnit, loadLeagueValueBoard, type LeagueValueBoardDeps } from '@/lib/sport-values/leagueValueBoard'

/**
 * What a player is worth IN AN NBA LEAGUE, for Chimmy (2026-11-16, re-score item 12: player values for
 * every sport, NBA first).
 *
 * 🛑 NOT A NEW MODEL. No vendor prices NBA fantasy players, but the trade grader already prices them:
 * points (or, in a category league, summed per-game category scores) over the best free agent at the
 * player's position, under THIS league's rules, for the games left — plus an aged, discounted
 * multi-season value in a dynasty league (`lib/decision-os/trade/sportPointsValue.ts`,
 * `sportDynastyValue.ts`). This reads that board through `priceBoardPlayer`, the function the grade's
 * own pricing calls, so Chimmy's value for a player and the Trade Center's grade of a deal with him
 * cannot disagree.
 *
 * ⚠ A DIFFERENT UNIT FROM NFL. NFL values are on the 0–10000 market scale; these are this league's
 * fantasy points (or category score) over replacement. The block says so, and tells the model never to
 * set one against the other or against another league's numbers.
 *
 * Owner's order is NBA first, then MLB, then NHL and soccer. The board already covers those sports; each
 * joins `BOARD_VALUE_SPORTS` (lib/sport-values/leagueValueBoard.ts — one list for every surface) when it
 * is turned on, deliberately, one at a time.
 */
export { BOARD_VALUE_SPORTS }

const DYNASTY_SEASONS_SHOWN = 5

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US')

export type SportBoardValueDeps = LeagueValueBoardDeps

/**
 * The value block for one named player in the league in scope, or NULL when that league's sport is not
 * valued here (the caller then answers from the NFL market values as before).
 */
export async function buildSportBoardValueContext(
  args: { leagueId: string; playerName: string },
  deps: Partial<SportBoardValueDeps> = {},
): Promise<string | null> {
  const board = await loadLeagueValueBoard(args.leagueId, deps)
  if (board.kind === 'not_board_sport') return null
  const sport = board.sport

  const asked = args.playerName.trim()
  if (!asked) return 'No player name was given, so nothing was looked up. Ask the user which player they mean.'

  if (board.kind === 'unavailable') return `${sport} VALUE: not available in this league — ${board.reason} Do NOT give a value from general knowledge.`
  const ctx = board.ctx

  if (ctx.window.gamesRemaining <= 0) {
    return `${sport} VALUE: the ${ctx.window.seasonLabel} regular season has no games left, so there is no rest-of-season value. Do NOT give one from general knowledge.`
  }

  const price = priceBoardPlayer({ name: asked }, ctx)
  if (!price.ok) return `${sport} VALUE: not available — ${price.reason} Do NOT estimate one or give a number from general knowledge.`

  const { player, replacementPerGame, replacementName, value } = price
  const categories = ctx.valueKind === 'categories'
  const unit = boardUnit(ctx)
  const scoring =
    ctx.scoringBasis === 'league'
      ? categories ? `this league's categories (${ctx.categoryList ?? 'as configured'})` : "this league's own scoring"
      : `the ${sport} default scoring (this league's own rules could not be applied)`
  const lines = [
    `${sport} VALUE for ${player.name} (${player.position}) in this league — ${scoring}, ${ctx.window.seasonLabel}, ${ctx.window.gamesRemaining} games left:`,
    `- ${fmt(player.perGame)} ${unit} per game against ${fmt(replacementPerGame)} for the best free agent at ${player.position.toUpperCase()} (${replacementName}): ${fmt(Math.max(0, player.perGame - replacementPerGame))} over replacement per game.`,
    `- Rest of season: ${fmt(value)} ${unit} over replacement (per-game edge × ${ctx.window.gamesRemaining} games left).`,
  ]
  if (player.sampleGames != null) {
    const from = ctx.window.baselineSeasonLabel ? ` from the ${ctx.window.baselineSeasonLabel} season (this season has too few games yet)` : ''
    lines.push(`- The projection rests on ${player.sampleGames} games${from}.`)
  }
  if (ctx.dynasty && isDynastyGradedSport(sport)) {
    const age = ctx.dynasty.ages.get(player.id)
    const dynasty = playerDynastyValue({ sport, player, age, replacementPerGame, gamesRemaining: ctx.window.gamesRemaining })
    lines.push(
      age == null
        ? `- Dynasty (${DYNASTY_SEASONS_SHOWN} seasons): ${fmt(dynasty)} ${unit} over replacement — his age is not on file, so no age curve is applied. A model estimate, not a market price.`
        : `- Dynasty (${DYNASTY_SEASONS_SHOWN} seasons, age ${age} on the ${sport} age curve, later seasons discounted): ${fmt(dynasty)} ${unit} over replacement. A model estimate, not a market price.`,
    )
  }
  if (value <= 0) lines.push('- He is not projected above the best free agent at his position: his trade value is what a free agent costs.')
  lines.push(
    `UNIT: ${unit} over replacement in THIS league. It is NOT the AllFantasy 0–10000 NFL value scale and is not comparable to another league's numbers — never convert or compare them. Quote these numbers; do not invent others.`,
  )
  return lines.join('\n')
}
