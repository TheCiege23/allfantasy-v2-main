'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { interpolateTemplate } from '@/lib/i18n/interpolate'
import { savedOr } from '@/lib/league-settings/savedLeagueOverrides'
import { playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'
import { lastWeekOfPlayoffRound } from '@/lib/playoff-runtime/playoffRoundWeeks'
import {
  PLAYOFF_SERIES_LENGTHS,
  parsePlayoffSeriesLengths,
  readPlayoffSeriesLengths,
  seriesLengthForRound,
} from '@/lib/playoff-runtime/playoffSeries'

/** One length per round for a bracket of `rounds`, from the stored list (a missing round repeats the last). */
export function seriesLengthsForRounds(stored: readonly number[] | null, rounds: number): number[] {
  return Array.from({ length: Math.max(0, rounds) }, (_, i) => seriesLengthForRound(stored, i + 1))
}

/** What a save sends: null when every round is a single week (series off), else the per-round list. */
export function seriesLengthsPatchValue(lengths: readonly number[]): number[] | null {
  return lengths.some((n) => n > 1) ? [...lengths] : null
}

/**
 * Best-of-N playoff series, per round (lib/playoff-runtime/playoffSeries.ts). Native NBA / NHL / MLB
 * redraft leagues only — the parent decides whether to render it. Any length above one week is the AF
 * Commissioner plan: without it the longer options are locked (a series already saved stays selectable,
 * so a lapsed plan keeps it), and going back to single weeks is always free. The server enforces the same.
 */
export function PlayoffSeriesLengthsCard({
  leagueId,
  settings,
  playoffTeams,
  playoffStartWeek,
  seasonWeeks,
  canEdit,
  hasPlan,
  queuePatch,
}: {
  leagueId: string
  settings: unknown
  playoffTeams: number
  playoffStartWeek: number
  seasonWeeks: number | null
  canEdit: boolean
  hasPlan: boolean
  queuePatch: (updates: Record<string, unknown>) => void
}) {
  const { t } = useLanguage()
  const storedRaw = readPlayoffSeriesLengths(settings)
  const saved = savedOr<unknown>(leagueId, 'playoffSeriesLengths', storedRaw)
  const parsedSaved = parsePlayoffSeriesLengths(saved)
  const stored = parsedSaved.ok ? parsedSaved.value : storedRaw
  const rounds = playoffRoundsForTeams(playoffTeams)
  const [lengths, setLengths] = useState<number[]>(() => seriesLengthsForRounds(stored, rounds))
  const storedKey = JSON.stringify(stored)
  useEffect(() => {
    setLengths(seriesLengthsForRounds(stored, rounds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey, rounds])

  if (rounds < 1) return null
  const seriesOn = lengths.some((n) => n > 1)
  const lastWeek = seriesOn
    ? lastWeekOfPlayoffRound({ playoffStartWeek, roundNumber: rounds, seriesLengths: lengths })
    : null
  const tooLong = lastWeek != null && seasonWeeks != null && lastWeek > seasonWeeks
  const storedForRound = (i: number) => seriesLengthForRound(storedRaw, i + 1)

  const change = (index: number, value: number) => {
    const next = lengths.map((n, i) => (i === index ? value : n))
    setLengths(next)
    queuePatch({ playoffSeriesLengths: seriesLengthsPatchValue(next) })
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4" data-testid="playoff-series-lengths">
      <h4 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.series')}</h4>
      <p className="mb-3 text-[11px] text-white/45">{t('lsHub.po.seriesHelp')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {lengths.map((value, index) => {
          const label =
            index === rounds - 1 ? t('lsHub.po.seriesFinal') : interpolateTemplate(t('lsHub.po.seriesRound'), { round: index + 1 })
          return (
            <label key={index} className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</span>
              <select
                aria-label={label}
                value={value}
                disabled={!canEdit}
                data-testid={`playoff-series-round-${index + 1}`}
                onChange={(e) => change(index, Number(e.target.value))}
                className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {PLAYOFF_SERIES_LENGTHS.map((n) => (
                  <option key={n} value={n} disabled={n > 1 && !hasPlan && n !== storedForRound(index)}>
                    {n === 1 ? t('lsHub.po.seriesSingle') : interpolateTemplate(t('lsHub.po.seriesBestOf'), { n })}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
      {seriesOn ? (
        <p className="mt-3 text-[11px] text-white/55" data-testid="playoff-series-window">
          {tooLong
            ? interpolateTemplate(t('lsHub.po.seriesTooLong'), { to: lastWeek ?? '', last: seasonWeeks ?? '' })
            : interpolateTemplate(t('lsHub.po.seriesWindow'), { from: playoffStartWeek, to: lastWeek ?? '' })}{' '}
          {t('lsHub.po.seriesReplaces')}
        </p>
      ) : null}
      {canEdit && !hasPlan ? (
        <p className="mt-3 text-[11px] text-white/55" data-testid="playoff-series-upsell">
          {t('lsHub.po.seriesPlan')}{' '}
          <a href="/upgrade?plan=commissioner" className="font-semibold text-violet-300 underline">
            {t('lsHub.po.seriesUpgrade')}
          </a>
        </p>
      ) : null}
    </div>
  )
}
