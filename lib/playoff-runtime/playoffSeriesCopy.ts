/**
 * The words for a best-of-N playoff series, in ONE place, for the bracket board and the matchup strip.
 * Pure: takes the language provider's `t` so EN and ES come from the same keys (lib/i18n).
 */
import { interpolateTemplate } from '@/lib/i18n/interpolate'
import type { playoffSeriesView } from './playoffSeries'

type SeriesView = NonNullable<ReturnType<typeof playoffSeriesView>>
type T = (key: string) => string

/** "Best of 5 · first to 3 wins". */
export function playoffSeriesFormatLabel(bestOf: number, t: T): string {
  const need = Math.ceil(bestOf / 2)
  return `${interpolateTemplate(t('playoffSeries.bestOf'), { n: bestOf })} · ${interpolateTemplate(t('playoffSeries.firstTo'), { need })}`
}

/**
 * The series record: "Lakers win the series 3–1", "Lakers lead the series 2–1", "Series tied 1–1", or
 * "Series not started". The leader's wins come first.
 */
export function playoffSeriesRecordLine(view: SeriesView, nameOf: (rosterId: string | null) => string, t: T): string {
  const high = Math.max(view.homeWins, view.awayWins)
  const low = Math.min(view.homeWins, view.awayWins)
  if (view.state === 'won' && view.winnerRosterId) {
    return interpolateTemplate(t('playoffSeries.won'), { team: nameOf(view.winnerRosterId), wins: high, losses: low })
  }
  if (view.state === 'not_started') return t('playoffSeries.notStarted')
  if (view.leaderRosterId) {
    return interpolateTemplate(t('playoffSeries.leads'), { team: nameOf(view.leaderRosterId), wins: high, losses: low })
  }
  return interpolateTemplate(t('playoffSeries.tied'), { wins: view.homeWins, losses: view.awayWins })
}
