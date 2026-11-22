'use client'

import { useState } from 'react'
import { formatChatMessageTimestamp, formatChatMessageTimestampFull, toDateTimeAttr } from '@/lib/chat-core/chat-timestamps'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import {
  readPinnedScore,
  type PinnedMatchupInput,
  type RedraftChatEvent,
} from '@/lib/league-chat/redraftChatEvents'

/**
 * Redraft League chat (batch A4): the league-event card and the pinned matchup score.
 * Styles: components/chat/redraft-chat.css, scoped under the redraft workspace attributes.
 * Every colour comes from the foundation's `--rd-*` tokens and the conversation's own palette.
 */

const fmtScore = (n: number) => n.toLocaleString(getAppIntlLocale(), { maximumFractionDigits: 2 })

/**
 * An authorless league notice — a trade, a waiver claim, a score — drawn across the conversation as
 * a system row (ChatMessageList `renderSystem`). No bubble and no actions: nobody said it.
 */
export function RedraftChatEventCard({ event, createdAt }: { event: RedraftChatEvent; createdAt: string }) {
  const time = formatChatMessageTimestamp(createdAt)
  const s = event.score
  const named = s && s.homeName && s.awayName ? s : null
  const faab = event.faab != null ? ` · $${event.faab} FAAB` : ''
  return (
    <article className="rdc-event" data-rd-event={event.kind} aria-label={`${event.label}${faab}${time ? `, ${time}` : ''}`}>
      <p className="rdc-event-head">
        <span className="rdc-event-label">
          {event.label}
          {faab ? <span className="rdc-event-faab">{faab}</span> : null}
        </span>
        {time ? (
          <time dateTime={toDateTimeAttr(createdAt)} title={formatChatMessageTimestampFull(createdAt) || undefined}>
            {time}
          </time>
        ) : null}
      </p>
      {named ? (
        <p className="rdc-event-score" data-testid="redraft-chat-event-score">
          <span className="rdc-event-side" data-lead={named.homeScore > named.awayScore || undefined}>
            <span className="rdc-event-team">{named.homeName}</span>
            <strong className="af-num">{fmtScore(named.homeScore)}</strong>
          </span>
          <span className="rdc-event-dash" aria-hidden="true">
            –
          </span>
          <span className="rdc-event-side" data-lead={named.awayScore > named.homeScore || undefined}>
            <strong className="af-num">{fmtScore(named.awayScore)}</strong>
            <span className="rdc-event-team">{named.awayName}</span>
          </span>
        </p>
      ) : null}
      {/* The posted words stay, unless the score line above already says exactly that. */}
      {event.body && !named ? <p className="rdc-event-body">{event.body}</p> : null}
    </article>
  )
}

/**
 * The viewer's matchup, pinned under the chat header. Reads the rail snapshot the league page already
 * loaded — no fetch of its own — so it is as fresh as the page: "Live" only while that snapshot is a
 * live-cache row younger than the rail's own 15-minute window, otherwise the week.
 */
export function RedraftChatPinnedScore({ matchup }: { matchup: PinnedMatchupInput | null | undefined }) {
  const [now] = useState(() => Date.now())
  const p = readPinnedScore(matchup, now)
  if (!p) return null
  const score = (v: number | null) => (v == null ? '–' : fmtScore(v))
  const tag = p.live ? 'Live' : p.week ? `Week ${p.week}` : 'This week'
  return (
    <div
      className="rdc-score"
      data-testid="redraft-chat-pinned-score"
      data-live={p.live || undefined}
      aria-label={`${tag}: ${p.you.name} ${score(p.you.score)}, ${p.them.name} ${score(p.them.score)}`}
    >
      <span className="rdc-score-tag">{tag}</span>
      <span className="rdc-score-line" aria-hidden="true">
        <span className="rdc-score-team" data-lead={p.leader === 'you' || undefined}>
          {p.you.name}
        </span>
        <strong className="rdc-score-num af-num" data-lead={p.leader === 'you' || undefined}>
          {score(p.you.score)}
        </strong>
        <span className="rdc-score-dash">–</span>
        <strong className="rdc-score-num af-num" data-lead={p.leader === 'them' || undefined}>
          {score(p.them.score)}
        </strong>
        <span className="rdc-score-team" data-lead={p.leader === 'them' || undefined}>
          {p.them.name}
        </span>
      </span>
    </div>
  )
}
