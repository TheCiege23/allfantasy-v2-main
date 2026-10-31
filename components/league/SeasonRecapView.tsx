'use client'

/**
 * The season recap and awards for one finished season (lib/season-recap). Rendered inside the league's
 * History tab, which is reachable on web and in the app; the members' "recap is ready" notice deep links
 * here with `?view=history&recap=<season>`.
 *
 * Every award is what the season's stored data supports. One that cannot be computed is left out, and
 * the reason is listed at the bottom ("what's missing") rather than shown as a zero.
 *
 * Two add-ons on top (lib/season-recap/seasonRecapAiService.ts, lib/share/seasonRecapCard.ts):
 *   - CHIMMY'S WRITTEN RECAP. Any member reads it once written; only a commissioner on AF Commissioner
 *     writes it (the Storyline Studio gate), and a commissioner without the plan sees the upsell. The
 *     server fact-guards and stores it, so reopening the page reads the stored text and calls nothing.
 *   - SHARE CARDS. The champion and every award have a 1200×630 card any member can share or download.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { enEsLanguage } from '@/lib/i18n/bilingual'
import type { SeasonRecap, RecapGameAward, RecapTeamLine } from '@/lib/season-recap/computeSeasonRecap'
import type { SeasonRecapWriteupView } from '@/lib/season-recap/seasonRecapAiService'
import { seasonRecapCardHref, type SeasonRecapCardAward } from '@/lib/share/seasonRecapCard'

type Props = { leagueId: string; season: number }

const pts = (n: number) => n.toFixed(1)

type T = (key: string, vars?: Record<string, string | number>) => string

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Share the award's card through the phone's share sheet, or download it where there is none. */
function CardActions(props: { href: string; filename: string; t: T }) {
  const { t } = props
  const [status, setStatus] = useState<'idle' | 'busy' | 'shared' | 'downloaded' | 'error'>('idle')
  const fetchCard = async () => {
    const res = await fetch(props.href, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(String(res.status))
    return new File([await res.blob()], props.filename, { type: 'image/png' })
  }
  const share = async () => {
    setStatus('busy')
    try {
      const file = await fetchCard()
      const nav = typeof navigator !== 'undefined' ? navigator : null
      if (nav && typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file] })
          setStatus('shared')
        } catch (e) {
          // A dismissed share sheet throws AbortError — nothing to report.
          setStatus((e as Error)?.name === 'AbortError' ? 'idle' : 'error')
        }
        return
      }
      downloadBlob(file, file.name)
      setStatus('downloaded')
    } catch {
      setStatus('error')
    }
  }
  const download = async () => {
    setStatus('busy')
    try {
      const file = await fetchCard()
      downloadBlob(file, file.name)
      setStatus('downloaded')
    } catch {
      setStatus('error')
    }
  }
  const btn = 'rounded-lg border border-white/[0.12] px-2 py-1 text-[11px] font-semibold text-white/75 hover:bg-white/[0.06] disabled:opacity-50'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={share} disabled={status === 'busy'}>
        {t('seasonRecap.card.share')}
      </button>
      <button type="button" className={btn} onClick={download} disabled={status === 'busy'}>
        {t('seasonRecap.card.download')}
      </button>
      {status === 'shared' || status === 'downloaded' || status === 'error' ? (
        <span className={`text-[11px] ${status === 'error' ? 'text-red-300/80' : 'text-white/50'}`} role="status">
          {t(`seasonRecap.card.${status}`)}
        </span>
      ) : null}
    </div>
  )
}

function Award(props: { label: string; value: string; detail?: string | null; card?: { href: string; filename: string; t: T } }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{props.label}</p>
      <p className="mt-1 text-sm font-bold text-white">{props.value}</p>
      {props.detail ? <p className="mt-0.5 text-[12px] text-white/60">{props.detail}</p> : null}
      {props.card ? <CardActions {...props.card} /> : null}
    </div>
  )
}

type WriteupState = { busy: boolean; error: string | null }

/** Chimmy's written recap: the text, the commissioner's write button, or the AF Commissioner upsell. */
function Writeup(props: {
  view: SeasonRecapWriteupView | null
  state: WriteupState
  onWrite: (regenerate: boolean) => void
  t: T
}) {
  const { view, state, t } = props
  if (!view) return null
  const w = view.writeup
  const canWrite = view.isCommissioner && view.entitled
  if (!w && !view.isCommissioner) return null
  if (!w && view.isCommissioner && !view.entitled) {
    return (
      <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] px-3 py-3" data-testid="season-recap-writeup-upsell">
        <p className="text-[12px] font-bold text-white">{t('seasonRecap.writeup.upsellTitle')}</p>
        <p className="mt-1 text-[12px] text-white/65">{t('seasonRecap.writeup.upsellBody')}</p>
        <Link
          href={view.upgradePath || '/pricing'}
          className="mt-2 inline-block rounded-lg bg-cyan-400/90 px-3 py-1.5 text-[12px] font-bold text-slate-950 hover:bg-cyan-300"
        >
          {t('seasonRecap.writeup.upsellCta')}
        </Link>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3" data-testid="season-recap-writeup">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{t('seasonRecap.writeup.title')}</p>
      {w ? (
        <>
          <h4 className="mt-1 text-sm font-bold text-white">{w.headline}</h4>
          {w.paragraphs.map((para, i) => (
            <p key={i} className="mt-1.5 text-[13px] leading-relaxed text-white/80">
              {para}
            </p>
          ))}
          <p className="mt-2 text-[11px] text-white/45">{t('seasonRecap.writeup.factNote')}</p>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-white/65">{t('seasonRecap.writeup.prompt')}</p>
      )}
      {canWrite ? (
        <button
          type="button"
          onClick={() => props.onWrite(Boolean(w))}
          disabled={state.busy}
          className="mt-2 rounded-lg bg-cyan-400/90 px-3 py-1.5 text-[12px] font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
        >
          {state.busy ? t('seasonRecap.writeup.writing') : w ? t('seasonRecap.writeup.rewrite') : t('seasonRecap.writeup.write')}
        </button>
      ) : null}
      {state.error ? <p className="mt-1.5 text-[12px] text-red-300/80" role="alert">{state.error}</p> : null}
    </div>
  )
}

export function SeasonRecapView({ leagueId, season }: Props) {
  const { tInterpolate: t, language } = useOptionalLanguage()
  const lang = enEsLanguage(language)
  const [recap, setRecap] = useState<SeasonRecap | null>(null)
  const [writeup, setWriteup] = useState<SeasonRecapWriteupView | null>(null)
  const [writeState, setWriteState] = useState<WriteupState>({ busy: false, error: null })
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const endpoint = `/api/league/${encodeURIComponent(leagueId)}/season-history`

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(`${endpoint}?season=${season}&view=recap&lang=${lang}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) return setState('none')
        if (!res.ok) return setState('error')
        const body = (await res.json()) as { recap?: SeasonRecap; writeup?: SeasonRecapWriteupView | null }
        if (cancelled) return
        if (!body.recap) return setState('none')
        setRecap(body.recap)
        setWriteup(body.writeup ?? null)
        setState('ready')
      })
      .catch(() => !cancelled && setState('error'))
    return () => {
      cancelled = true
    }
  }, [endpoint, season, lang])

  const write = async (regenerate: boolean) => {
    setWriteState({ busy: true, error: null })
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ season, lang, regenerate }),
      })
      const body = (await res.json().catch(() => null)) as
        | { ok: true; writeup: NonNullable<SeasonRecapWriteupView['writeup']> }
        | { error?: string; message?: string }
        | null
      if (res.ok && body && 'writeup' in body) {
        setWriteup((v) => (v ? { ...v, writeup: body.writeup } : v))
        setWriteState({ busy: false, error: null })
        return
      }
      const err = body && 'error' in body ? body.error : null
      const key =
        err === 'daily_cap' ? 'seasonRecap.writeup.errorCap'
          : err === 'fact_guard' ? 'seasonRecap.writeup.errorFacts'
            : err === 'not_entitled' ? 'seasonRecap.writeup.errorPlan'
              : 'seasonRecap.writeup.error'
      setWriteState({ busy: false, error: t(key) })
    } catch {
      setWriteState({ busy: false, error: t('seasonRecap.writeup.error') })
    }
  }

  if (state === 'loading') return <p className="mt-3 text-[12px] text-white/50">{t('seasonRecap.loading')}</p>
  if (state === 'none') return <p className="mt-3 text-[12px] text-white/50">{t('seasonRecap.none')}</p>
  if (state === 'error' || !recap) return <p className="mt-3 text-[12px] text-red-300/80">{t('seasonRecap.error')}</p>

  const game = (g: RecapGameAward) =>
    t('seasonRecap.gameLine', { winner: g.winner.name, loser: g.loser.name, ws: pts(g.winnerScore), ls: pts(g.loserScore), week: g.week })
  const finishLabel = (f: RecapTeamLine['finish']) => t(`seasonRecap.finish.${f}`)
  const card = (award: SeasonRecapCardAward) => ({
    href: seasonRecapCardHref(leagueId, recap.season, award, lang),
    filename: `allfantasy-${recap.season}-${award}.png`,
    t,
  })

  return (
    <section className="mt-3 space-y-3" aria-label={t('seasonRecap.title', { season: recap.season })}>
      <h3 className="text-sm font-bold text-white">{t('seasonRecap.title', { season: recap.season })}</h3>

      <Writeup view={writeup} state={writeState} onWrite={write} t={t} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {recap.champion ? <Award card={card('champion')} label={t('seasonRecap.champion')} value={`🏆 ${recap.champion.name}`} /> : null}
        {recap.runnerUp ? <Award card={card('runnerUp')} label={t('seasonRecap.runnerUp')} value={recap.runnerUp.name} /> : null}
        {recap.topSeed ? (
          <Award card={card('topSeed')} label={t('seasonRecap.topSeed')} value={recap.topSeed.name} detail={`${recap.topSeed.wins}-${recap.topSeed.losses}${recap.topSeed.ties ? `-${recap.topSeed.ties}` : ''}`} />
        ) : null}
        {recap.mostPointsFor ? (
          <Award card={card('mostPointsFor')} label={t('seasonRecap.mostPointsFor')} value={recap.mostPointsFor.name} detail={t('seasonRecap.points', { points: pts(recap.mostPointsFor.points) })} />
        ) : null}
        {recap.highestWeek ? (
          <Award
            card={card('highestWeek')}
            label={t('seasonRecap.highestWeek')}
            value={recap.highestWeek.name}
            detail={t('seasonRecap.weekPoints', { points: pts(recap.highestWeek.points), week: recap.highestWeek.week })}
          />
        ) : null}
        {recap.biggestBlowout ? (
          <Award card={card('biggestBlowout')} label={t('seasonRecap.biggestBlowout')} value={t('seasonRecap.margin', { margin: pts(recap.biggestBlowout.margin) })} detail={game(recap.biggestBlowout)} />
        ) : null}
        {recap.closestGame ? (
          <Award card={card('closestGame')} label={t('seasonRecap.closestGame')} value={t('seasonRecap.margin', { margin: pts(recap.closestGame.margin) })} detail={game(recap.closestGame)} />
        ) : null}
        {recap.bestTrade ? (
          <Award
            card={card('bestTrade')}
            label={t('seasonRecap.bestTrade')}
            value={recap.bestTrade.name}
            detail={t('seasonRecap.tradeLine', { net: `+${Math.round(recap.bestTrade.net)}`, partner: recap.bestTrade.partner?.name ?? '—' })}
          />
        ) : null}
        {recap.worstTrade ? (
          <Award
            card={card('worstTrade')}
            label={t('seasonRecap.worstTrade')}
            value={recap.worstTrade.name}
            detail={t('seasonRecap.tradeLine', { net: String(Math.round(recap.worstTrade.net)), partner: recap.worstTrade.partner?.name ?? '—' })}
          />
        ) : null}
        {recap.bestPickup ? (
          <Award
            card={card('bestPickup')}
            label={t('seasonRecap.bestPickup')}
            value={`${recap.bestPickup.playerName}${recap.bestPickup.position ? ` (${recap.bestPickup.position})` : ''}`}
            detail={t('seasonRecap.pickupLine', { team: recap.bestPickup.name, points: pts(recap.bestPickup.pointsAfter), week: recap.bestPickup.pickupWeek })}
          />
        ) : null}
        {recap.mostImproved ? (
          <Award
            card={card('mostImproved')}
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
            card={card('lowerBracket')}
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
