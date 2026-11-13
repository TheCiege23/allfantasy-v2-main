'use client'

import '@/components/core-app/af-war-campaign.css'
import type { CampaignGame, Tiebreak, WarCampaign as WarCampaignView } from '@/lib/core-app/warRoomCampaign'
import { pct, signedPts } from '@/lib/core-app/outlookCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomCampaignMessages } from '@/lib/core-app/messages/warRoomCampaign'

/**
 * The road ahead — War Room phase 5, for the league on screen (rules in lib/core-app/warRoomCampaign.ts).
 * Free, like the format brief: it is Season Outlook's own simulation, read game by game.
 *
 * ⚠ `id="war-road"` IS AN ANCHOR, for the same reason `war-trades` is one.
 */

function useCopy() {
  return useMessages(warRoomCampaignMessages)
}

type Copy = ReturnType<typeof useCopy>

const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`

function GameRow({ game, m }: { game: CampaignGame; m: Copy }) {
  const o = game.opponent
  return (
    <li className="af-wc-game" data-biggest={game.biggest ? 'true' : undefined} data-small={game.small ? 'true' : undefined}>
      <p className="af-wc-matchup">
        <span className="af-wc-week">{m.week(game.week)}</span> {m.vs(o.name)}
      </p>
      <p className="af-wc-opp">{m.oppFact(record(o.wins, o.losses, o.ties), o.playoffPct == null ? null : pct(o.playoffPct))}</p>
      <p className="af-wc-branches">
        <span className="af-wc-win">{m.win(pct(game.ifWin))}</span>
        <span className="af-wc-lose">{m.lose(pct(game.ifLose))}</span>
      </p>
      {/* The bar is the gap between the two results on a 0–100 scale: the wider it is, the more this week decides. */}
      <div className="af-wc-bar" aria-hidden="true">
        <span
          className="af-wc-bar-fill"
          style={{ left: `${Math.min(game.ifLose, game.ifWin)}%`, width: `${Math.max(1, Math.abs(game.swing))}%` }}
        />
      </div>
      <p className="af-wc-tags">
        {game.small ? (
          <span className="af-wc-tag">{m.small}</span>
        ) : (
          <span className="af-wc-tag">{m.swing(Math.abs(game.swing).toFixed(0))}</span>
        )}
        {game.biggest ? <span className="af-wc-tag" data-tone="key">{m.biggest}</span> : null}
      </p>
    </li>
  )
}

function TiebreakTable({ tiebreak, m }: { tiebreak: Tiebreak; m: Copy }) {
  return (
    <div className="af-wc-tiebreak">
      <h3 className="af-label af-wc-subheading">{m.tiebreakHeading}</h3>
      <p className="af-wc-note">{m.tiebreakLead(tiebreak.playoffTeams)}</p>
      <ol className="af-wc-tb-list">
        {tiebreak.rows.map((r) => (
          <li key={r.rosterId} className="af-wc-tb-row" data-you={r.isYou ? 'true' : undefined}>
            <span className="af-wc-tb-seed af-num">{r.seed}</span>
            <span className="af-wc-tb-name">
              {r.isYou ? m.you : (r.name ?? '—')}
              {r.inField ? <span className="af-wc-tb-field"> · {m.inField}</span> : null}
            </span>
            <span className="af-wc-tb-rec">{record(r.wins, r.losses, r.ties)}</span>
            <span className="af-wc-tb-pf">{m.pointsFor(r.pointsFor.toFixed(1))}</span>
            <span className="af-wc-tb-gap">{r.isYou ? '' : m.gap(signedPts(r.pointsGap))}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function WarCampaign({ view }: { view: WarCampaignView }) {
  const m = useCopy()
  return (
    <section className="af-wc" id="war-road" aria-labelledby="af-wc-heading">
      <h2 id="af-wc-heading" className="af-label af-wc-heading">
        {m.heading}
      </h2>

      {view.kind === 'none' ? (
        <p className="af-wc-note">{m.none(view.why)}</p>
      ) : (
        <>
          <p className="af-wc-note">{m.lead(pct(view.playoffPct))}</p>
          {view.games.length > 0 ? (
            <ol className="af-wc-list">
              {view.games.map((g) => (
                <GameRow key={g.week} game={g} m={m} />
              ))}
            </ol>
          ) : null}
          {view.inProgressWeek != null ? <p className="af-wc-note">{m.inProgress(view.inProgressWeek)}</p> : null}
          {view.unpricedGames > 0 ? <p className="af-wc-note">{m.unpriced(view.unpricedGames)}</p> : null}
          {view.medianGame ? <p className="af-wc-note">{m.median}</p> : null}
          <p className="af-wc-note af-wc-basis">{m.basis}</p>
        </>
      )}

      {view.tiebreak ? <TiebreakTable tiebreak={view.tiebreak} m={m} /> : null}
    </section>
  )
}

export default WarCampaign
