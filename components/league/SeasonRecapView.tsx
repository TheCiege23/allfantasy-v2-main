'use client'

/**
 * The season recap and awards for one finished season (lib/season-recap). Rendered inside the league's
 * History tab, which is reachable on web and in the app; the members' "recap is ready" notice deep links
 * here with `?view=history&recap=<season>`.
 *
 * Every award is what the season's stored data supports. One that cannot be computed is left out, and
 * the reason is listed at the bottom ("what's missing") rather than shown as a zero.
 */

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { SeasonRecap, RecapGameAward, RecapTeamLine } from '@/lib/season-recap/computeSeasonRecap'

type Props = { leagueId: string; season: number }

const pts = (n: number) => n.toFixed(1)

function Award(props: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{props.label}</p>
      <p className="mt-1 text-sm font-bold text-white">{props.value}</p>
      {props.detail ? <p className="mt-0.5 text-[12px] text-white/60">{props.detail}</p> : null}
    </div>
  )
}

export function SeasonRecapView({ leagueId, season }: Props) {
  const { tInterpolate: t } = useOptionalLanguage()
  const [recap, setRecap] = useState<SeasonRecap | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(`/api/league/${encodeURIComponent(leagueId)}/season-history?season=${season}&view=recap`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) return setState('none')
        if (!res.ok) return setState('error')
        const body = (await res.json()) as { recap?: SeasonRecap }
        if (cancelled) return
        if (!body.recap) return setState('none')
        setRecap(body.recap)
        setState('ready')
      })
      .catch(() => !cancelled && setState('error'))
    return () => {
      cancelled = true
    }
  }, [leagueId, season])

  if (state === 'loading') return <p className="mt-3 text-[12px] text-white/50">{t('seasonRecap.loading')}</p>
  if (state === 'none') return <p className="mt-3 text-[12px] text-white/50">{t('seasonRecap.none')}</p>
  if (state === 'error' || !recap) return <p className="mt-3 text-[12px] text-red-300/80">{t('seasonRecap.error')}</p>

  const game = (g: RecapGameAward) =>
    t('seasonRecap.gameLine', { winner: g.winner.name, loser: g.loser.name, ws: pts(g.winnerScore), ls: pts(g.loserScore), week: g.week })
  const finishLabel = (f: RecapTeamLine['finish']) => t(`seasonRecap.finish.${f}`)

  return (
    <section className="mt-3 space-y-3" aria-label={t('seasonRecap.title', { season: recap.season })}>
      <h3 className="text-sm font-bold text-white">{t('seasonRecap.title', { season: recap.season })}</h3>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {recap.champion ? <Award label={t('seasonRecap.champion')} value={`🏆 ${recap.champion.name}`} /> : null}
        {recap.runnerUp ? <Award label={t('seasonRecap.runnerUp')} value={recap.runnerUp.name} /> : null}
        {recap.topSeed ? (
          <Award label={t('seasonRecap.topSeed')} value={recap.topSeed.name} detail={`${recap.topSeed.wins}-${recap.topSeed.losses}${recap.topSeed.ties ? `-${recap.topSeed.ties}` : ''}`} />
        ) : null}
        {recap.mostPointsFor ? (
          <Award label={t('seasonRecap.mostPointsFor')} value={recap.mostPointsFor.name} detail={t('seasonRecap.points', { points: pts(recap.mostPointsFor.points) })} />
        ) : null}
        {recap.highestWeek ? (
          <Award
            label={t('seasonRecap.highestWeek')}
            value={recap.highestWeek.name}
            detail={t('seasonRecap.weekPoints', { points: pts(recap.highestWeek.points), week: recap.highestWeek.week })}
          />
        ) : null}
        {recap.biggestBlowout ? (
          <Award label={t('seasonRecap.biggestBlowout')} value={t('seasonRecap.margin', { margin: pts(recap.biggestBlowout.margin) })} detail={game(recap.biggestBlowout)} />
        ) : null}
        {recap.closestGame ? (
          <Award label={t('seasonRecap.closestGame')} value={t('seasonRecap.margin', { margin: pts(recap.closestGame.margin) })} detail={game(recap.closestGame)} />
        ) : null}
        {recap.bestTrade ? (
          <Award
            label={t('seasonRecap.bestTrade')}
            value={recap.bestTrade.name}
            detail={t('seasonRecap.tradeLine', { net: `+${Math.round(recap.bestTrade.net)}`, partner: recap.bestTrade.partner?.name ?? '—' })}
          />
        ) : null}
        {recap.worstTrade ? (
          <Award
            label={t('seasonRecap.worstTrade')}
            value={recap.worstTrade.name}
            detail={t('seasonRecap.tradeLine', { net: String(Math.round(recap.worstTrade.net)), partner: recap.worstTrade.partner?.name ?? '—' })}
          />
        ) : null}
        {recap.bestPickup ? (
          <Award
            label={t('seasonRecap.bestPickup')}
            value={`${recap.bestPickup.playerName}${recap.bestPickup.position ? ` (${recap.bestPickup.position})` : ''}`}
            detail={t('seasonRecap.pickupLine', { team: recap.bestPickup.name, points: pts(recap.bestPickup.pointsAfter), week: recap.bestPickup.pickupWeek })}
          />
        ) : null}
        {recap.mostImproved ? (
          <Award
            label={t('seasonRecap.mostImproved')}
            value={recap.mostImproved.name}
            detail={
              recap.mostImproved.basis === 'prior_season'
                ? t('seasonRecap.improvedPrior', { before: Math.round(recap.mostImproved.before * 100), after: Math.round(recap.mostImproved.after * 100) })
                : t('seasonRecap.improvedHalf', { before: pts(recap.mostImproved.before), after: pts(recap.mostImproved.after) })
            }
          />
        ) : null}
        {recap.lowerBracket ? (
          <Award
            label={t(recap.lowerBracket.mode === 'toilet_bowl' ? 'seasonRecap.toiletBowl' : 'seasonRecap.consolation')}
            value={recap.lowerBracket.mode === 'toilet_bowl' ? recap.lowerBracket.loser.name : recap.lowerBracket.winner.name}
            detail={
              recap.lowerBracket.mode === 'toilet_bowl'
                ? t('seasonRecap.toiletBowlLine', { winner: recap.lowerBracket.winner.name })
                : t('seasonRecap.consolationLine', { loser: recap.lowerBracket.loser.name })
            }
          />
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
        <table className="w-full min-w-[520px] text-left text-[12px] text-white/75">
          <caption className="px-3 pt-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            {t('seasonRecap.standings')}
          </caption>
          <thead className="text-[11px] uppercase tracking-[0.12em] text-white/45">
            <tr>
              <th className="px-3 py-1.5">#</th>
              <th className="px-3 py-1.5">{t('seasonRecap.team')}</th>
              <th className="px-3 py-1.5">{t('seasonRecap.record')}</th>
              <th className="px-3 py-1.5">{t('seasonRecap.pf')}</th>
              <th className="px-3 py-1.5">{t('seasonRecap.pa')}</th>
              <th className="px-3 py-1.5">{t('seasonRecap.bestWeek')}</th>
              <th className="px-3 py-1.5">{t('seasonRecap.streak')}</th>
              <th className="px-3 py-1.5">{t('seasonRecap.finishCol')}</th>
            </tr>
          </thead>
          <tbody>
            {recap.teamLines.map((line) => (
              <tr key={line.team.rosterId} className="border-t border-white/[0.05]">
                <td className="px-3 py-1.5 text-white/45">{line.rank}</td>
                <td className="px-3 py-1.5 font-semibold text-white">{line.team.name}</td>
                <td className="px-3 py-1.5">{`${line.wins}-${line.losses}${line.ties ? `-${line.ties}` : ''}`}</td>
                <td className="px-3 py-1.5">{pts(line.pointsFor)}</td>
                <td className="px-3 py-1.5">{pts(line.pointsAgainst)}</td>
                <td className="px-3 py-1.5">{line.bestWeek ? t('seasonRecap.weekPoints', { points: pts(line.bestWeek.points), week: line.bestWeek.week }) : '—'}</td>
                <td className="px-3 py-1.5">{line.longestWinStreak}</td>
                <td className="px-3 py-1.5">{finishLabel(line.finish)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recap.missing.length > 0 ? (
        <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/70">{t('seasonRecap.missing')}</p>
          <ul className="mt-1 list-disc pl-4 text-[12px] text-amber-50/70">
            {recap.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

export default SeasonRecapView
