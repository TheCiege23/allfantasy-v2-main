import 'server-only'

import { findAfProjectionsByName } from '@/lib/af-projections/readAfProjections'

/**
 * What one player is projected for, for the model to read. Phase 7.2.
 *
 * ── 🛑 TWO UNITS, AND THE MODEL WILL CONFLATE THEM UNLESS STOPPED ──────────────────────────
 * `perGame` is points per game; `restOfSeason` is a season total. A model handed "14.2" and
 * "198.8" with no labels will happily average them, compare them, or quote the season figure as a
 * weekly one. Confusing the two understates a player by roughly the weeks remaining — the 17×
 * error this entire audit began with — so the block names both units in words, every time, and
 * says outright which question each answers.
 *
 * ── 🛑 A MISSING REST-OF-SEASON IS SAID IN WORDS, NEVER OMITTED ────────────────────────────
 * Leaving the line out invites the model to fill the gap; printing `0` states that the player
 * will score nothing. Both are worse than saying we have not computed it.
 *
 * ── TAKES A NAME, NO IDS, NO LEAGUE ──────────────────────────────────────────────────────
 * Same rule as every tool in `chimmyTools.ts`. A projection is a property of the player and the
 * week — identical for every user — so there is nothing here to scope to a league.
 */

const SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'NCAABB', 'SOCCER'])

/**
 * ⚠ THE REFUSAL FORBIDS THE PARAPHRASE, exactly as `playerValueTool` does. The failure it guards
 * is measured: with no league selected, a tool result was rewritten into "No last-season records
 * are stored for the KBFL league" — turning "I could not look" into a claim about the user's data.
 * Here that rewrite would be "AllFantasy does not project Player X", which is a statement about
 * our coverage produced by a lookup that found no ROW.
 */
function notFound(asked: string, sport: string): string {
  return [
    `NO ALLFANTASY PROJECTION ROW MATCHED "${asked}" in ${sport}.`,
    'This is NOT a finding that the player is unprojectable, inactive, or unknown to AllFantasy,',
    'and you must NOT say any of those. You must NOT substitute a projection from general',
    'knowledge, from another site, or from your own estimate — an invented number is the worst',
    'answer here, because the user cannot tell it apart from a real one.',
    'Say plainly that we have no projection stored for that player, and offer to check the',
    'spelling or try another sport.',
  ].join(' ')
}

export async function buildPlayerProjectionContext(args: {
  playerName: string
  sport?: string | null
  week?: number | null
}): Promise<string> {
  const asked = args.playerName.trim()
  if (!asked) {
    return 'No player name was given, so nothing was looked up. Ask the user which player they mean.'
  }

  const sport = (args.sport ?? 'NFL').trim().toUpperCase()
  if (!SPORTS.has(sport)) {
    return `"${sport}" is not a sport AllFantasy projects. Say so; do not give a number for it.`
  }

  const { rows, season } = await findAfProjectionsByName({
    playerName: asked,
    sport,
    week: args.week ?? null,
  })

  /*
   * ⚠ THREE DISTINCT ABSENCES. "We hold no rows for this sport at all" is a statement about our
   * pipeline; "we hold rows and none is his" is a statement about this player. Collapsing them
   * would let the model report a stalled cron as a fact about somebody's roster — and the cron
   * silently wrote nothing for 13 days while reporting success, so this is not hypothetical.
   */
  if (season == null) {
    return [
      `NO ALLFANTASY ${sport} PROJECTIONS ARE STORED AT ALL, so nothing could be looked up.`,
      'This is NOT a finding about this player. Say we cannot read projections for that sport',
      'right now; do NOT give a number for anyone.',
    ].join(' ')
  }
  if (rows.length === 0) return notFound(asked, sport)

  /*
   * `findAfProjectionsByName` already deduped to one row per player and ordered week-scoped
   * first. More than one row here means two DIFFERENT players share a normalized name — a real
   * case (a father and son differ only by the suffix the normalizer keeps) and one the model must
   * be told about rather than have resolved for it.
   */
  const lines: string[] = []
  if (rows.length > 1) {
    lines.push(
      `⚠ ${rows.length} different players match "${asked}" in ${sport}. They are listed separately below; ask the user which one they mean rather than picking.`,
    )
  }

  for (const r of rows) {
    const when = r.week != null ? `week ${r.week}` : 'season baseline'
    lines.push(
      `${r.playerName} (${r.position}, ${sport} ${season}, ${when}):`,
      `- ${r.afProjection.toFixed(1)} points PER GAME. This is a per-game rate, not a season total.`,
    )

    if (r.rosProjection == null) {
      lines.push(
        '- Rest-of-season total: NOT COMPUTED for this player. Say so plainly. Do NOT report it as 0, and do NOT multiply the per-game number yourself — the weeks remaining and his bye are not in this block.',
      )
    } else {
      const weeks = r.rosWeeksRemaining
      lines.push(
        `- ${r.rosProjection.toFixed(1)} points REST OF SEASON${weeks != null ? `, over ${weeks} remaining week${weeks === 1 ? '' : 's'}` : ''}. This is a total, not a weekly number.`,
      )
    }

    lines.push(`- Confidence: ${r.confidenceLevel}.`)

    /*
     * The derivation, so the number can be argued with. `weatherAdjustment` of 0 is a real value
     * meaning "considered, no change" — distinct from a projection nobody adjusted.
     */
    const w = r.weatherAdjustment
    if (Math.abs(w) >= 0.05) {
      lines.push(
        `- Basis: ${r.baselineProjection.toFixed(1)} baseline, ${w > 0 ? '+' : ''}${w.toFixed(1)} from weather.`,
      )
    } else if (r.isOutdoorGame) {
      lines.push(`- Basis: ${r.baselineProjection.toFixed(1)} baseline; weather was considered and moved it by nothing.`)
    } else {
      lines.push(`- Basis: ${r.baselineProjection.toFixed(1)} baseline; indoors, so no weather adjustment applies.`)
    }

    if (r.adjustmentReason) lines.push(`- Reason on file: ${r.adjustmentReason}`)
    lines.push(`- Computed ${r.computedAt.toISOString()}.`)
  }

  /*
   * ⚠ STALENESS IS THE MODEL'S PROBLEM TO SURFACE, NOT TO SWALLOW. These rows were 12 days old in
   * production when the audit found the cron had silently stopped, and a confident projection from
   * a fortnight ago is worse than an admitted gap.
   */
  lines.push(
    'If the computed timestamp is more than about a week old, say so alongside the number — a stale projection is still a real one, but the user should know its age.',
  )

  return lines.join('\n')
}
