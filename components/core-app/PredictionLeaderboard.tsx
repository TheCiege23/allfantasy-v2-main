'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { predictionCopy } from '@/lib/league-chat/predictionCopy'

type Row = { userId: string; name: string; points: number; made: number }

/**
 * The season's Prediction Leaderboard — one point per correct pick on a league chat prediction
 * poll (lib/league-chat/predictionPolls.ts). Native leagues only: the endpoint answers
 * `native: false` for an import and the card renders nothing.
 */
export function PredictionLeaderboard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const t = (english: string) => predictionCopy(english, language)
  const [state, setState] = useState<{ native: boolean; rows: Row[]; viewer: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/predictions`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { native?: boolean; leaderboard?: Row[]; viewerUserId?: string } | null) => {
        if (cancelled || !d) return
        setState({ native: d.native === true, rows: Array.isArray(d.leaderboard) ? d.leaderboard : [], viewer: d.viewerUserId ?? null })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (!state?.native) return null

  return (
    <section className="af-card af-lh-predictions" aria-labelledby="af-lh-predictions-title" data-testid="prediction-leaderboard">
      <span className="af-label">{t('One point for every correct pick this season.')}</span>
      <h2 id="af-lh-predictions-title">{t('Prediction Leaderboard')}</h2>
      {state.rows.length === 0 ? (
        <p className="af-lh-predictions-empty">
          {t('No predictions have been settled yet. Post one from the league chat poll button.')}
        </p>
      ) : (
        <table className="af-lh-predictions-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('Manager')}</th>
              <th scope="col">{t('Points')}</th>
              <th scope="col">{t('Picks')}</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r, i) => (
              <tr key={r.userId} data-me={r.userId === state.viewer || undefined}>
                <td className="af-num">{i + 1}</td>
                <td>{r.name}</td>
                <td className="af-num">{r.points}</td>
                <td className="af-num">
                  {r.points}/{r.made}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default PredictionLeaderboard
