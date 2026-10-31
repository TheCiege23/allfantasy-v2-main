'use client'

import { ArrowLeftRight } from 'lucide-react'
import { MessageTime } from './MessageTime'
import { initialsFor, safeAvatarUrl } from './chatLayout'
import { describeMove, moveActor, moveVerb, type LeagueMove, type LeagueMovePlayer } from '@/lib/league-chat/leagueMoves'

/**
 * A league transaction in the conversation — "X made a waiver claim", then a + / − row per player
 * with his headshot, position and team, the way Sleeper's league chat draws one. A trade groups the
 * players by the team that received them when the payload says so.
 *
 * Drawn through ChatMessageList's `renderSystem`: no bubble, and nothing to react to, reply to or pin.
 */
export function LeagueMoveCard({ move }: { move: LeagueMove }) {
  const avatar = safeAvatarUrl(move.avatarUrl)
  return (
    /* A group, not an article: in this list `article` means a message you can act on (react, reply, pin). */
    <div role="group" className="af-cm-move" data-kind={move.kind} aria-label={describeMove(move)}>
      <header className="af-cm-move-head">
        <span className="af-cm-move-av" aria-hidden>
          {move.kind === 'trade' ? (
            <ArrowLeftRight size={14} />
          ) : avatar ? (
            <img src={avatar} alt="" />
          ) : (
            initialsFor(move.teamName ?? move.managerName)
          )}
        </span>
        <p className="af-cm-move-title">
          <strong>{moveActor(move)}</strong> {moveVerb(move)}
        </p>
        <MessageTime value={move.occurredAt} />
      </header>
      {move.kind === 'trade' ? <TradeBody move={move} /> : <MoveBody move={move} />}
    </div>
  )
}

function MoveBody({ move }: { move: LeagueMove }) {
  return (
    <ul className="af-cm-move-list">
      {move.adds.map((p) => (
        <PlayerRow key={`a-${p.id}`} player={p} sign="+" bid={move.bid} />
      ))}
      {move.drops.map((p) => (
        <PlayerRow key={`d-${p.id}`} player={p} sign="−" />
      ))}
    </ul>
  )
}

/*
 * Grouped by who received each player. A player whose receiving team is unknown goes under "Also in
 * this trade" rather than being credited to the first team named — the row's manager is not
 * evidence of which side a player went to.
 */
function TradeBody({ move }: { move: LeagueMove }) {
  const groups = new Map<string, LeagueMovePlayer[]>()
  const unplaced: LeagueMovePlayer[] = []
  for (const p of move.adds) {
    if (!p.to) {
      unplaced.push(p)
      continue
    }
    groups.set(p.to, [...(groups.get(p.to) ?? []), p])
  }
  return (
    <div className="af-cm-move-trade">
      {[...groups].map(([team, players]) => (
        <section key={team} className="af-cm-move-side">
          <p className="af-cm-move-side-name">{team} gets</p>
          <ul className="af-cm-move-list">
            {players.map((p) => (
              <PlayerRow key={p.id} player={p} sign="+" />
            ))}
          </ul>
        </section>
      ))}
      {unplaced.length ? (
        <section className="af-cm-move-side">
          {groups.size ? <p className="af-cm-move-side-name">Also in this trade</p> : null}
          <ul className="af-cm-move-list">
            {unplaced.map((p) => (
              <PlayerRow key={p.id} player={p} sign="+" />
            ))}
          </ul>
        </section>
      ) : null}
      {move.picks.length ? <p className="af-cm-move-picks">Picks: {move.picks.join(', ')}</p> : null}
    </div>
  )
}

function PlayerRow({ player, sign, bid }: { player: LeagueMovePlayer; sign: '+' | '−'; bid?: number | null }) {
  const photo = safeAvatarUrl(player.imageUrl)
  const meta = [player.position, player.team].filter(Boolean).join(' · ')
  return (
    <li className="af-cm-move-row" data-sign={sign === '+' ? 'add' : 'drop'}>
      <span className="af-cm-move-sign" aria-label={sign === '+' ? 'Added' : 'Dropped'}>
        {sign}
      </span>
      <span className="af-cm-move-photo" aria-hidden>
        {photo ? <img src={photo} alt="" loading="lazy" /> : initialsFor(player.name)}
      </span>
      <span className="af-cm-move-who">
        <span className="af-cm-move-name">{player.name}</span>
        {meta ? <span className="af-cm-move-meta">{meta}</span> : null}
      </span>
      {/* Null is UNKNOWN, not free — nothing is drawn rather than "$0". */}
      {bid != null ? <span className="af-cm-move-bid">${bid}</span> : null}
    </li>
  )
}

export default LeagueMoveCard
