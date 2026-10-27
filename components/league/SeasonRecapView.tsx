'use client'

/**
 * The season recap and awards for one finished season (lib/season-recap). Rendered inside the league's
 * History tab, which is reachable on web and in the app; the members' "recap is ready" notice deep links
 * here with `?view=history&recap=<season>`.
 *
 * Every award is what the season's stored data supports. One that cannot be computed is left out, and
 * the reason is listed at the bottom ("what's missing") rather than shown as a zero.
 */

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { SeasonRecap, RecapGameAward, RecapTeamLine } from '@/lib/season-recap/computeSeasonRecap'
import type { SeasonRecapNarrative } from '@/lib/season-recap/seasonRecapAi'
import { availableRecapCards, recapCardHref, recapCardView, type RecapCardKind } from '@/lib/season-recap/seasonRecapCards'

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

/** "[[Hawks]] won" with the marked names in bold; the marks never reach the screen. */
function NarrativeText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\[[^\]]+\]\])/g).map((part, i) => {
        const m = /^\[\[([^\]]+)\]\]$/.exec(part)
        return m ? (
          <strong key={i} className="font-semibold text-white">
            {m[1]}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

type NarrativeState = {
  narrative: SeasonRecapNarrative | null
  isCommissioner: boolean
  canGenerate: boolean
  upgradePath: string | null
}

/**
 * Chimmy's written recap (lib/season-recap/seasonRecapAi.ts). Every member reads the league's cached
 * one; the commissioner with AF Commissioner writes it; a commissioner without the plan sees the upsell.
 * A member with nothing to read sees nothing.
 */
function SeasonRecapNarrativePanel({ leagueId, season }: Props) {
  const { tInterpolate: t, language } = useOptionalLanguage()
  const lang = language === 'es' ? 'es' : 'en'
  const [state, setState] = useState<NarrativeState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season-recap-ai?season=${season}&lang=${lang}`)
      .then(async (res) => (res.ok ? ((await res.json()) as NarrativeState) : null))
      .then((body) => !cancelled && setState(body))
      .catch(() => !cancelled && setState(null))
    return () => {
      cancelled = true
    }
  }, [leagueId, season, lang])

  const write = useCallback(
    async (regenerate: boolean) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season-recap-ai`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ season, lang, regenerate }),
        })
        if (res.status === 429) return setNotice(t('seasonRecap.narrative.cap'))
        if (!res.ok) return setNotice(t('seasonRecap.narrative.error'))
        const body = (await res.json()) as { narrative: SeasonRecapNarrative }
        setState((cur) => (cur ? { ...cur, narrative: body.narrative } : cur))
      } catch {
        setNotice(t('seasonRecap.narrative.error'))
      } finally {
        setBusy(false)
      }
    },
    [leagueId, season, lang, t],
  )

  if (!state) return null
  const { narrative, isCommissioner, canGenerate, upgradePath } = state
  if (!narrative && !isCommissioner) return null

  return (
    <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-2.5" data-testid="season-recap-narrative">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">{t('seasonRecap.narrative.title')}</p>
      {narrative ? (
        <>
          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-white/80">
            <NarrativeText text={narrative.text} />
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            {narrative.source === 'ai' ? t('seasonRecap.narrative.factsOnly') : t('seasonRecap.narrative.template')}
          </p>
        </>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {narrative ? (
          <button
            type="button"
            className="rounded-lg border border-white/10 px-2.5 py-1 text-[12px] text-white/75 hover:bg-white/[0.06]"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(narrative.text.replace(/\[\[([^\]]+)\]\]/g, '$1'))
                .then(() => setCopied(true))
                .catch(() => {})
            }}
          >
            {copied ? t('seasonRecap.narrative.copied') : t('seasonRecap.narrative.copy')}
          </button>
        ) : null}
        {canGenerate ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-cyan-400/90 px-2.5 py-1 text-[12px] font-semibold text-black disabled:opacity-60"
            onClick={() => void write(Boolean(narrative))}
          >
            {busy ? t('seasonRecap.narrative.writing') : narrative ? t('seasonRecap.narrative.regenerate') : t('seasonRecap.narrative.generate')}
          </button>
        ) : null}
        {isCommissioner && !canGenerate ? (
          <>
            <span className="text-[12px] text-white/60">{t('seasonRecap.narrative.upsell')}</span>
            <a href={upgradePath ?? '/pricing'} className="text-[12px] font-semibold text-cyan-200 underline">
              {t('seasonRecap.narrative.upgrade')}
            </a>
          </>
        ) : null}
      </div>
      {notice ? <p className="mt-1.5 text-[12px] text-amber-200/80">{notice}</p> : null}
    </div>
  )
}

/** Champion and award share cards: the image from /api/share/season-recap-card, shared natively where the device can. */
function SeasonRecapShareCards({ leagueId, recap }: { leagueId: string; recap: SeasonRecap }) {
  const { tInterpolate: t, language } = useOptionalLanguage()
  const lang = language === 'es' ? 'es' : 'en'
  const kinds = availableRecapCards(recap)
  if (kinds.length === 0) return null

  const share = async (kind: RecapCardKind) => {
    const href = recapCardHref(leagueId, recap.season, kind, lang)
    const view = recapCardView(recap, kind, lang)
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null
      if (nav && typeof nav.share === 'function') {
        const blob = await (await fetch(href)).blob()
        const file = new File([blob], `season-${recap.season}-${kind}.png`, { type: 'image/png' })
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: view ? `${view.label} · ${view.value}` : undefined })
          return
        }
      }
    } catch {
      /* cancelled or unsupported: fall through to opening the image */
    }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="rounded-xl border border-white/[0.06] px-3 py-2" data-testid="season-recap-share-cards">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{t('seasonRecap.cards')}</p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {kinds.map((kind) => {
          const view = recapCardView(recap, kind, lang)
          if (!view) return null
          return (
            <li key={kind} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[12px] text-white/75">
              <span className="font-semibold text-white">{view.label}</span>
              <button type="button" className="ml-1 text-cyan-200 underline" onClick={() => void share(kind)}>
                {t('seasonRecap.shareCard')}
              </button>
              <a className="text-white/50 underline" href={recapCardHref(leagueId, recap.season, kind, lang)} target="_blank" rel="noreferrer">
                {t('seasonRecap.openCard')}
              </a>
            </li>
          )
        })}
      </ul>
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

      <SeasonRecapNarrativePanel leagueId={leagueId} season={recap.season} />

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

      <SeasonRecapShareCards leagueId={leagueId} recap={recap} />

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
