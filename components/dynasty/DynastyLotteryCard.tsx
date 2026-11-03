'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, Ticket } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import type { LotteryOdds } from '@/lib/core-app/draftHq'
import './dynasty-details.css'

type LotterySection = { available: true; data: LotteryOdds } | { available: false; reason: string }

/** The i18n key for how the picks after the drawn ones are seated (lib/draft-lottery `buildFullSlotOrder`). */
export function lotteryOrderKey(mode: string | null | undefined): string {
  if (mode === 'reverse_max_pf') return 'dynasty.lottery.order.reverse_max_pf'
  // The engine has no commissioner order to read, so a `manual` fallback seats by finish.
  if (mode === 'reverse_standings' || mode === 'manual') return 'dynasty.lottery.order.reverse_standings'
  return 'dynasty.lottery.order.unknown'
}

/**
 * The upcoming rookie draft's lottery, on the dynasty standings: every lottery team's odds at the
 * first pick, the viewer's row in gold, and how the rest of the order is seated.
 *
 * ⚠ THE SAME NUMBERS AS DRAFT HQ. It reads `/api/leagues/[id]/draft-lottery/odds`, which is Draft
 * HQ's own `loadLottery`; nothing is recomputed here. A league without a weighted lottery, or in its
 * startup year, answers `available: false` and the card is not drawn at all.
 */
export function DynastyLotteryCard({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const { t, tInterpolate } = useOptionalLanguage()
  const [lottery, setLottery] = useState<LotteryOdds | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setLottery(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-lottery/odds`, { signal: ac.signal, cache: 'no-store' })
      .then(async (res) => (res.ok ? ((await res.json()) as { lottery?: LotterySection }) : null))
      .then((json) => {
        if (json?.lottery?.available && json.lottery.data.teams.length > 0) setLottery(json.lottery.data)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [leagueId])

  if (!lottery) return null
  const top = Math.max(...lottery.teams.map((x) => x.oddsPercent), 0)
  const mine = lottery.teams.find((x) => x.isYou) ?? null

  return (
    <section className="dyd-lottery" aria-labelledby="dyd-lottery-title" data-testid="dynasty-lottery-card">
      <h3 id="dyd-lottery-title">
        <Ticket className="dyd-gold-icon mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden />
        {t('dynasty.lottery.title')}
      </h3>
      <p>{tInterpolate('dynasty.lottery.subtitle', { count: lottery.pickCount })}</p>
      <div className="dyd-lottery-head" aria-hidden="true">
        <span>#</span>
        <span>{t('dynasty.lottery.colTeam')}</span>
        <span>{t('dynasty.lottery.colOdds')}</span>
      </div>
      <ol className="dyd-lottery-rows">
        {lottery.teams.map((team, i) => (
          <li key={team.rosterId} className="dyd-lottery-row" data-you={team.isYou || undefined} data-testid={`dynasty-lottery-row-${team.rosterId}`}>
            <span className="dyd-lottery-seed">{i + 1}</span>
            <span className="dyd-lottery-team">
              {team.name}
              <small>
                <span className="sr-only">{t('dynasty.lottery.colRecord')} </span>
                {team.record}
                {team.isYou ? ` · ${t('dynasty.lottery.you')}` : ''}
              </small>
            </span>
            <span className="dyd-lottery-odds">
              <span className="sr-only">{t('dynasty.lottery.colOdds')} </span>
              {team.oddsPercent.toFixed(1)}%
            </span>
            <span className="dyd-lottery-bar" aria-hidden="true">
              <span style={{ width: `${top > 0 ? Math.max(2, (team.oddsPercent / top) * 100) : 0}%` }} />
            </span>
          </li>
        ))}
      </ol>
      <p>{tInterpolate('dynasty.lottery.rest', { order: t(lotteryOrderKey(lottery.fallbackMode)) })}</p>
      {lottery.alreadyRunAt ? <p>{t('dynasty.lottery.alreadyRun')}</p> : null}
      <div className="dyd-lottery-actions">
        <a href={`/league/${encodeURIComponent(leagueId)}/draft-hq`}>{t('dynasty.lottery.openDraftHq')}</a>
        {mine ? (
          <button
            type="button"
            onClick={() =>
              openChimmyWithPrompt({
                leagueId,
                source: 'trade',
                prompt: tInterpolate('dynasty.lottery.chimmyPrompt', { odds: mine.oddsPercent.toFixed(1), league: leagueName }),
              })
            }
          >
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('dynasty.lottery.askChimmy')}
          </button>
        ) : null}
      </div>
    </section>
  )
}
