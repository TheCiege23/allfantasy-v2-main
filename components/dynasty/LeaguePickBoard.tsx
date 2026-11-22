'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import { ArrowLeftRight, MessageCircle } from 'lucide-react'
import type { LeaguePickBoard as Board, BoardTeam } from '@/lib/dynasty-core/leaguePickBoard'
import type { PickBoardTradeContext } from '@/lib/dynasty-core/leaguePickBoardService'
import { pickLedgerInsight, pickLedgerSeasons, pickLedgerTotals } from '@/lib/dynasty-core/pickLedger'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import './pick-ledger.css'

/* The league's own trade builder, loaded only when someone opens it. */
const ProposeTradeModal = dynamic(() => import('@/app/league/[leagueId]/tabs/ProposeTradeModal').then((m) => m.ProposeTradeModal), { ssr: false })

type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * The Dynasty Era pick ledger: every team as a row, the next three rookie drafts as columns, every
 * pick a chip. First-rounders are outlined in gold, later rounds in the line colour, an acquired
 * pick names the team it came from, and a team's own pick held elsewhere is dashed and struck
 * through with the team that holds it. Read from `/api/leagues/[leagueId]/pick-board` — the same
 * inventory the Trade Center offers — so nothing here is estimated.
 *
 * Rendered only on the Dynasty tab (`DynastyHome`), which only dynasty leagues have.
 */
export function LeaguePickBoard({ leagueId }: { leagueId: string }) {
  const { tInterpolate } = useOptionalLanguage()
  const t: Translate = (key, vars) => tInterpolate(key, vars ?? {})
  const [board, setBoard] = useState<Board | null>(null)
  const [trade, setTrade] = useState<PickBoardTradeContext | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [proposing, setProposing] = useState(false)

  useEffect(() => {
    let alive = true
    setState('loading')
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pick-board`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as { board: Board | null; trade?: PickBoardTradeContext }
      })
      .then((j) => {
        if (!alive) return
        setBoard(j.board)
        setTrade(j.trade ?? null)
        setState(j.board ? 'ready' : 'none')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [leagueId])

  const seasons = useMemo(() => (board ? pickLedgerSeasons(board) : []), [board])
  const insight = useMemo(() => (board ? pickLedgerInsight(board, seasons) : null), [board, seasons])

  if (state === 'loading') return <p className="dyn-pl-empty py-10 text-center text-sm">{t('pickLedger.loading')}</p>
  if (state === 'error') return <p className="dyn-pl-empty py-10 text-center text-sm">{t('pickLedger.error')}</p>
  if (state === 'none' || !board) {
    return <p className="dyn-pl-empty py-10 text-center text-sm" data-testid="pick-board-none">{t('pickLedger.none')}</p>
  }

  /* Without the draft size the board lists only traded picks, so a total would undercount. */
  const showTotals = board.coverage === 'complete'
  const viewerHasTeam = board.teams.some((tm) => tm.isViewer)
  const gridVars = { '--dyn-pl-seasons': Math.max(1, seasons.length) } as CSSProperties

  return (
    <section className="dyn-pl" data-testid="league-pick-board" aria-labelledby="dyn-pl-title">
      <div className="dyn-pl-head">
        <div>
          <h2 id="dyn-pl-title" className="dyn-pl-title">{t('pickLedger.title')}</h2>
          <p className="dyn-pl-sub">{t('pickLedger.subtitle', { count: seasons.length })}</p>
        </div>
        {viewerHasTeam ? (
          <button type="button" className="dyn-pl-propose" data-testid="pick-ledger-propose" onClick={() => setProposing(true)}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            {t('pickLedger.proposeTrade')}
          </button>
        ) : null}
      </div>

      {board.coverage === 'traded_only' ? <p className="dyn-pl-note" data-testid="pick-ledger-traded-only">{t('pickLedger.tradedOnly')}</p> : null}

      <div className="dyn-pl-board">
        <div className="dyn-pl-cols" style={gridVars} data-totals={showTotals} aria-hidden>
          <div>{t('pickLedger.column.team')}</div>
          {seasons.map((s) => (
            <div key={s}>{t('pickLedger.column.season', { season: s })}</div>
          ))}
          {showTotals ? <div style={{ textAlign: 'right' }}>{t('pickLedger.column.held')}</div> : null}
        </div>
        <ul className="dyn-pl-list">
          {board.teams.map((team) => (
            <LedgerRow key={team.rosterId} team={team} seasons={seasons} showTotals={showTotals} style={gridVars} t={t} />
          ))}
        </ul>
      </div>

      <div className="dyn-pl-foot">
        <ul className="dyn-pl-legend" aria-label={t('pickLedger.legend.label')}>
          <li><span className="dyn-pl-swatch" data-kind="first" aria-hidden />{t('pickLedger.legend.first')}</li>
          <li><span className="dyn-pl-swatch" aria-hidden />{t('pickLedger.legend.later')}</li>
          <li><span className="dyn-pl-swatch" data-kind="traded" aria-hidden />{t('pickLedger.legend.traded')}</li>
        </ul>
        {insight ? (
          <p className="dyn-pl-insight" data-testid="pick-ledger-insight">
            <span>{t('pickLedger.insight', { team: insight.team, count: insight.firsts, drafts: insight.drafts })}</span>
            <button
              type="button"
              className="dyn-pl-ask"
              onClick={() => openChimmyWithPrompt({ leagueId, source: 'trade', prompt: t('pickLedger.chimmyPrompt') })}
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              {t('pickLedger.askChimmy')}
            </button>
          </p>
        ) : null}
      </div>

      {proposing ? (
        <ProposeTradeModal
          open
          onClose={() => setProposing(false)}
          leagueId={leagueId}
          teams={[]}
          platform={trade?.platform ?? null}
          sport={trade?.sport ?? null}
          onSubmitted={() => setProposing(false)}
        />
      ) : null}
    </section>
  )
}

function LedgerRow({ team, seasons, showTotals, style, t }: { team: BoardTeam; seasons: number[]; showTotals: boolean; style: CSSProperties; t: Translate }) {
  const totals = pickLedgerTotals(team, seasons)
  return (
    <li className="dyn-pl-row" data-viewer={team.isViewer} data-totals={showTotals} style={style} data-testid="pick-ledger-row">
      <p className="dyn-pl-team">
        {team.name}
        {team.isViewer ? <span className="dyn-pl-you">{t('pickLedger.you')}</span> : null}
      </p>
      {seasons.map((s) => {
        const held = team.bySeason[s] ?? []
        const away = team.tradedAwayBySeason[s] ?? []
        return (
          <div key={s} className="dyn-pl-season">
            <span className="dyn-pl-season-label">{t('pickLedger.column.season', { season: s })}</span>
            {held.length || away.length ? (
              <ul className="dyn-pl-chips">
                {held.map((p, i) => (
                  <li key={`h-${p.round}-${i}`} className="dyn-pl-chip" data-round={p.round}>
                    {t('pickLedger.chip.round', { round: p.round })}
                    {p.fromTeam ? <span className="dyn-pl-via">{t('pickLedger.chip.via', { team: p.fromTeam })}</span> : null}
                  </li>
                ))}
                {away.map((p, i) => (
                  <li key={`a-${p.round}-${i}`} className="dyn-pl-chip" data-round={p.round} data-traded="true">
                    <span aria-hidden>{t('pickLedger.chip.round', { round: p.round })} {t('pickLedger.chip.tradedTo', { team: p.toTeam })}</span>
                    <span className="sr-only">{t('pickLedger.chip.round', { round: p.round })} {t('pickLedger.chip.srTradedTo', { team: p.toTeam })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="dyn-pl-empty">{t('pickLedger.emptySeason')}</span>
            )}
          </div>
        )
      })}
      {showTotals ? (
        <div className="dyn-pl-held" data-testid="pick-ledger-held">
          <div className="dyn-pl-held-n" aria-hidden>{totals.held}</div>
          <div className="dyn-pl-held-f" aria-hidden>
            {t(totals.firsts === 1 ? 'pickLedger.firsts.one' : 'pickLedger.firsts.other', { count: totals.firsts })}
          </div>
          <span className="sr-only">
            {t('pickLedger.column.held')}: {totals.held}, {t(totals.firsts === 1 ? 'pickLedger.firsts.one' : 'pickLedger.firsts.other', { count: totals.firsts })}
          </span>
        </div>
      ) : null}
    </li>
  )
}
