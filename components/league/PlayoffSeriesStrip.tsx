'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { CONSOLATION_ROUND_OFFSET } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { playoffSeriesView, seriesLengthForRound } from '@/lib/playoff-runtime/playoffSeries'
import { playoffSeriesFormatLabel, playoffSeriesRecordLine } from '@/lib/playoff-runtime/playoffSeriesCopy'

type SeriesMatchup = {
  roundNumber: number
  homeRosterId: string | null
  awayRosterId: string | null
  bye?: boolean
  metadata?: Record<string, unknown> | null
}

/** The best-of length of a bracket matchup's round; 1 when series mode is off. Lower-bracket rounds play their title round's length. */
export function bestOfForMatchup(seriesLengths: readonly number[] | null | undefined, matchup: Pick<SeriesMatchup, 'roundNumber'>): number {
  const round = matchup.roundNumber >= CONSOLATION_ROUND_OFFSET ? matchup.roundNumber - CONSOLATION_ROUND_OFFSET : matchup.roundNumber
  return seriesLengthForRound(seriesLengths, round)
}

/**
 * One line under a bracket matchup: "Best of 5 · first to 3 wins — Lakers lead the series 2–1".
 * Renders nothing for a single-week round or a bye.
 */
export function PlayoffSeriesLine({
  seriesLengths,
  matchup,
  nameOf,
}: {
  seriesLengths: readonly number[] | null | undefined
  matchup: SeriesMatchup
  nameOf: (rosterId: string | null) => string
}) {
  const { t } = useOptionalLanguage()
  if (matchup.bye || !matchup.homeRosterId || !matchup.awayRosterId) return null
  const view = playoffSeriesView({
    bestOf: bestOfForMatchup(seriesLengths, matchup),
    metadata: matchup.metadata,
    homeRosterId: matchup.homeRosterId,
    awayRosterId: matchup.awayRosterId,
  })
  if (!view) return null
  return (
    <span className="text-[11px] text-cyan-200/80" data-testid="playoff-series-line">
      {playoffSeriesFormatLabel(view.bestOf, t)} — {playoffSeriesRecordLine(view, nameOf, t)}
    </span>
  )
}

/**
 * The matchup screen's series strip: the selected team's current playoff series, when it is in one.
 * Nothing in cumulative mode, before the bracket exists, or once the team is out.
 */
export function PlayoffSeriesStrip({
  seriesLengths,
  matchups,
  rosterId,
  nameOf,
}: {
  seriesLengths: readonly number[] | null | undefined
  matchups: SeriesMatchup[]
  rosterId: string | null
  nameOf: (rosterId: string | null) => string
}) {
  const { t } = useOptionalLanguage()
  if (!rosterId || !seriesLengths) return null
  const mine = matchups.filter(
    (m) => !m.bye && m.homeRosterId && m.awayRosterId && (m.homeRosterId === rosterId || m.awayRosterId === rosterId),
  )
  // The latest series this team is in (rounds ascend), so a finished earlier round never hides the live one.
  const matchup = mine.sort((a, b) => a.roundNumber - b.roundNumber).at(-1)
  if (!matchup) return null
  const view = playoffSeriesView({
    bestOf: bestOfForMatchup(seriesLengths, matchup),
    metadata: matchup.metadata,
    homeRosterId: matchup.homeRosterId,
    awayRosterId: matchup.awayRosterId,
  })
  if (!view) return null
  return (
    <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2" data-testid="playoff-series-strip">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/70">{t('playoffSeries.yours')}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-white/90">
        {nameOf(matchup.homeRosterId)} {view.homeWins} – {view.awayWins} {nameOf(matchup.awayRosterId)}
      </p>
      <p className="text-[11px] text-white/55">
        {playoffSeriesFormatLabel(view.bestOf, t)} — {playoffSeriesRecordLine(view, nameOf, t)}
      </p>
    </div>
  )
}
